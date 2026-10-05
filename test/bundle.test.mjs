// Tests for scripts/build-bundle.mjs: the frontmatter parser, the project-flavor transform and the generated
// dist/bundle.json and catalog.json. Builds run against a scratch copy of the real plugin sources plus a fixture
// template and package.json, so the tests never read or write the committed outputs.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AGENT_ORDER,
  GROUPS,
  INHERITS_TOOLS,
  PLUGIN_POINTER,
  PROJECT_POINTER,
  buildBundle,
  buildCatalog,
  deriveRole,
  generate,
  parseFrontmatter,
  parseSections,
  readSources,
  serialize,
  toProjectFlavor,
} from "../scripts/build-bundle.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_VERSION = "9.9.9";
const FIXTURE_TEMPLATE = `---
name: {{skill_name}}
description: "Team {{team_name}} ({{team_slug}}). Use on 'agentmash crew, add invite links' or 'agentmash crew работает'."
---

# {{team_name}}

{{roster_table}}

Members: {{members_inline}}. Not in the team: {{missing_inline}}. Add one with {{add_command}}.
`;
const SUMMARY_START = "<!-- crew-protocol:summary:start -->";
const SUMMARY_END = "<!-- crew-protocol:summary:end -->";

const scratchRoots = [];
after(() => {
  for (const root of scratchRoots) rmSync(root, { recursive: true, force: true });
});

/** A throwaway checkout: real plugin sources and data, fixture template and package.json, and the build script. */
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "agentmash-bundle-"));
  scratchRoots.push(root);
  for (const dir of ["plugin/agents", "plugin/skills", "plugin/hooks", "plugin/.claude-plugin", "data"]) {
    cpSync(join(REPO, dir), join(root, dir), { recursive: true });
  }
  mkdirSync(join(root, "scripts"));
  cpSync(join(REPO, "scripts/build-bundle.mjs"), join(root, "scripts/build-bundle.mjs"));
  mkdirSync(join(root, "templates"));
  writeFileSync(join(root, "templates/team-skill.md"), FIXTURE_TEMPLATE);
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "agentmash-crew", version: FIXTURE_VERSION })}\n`);
  return root;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [join(root, "scripts/build-bundle.mjs"), ...args], { encoding: "utf8" });
}

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const count = (text, needle) => text.split(needle).length - 1;
const frontmatter = (...lines) => `---\n${lines.join("\n")}\n---\nbody\n`;

describe("parseFrontmatter", () => {
  test("parses every field type and returns the body", () => {
    const source = [
      "---",
      "name: pipe-backend",
      'description: "Use when an endpoint changes, say \\"build the API\\". Returns the change. Not for UI."',
      "tools: Read, Grep, Bash",
      "model: inherit",
      "effort: high",
      "maxTurns: 80",
      "color: green",
      "skills:",
      "  - crew-protocol",
      "---",
      "",
      "# Pipe · Backend engineer",
      "",
    ].join("\n");
    const { data, body } = parseFrontmatter(source);
    assert.deepEqual(data, {
      name: "pipe-backend",
      description: 'Use when an endpoint changes, say "build the API". Returns the change. Not for UI.',
      tools: ["Read", "Grep", "Bash"],
      model: "inherit",
      effort: "high",
      maxTurns: 80,
      color: "green",
      skills: ["crew-protocol"],
    });
    assert.equal(body, "\n# Pipe · Backend engineer\n");
  });

  test("accepts a plain description with inner quotes", () => {
    const { data } = parseFrontmatter(frontmatter('description: Use when fixing a layout ("fix this"). Returns x.'));
    assert.equal(data.description, 'Use when fixing a layout ("fix this"). Returns x.');
  });

  const rejected = [
    ["an unknown field", ["foo: bar"], /unknown field 'foo'/],
    ["a duplicate field", ["model: inherit", "model: opus"], /duplicate field 'model'/],
    ["maxTurns of 0", ["maxTurns: 0"], /positive integer/],
    ["a non-numeric maxTurns", ["maxTurns: ten"], /positive integer/],
    ["an unterminated quote", ['description: "Use when'], /unterminated/],
    ["text after the closing quote", ['description: "Use when" x'], /after the closing quote/],
    ["an unsupported escape", ['description: "a\\qb"'], /unsupported escape/],
    ["a plain value with ': '", ["description: Use when: now"], /may not contain/],
    ["a single-quoted value", ["description: 'Use when'"], /may not start with/],
    ["a list item outside a list", ["model: inherit", "  - crew-protocol"], /outside a block list/],
    ["an empty block list", ["skills:"], /non-empty block list/],
    ["an empty tools item", ["tools: Read,, Bash"], /empty item/],
    ["an indented key", ["  name: pipe-backend"], /expected 'key: value'/],
  ];
  for (const [what, lines, message] of rejected) {
    test(`rejects ${what}`, () => {
      assert.throws(() => parseFrontmatter(frontmatter(...lines), "x.md"), message);
    });
  }

  test("rejects a missing delimiter and CRLF line endings", () => {
    assert.throws(() => parseFrontmatter("name: x\n---\n"), /must start with/);
    assert.throws(() => parseFrontmatter("---\nname: x\n"), /not closed/);
    assert.throws(() => parseFrontmatter("---\r\nname: x\r\n---\r\n"), /CR line endings/);
  });

  test("parses all 22 plugin agents", () => {
    for (const name of AGENT_ORDER) {
      const { data } = parseFrontmatter(readFileSync(join(REPO, `plugin/agents/${name}.md`), "utf8"), name);
      assert.equal(data.name, name);
      // An agent that drives the session's MCP server has no tools line, so it inherits them.
      if (INHERITS_TOOLS.includes(name)) assert.equal(data.tools, undefined, name);
      else assert.ok(data.tools.length > 0, name);
      assert.ok(data.skills.includes("crew-protocol"), name);
    }
  });
});

describe("toProjectFlavor", () => {
  const block = (inner) => `# X\n${SUMMARY_START}\n${inner}\n${SUMMARY_END}\n`;

  test("moves the single protocol pointer into .claude/ and changes nothing else", () => {
    const source = readFileSync(join(REPO, "plugin/agents/pipe-backend.md"), "utf8");
    const out = toProjectFlavor(source, "pipe-backend");
    assert.equal(out, source.split(PLUGIN_POINTER).join(PROJECT_POINTER));
    assert.equal(count(out, PROJECT_POINTER), 1);
    assert.ok(!out.includes("CLAUDE_PLUGIN_ROOT"));
  });

  test("fails on 0 or 2 pointers", () => {
    assert.throws(() => toProjectFlavor(block("no pointer here"), "a.md"), /a\.md: expected exactly 1 .* found 0/);
    assert.throws(() => toProjectFlavor(block(`${PLUGIN_POINTER} ${PLUGIN_POINTER}`), "b.md"), /found 2/);
  });

  test("fails when the pointer sits outside the summary block", () => {
    assert.throws(() => toProjectFlavor(`${PLUGIN_POINTER}\n${block("x")}`, "c.md"), /inside the .* block/);
  });

  test("fails on any other plugin root reference", () => {
    const source = block(PLUGIN_POINTER) + "Run node ${CLAUDE_PLUGIN_ROOT}/hooks/crew-guard.mjs\n";
    assert.throws(() => toProjectFlavor(source, "d.md"), /d\.md:5: .* would leak/);
  });
});

describe("deriveRole", () => {
  test("takes the text after ' · ' in the H1", () => {
    assert.equal(deriveRole("\n# Mash · Crew coordinator\n", "Use when x."), "Crew coordinator");
  });

  test("falls back to the first description sentence, cut to 60 characters", () => {
    const role = deriveRole("\n# Mash\n", "Use when an approved plan is ready to run and parallel work needs integrating. Returns x.");
    assert.equal(role, "Use when an approved plan is ready to run and parallel work…");
    assert.ok(role.length <= 60);
    assert.equal(deriveRole("# Mash\n", "Use when a plan is ready. Returns x."), "Use when a plan is ready");
  });

  test("rejects a heading role over 60 characters or containing '|'", () => {
    assert.throws(() => deriveRole(`# Mash · ${"a".repeat(61)}\n`, "x"), /1-60 characters/);
    assert.throws(() => deriveRole("# Mash · a | b\n", "x"), /without '\|'/);
  });
});

describe("parseSections", () => {
  test("keeps each section's sentences verbatim", () => {
    const sections = parseSections("Use when X. Also when Y. Returns Z. Not for W (other-agent).");
    assert.deepEqual(sections, { whenToUse: "Use when X. Also when Y.", returns: "Returns Z.", notFor: "Not for W (other-agent)." });
    assert.equal(parseSections("Use after a merge, or 'why did it drop'. Returns Z. Not for W.").returns, "Returns Z.");
  });

  test("fails loudly when a section is missing, repeated or out of order", () => {
    assert.throws(() => parseSections("Use when X. Not for W.", "a.md"), /a\.md: description has no 'Returns' sentence/);
    assert.throws(() => parseSections("Use when X. Returns Z.", "a.md"), /no 'Not for' sentence/);
    assert.throws(() => parseSections("Returns Z. Not for W.", "a.md"), /no 'Use when\/after' sentence/);
    assert.throws(() => parseSections("It helps. Use when X. Returns Z. Not for W.", "a.md"), /must open with/);
    assert.throws(() => parseSections("Use when X. Returns Z. Returns Q. Not for W.", "a.md"), /two 'Returns'/);
    assert.throws(() => parseSections("Use when X. Not for W. Returns Z.", "a.md"), /must read/);
  });
});

describe("bundle", () => {
  let root, sources, bundle;
  before(() => {
    root = makeRoot();
    sources = readSources(root);
    bundle = buildBundle(sources);
  });

  test("follows the schema 1 key order and meta values", () => {
    assert.deepEqual(Object.keys(bundle), ["schema", "meta", "agents", "shared", "templates"]);
    assert.deepEqual(bundle.meta, {
      name: "agentmash-crew",
      version: FIXTURE_VERSION,
      url: "https://github.com/agentmash-dev/agentmash-crew",
      conductor: "mash-coordinator",
      addCommand: "npx agentmash team add <team> --agents <agent>",
      hook: {
        event: "PreToolUse",
        matcher: "Bash",
        command: 'node "$CLAUDE_PROJECT_DIR/.claude/agentmash-crew/crew-guard.mjs"',
        timeout: 5,
        marker: ".claude/agentmash-crew/crew-guard.mjs",
      },
      manifestPath: ".claude/agentmash-crew/teams.json",
    });
    assert.deepEqual(Object.keys(bundle.meta), ["name", "version", "url", "conductor", "addCommand", "hook", "manifestPath"]);
    for (const agent of bundle.agents) {
      assert.deepEqual(Object.keys(agent), ["name", "short", "title", "role", "group", "path", "sha256", "content"]);
    }
    assert.deepEqual(bundle.shared.map(({ path }) => path), [
      ".claude/skills/crew-protocol/SKILL.md",
      ".claude/skills/run-crew/SKILL.md",
      ".claude/agentmash-crew/crew-guard.mjs",
    ]);
    assert.deepEqual(bundle.templates, {
      teamSkill: { pathPattern: ".claude/skills/team-{{team_slug}}/SKILL.md", content: FIXTURE_TEMPLATE },
    });
  });

  test("lists the 22 agents in canonical order with derived fields", () => {
    assert.deepEqual(bundle.agents.map(({ name }) => name), AGENT_ORDER);
    for (const agent of bundle.agents) {
      assert.equal(agent.short, agent.name.split("-")[0]);
      assert.equal(agent.title, agent.short[0].toUpperCase() + agent.short.slice(1));
      assert.equal(agent.path, `.claude/agents/${agent.name}.md`);
      assert.ok(agent.role.length > 0 && agent.role.length <= 60, agent.name);
    }
    assert.equal(bundle.agents[0].role, "Crew coordinator");
    assert.equal(bundle.agents[0].group, "lead");
  });

  test("every sha256 is the hex digest of its content", () => {
    for (const entry of [...bundle.agents, ...bundle.shared]) assert.equal(entry.sha256, sha256(entry.content), entry.path);
  });

  test("no plugin root leaks into project output", () => {
    assert.ok(!serialize(bundle).includes("CLAUDE_PLUGIN_ROOT"));
    for (const agent of bundle.agents) assert.equal(count(agent.content, PROJECT_POINTER), 1, agent.name);
  });

  test("copies shared files byte for byte", () => {
    const sourceOf = {
      ".claude/skills/crew-protocol/SKILL.md": "plugin/skills/crew-protocol/SKILL.md",
      ".claude/skills/run-crew/SKILL.md": "plugin/skills/run-crew/SKILL.md",
      ".claude/agentmash-crew/crew-guard.mjs": "plugin/hooks/crew-guard.mjs",
    };
    for (const { path, content } of bundle.shared) assert.equal(content, readFileSync(join(root, sourceOf[path]), "utf8"));
  });

  test("fails when an agent file has 0 or 2 protocol pointers", () => {
    const withPipe = (edit) => ({ ...sources, agents: { ...sources.agents, "pipe-backend": edit(sources.agents["pipe-backend"]) } });
    assert.throws(() => buildBundle(withPipe((s) => s.replace(PLUGIN_POINTER, () => "the protocol"))), /pipe-backend\.md.*found 0/);
    assert.throws(
      () => buildBundle(withPipe((s) => s.replace(PLUGIN_POINTER, () => `${PLUGIN_POINTER} ${PLUGIN_POINTER}`))),
      /pipe-backend\.md.*found 2/,
    );
  });

  test("fails when a shared file or the template mentions the plugin root", () => {
    const path = ".claude/skills/run-crew/SKILL.md";
    const leak = "\nSee ${CLAUDE_PLUGIN_ROOT}/skills.\n";
    assert.throws(() => buildBundle({ ...sources, shared: { ...sources.shared, [path]: sources.shared[path] + leak } }),
      /plugin\/skills\/run-crew\/SKILL\.md:\d+: .* would leak/);
    assert.throws(() => buildBundle({ ...sources, template: sources.template + leak }), /team-skill\.md:\d+: .* would leak/);
  });

  test("rejects placeholders outside the contract", () => {
    assert.throws(() => buildBundle({ ...sources, template: `${sources.template}{{team_size}}\n` }), /\{\{team_size\}\}/);
  });

  test("is deterministic", () => {
    assert.deepEqual(generate(root), generate(root));
    assert.equal(serialize(buildBundle(readSources(root))), serialize(bundle));
  });
});

describe("catalog", () => {
  let catalog;
  before(() => {
    const sources = readSources(makeRoot());
    catalog = buildCatalog(buildBundle(sources), sources.ru);
  });

  test("has the top-level shape and all 22 agents in canonical order", () => {
    assert.deepEqual(Object.keys(catalog), ["schema", "version", "conductor", "groups", "agents"]);
    assert.equal(catalog.version, FIXTURE_VERSION);
    assert.equal(catalog.conductor, "mash-coordinator");
    assert.deepEqual(catalog.agents.map(({ name }) => name), AGENT_ORDER);
  });

  test("every field of every agent is non-empty", () => {
    const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
    for (const agent of catalog.agents) {
      assert.deepEqual(Object.keys(agent), [
        "name", "short", "title", "role", "group", "description", "tools", "inheritsTools", "model", "effort", "maxTurns", "color",
        "wordCount", "sections", "ru", "installSnippet",
      ]);
      for (const key of ["name", "short", "title", "role", "group", "description", "model", "effort", "color", "installSnippet"]) {
        assert.ok(nonEmpty(agent[key]), `${agent.name}.${key}`);
      }
      assert.equal(agent.inheritsTools, INHERITS_TOOLS.includes(agent.name), `${agent.name}.inheritsTools`);
      if (agent.inheritsTools) assert.deepEqual(agent.tools, [], `${agent.name}.tools`);
      else assert.ok(agent.tools.length > 0 && agent.tools.every(nonEmpty), `${agent.name}.tools`);
      assert.ok(Number.isInteger(agent.maxTurns) && agent.maxTurns > 0, `${agent.name}.maxTurns`);
      assert.ok(Number.isInteger(agent.wordCount) && agent.wordCount > 0, `${agent.name}.wordCount`);
      assert.deepEqual(Object.keys(agent.sections), ["whenToUse", "returns", "notFor"]);
      assert.ok(Object.values(agent.sections).every(nonEmpty), `${agent.name}.sections`);
      assert.equal(Object.values(agent.sections).join(" "), agent.description, `${agent.name}.sections`);
      assert.ok(nonEmpty(agent.ru.summary) && nonEmpty(agent.ru.when), `${agent.name}.ru`);
      assert.ok(agent.ru.rules.length > 0 && agent.ru.rules.every(nonEmpty), `${agent.name}.ru.rules`);
      // Mash is in every team already, so its snippet leaves the agent to pick.
      const picked = agent.name === catalog.conductor ? "<agent>" : agent.short;
      assert.equal(agent.installSnippet, `npx agentmash team add "<team>" --agents ${picked}`);
    }
  });

  test("groups cover all 22 agents exactly once and match each agent's group", () => {
    const members = catalog.groups.flatMap((group) => group.members);
    assert.equal(members.length, 22);
    assert.deepEqual([...members].sort(), [...AGENT_ORDER].sort());
    assert.deepEqual(catalog.groups, GROUPS);
    for (const agent of catalog.agents) {
      assert.ok(catalog.groups.find(({ id }) => id === agent.group).members.includes(agent.name), agent.name);
    }
  });
});

describe("CLI", () => {
  test("--check passes right after a build, and a second build writes the same bytes", () => {
    const root = makeRoot();
    const build = run(root);
    assert.equal(build.status, 0, build.stderr);
    assert.match(build.stdout, /wrote dist\/bundle\.json/);
    const first = readFileSync(join(root, "dist/bundle.json"), "utf8") + readFileSync(join(root, "catalog.json"), "utf8");

    const check = run(root, "--check");
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /up to date/);

    const again = run(root);
    assert.match(again.stdout, /unchanged dist\/bundle\.json/);
    assert.equal(readFileSync(join(root, "dist/bundle.json"), "utf8") + readFileSync(join(root, "catalog.json"), "utf8"), first);
  });

  test("--check exits 1 with a diff summary when a source changed", () => {
    const root = makeRoot();
    assert.equal(run(root).status, 0);
    appendFileSync(join(root, "plugin/agents/pipe-backend.md"), "\nOne more line.\n");
    const check = run(root, "--check");
    assert.equal(check.status, 1);
    assert.match(check.stderr, /stale dist\/bundle\.json: agents\[pipe-backend\]\.sha256: changed/);
    assert.match(check.stderr, /stale catalog\.json: agents\[pipe-backend\]\.wordCount: \d+ -> \d+/);
    assert.match(check.stderr, /run `node scripts\/build-bundle\.mjs`/);
  });

  test("--check reports missing outputs", () => {
    const check = run(makeRoot(), "--check");
    assert.equal(check.status, 1);
    assert.match(check.stderr, /stale dist\/bundle\.json: missing/);
  });

  test("a missing template fails unless --allow-missing-template is passed", () => {
    const root = makeRoot();
    rmSync(join(root, "templates"), { recursive: true });
    const strict = run(root);
    assert.equal(strict.status, 1);
    assert.match(strict.stderr, /missing templates\/team-skill\.md; .*--allow-missing-template/);

    const lenient = run(root, "--allow-missing-template");
    assert.equal(lenient.status, 0, lenient.stderr);
    assert.match(lenient.stderr, /warning: templates\/team-skill\.md not found/);
    const bundle = JSON.parse(readFileSync(join(root, "dist/bundle.json"), "utf8"));
    assert.match(bundle.templates.teamSkill.content, /^---\nname: \{\{skill_name\}\}\n/);
  });

  test("falls back to plugin.json for the version when package.json is missing", () => {
    const root = makeRoot();
    rmSync(join(root, "package.json"));
    const build = run(root);
    assert.equal(build.status, 0, build.stderr);
    assert.match(build.stderr, /warning: package\.json not found/);
    const { version } = JSON.parse(readFileSync(join(root, "plugin/.claude-plugin/plugin.json"), "utf8"));
    assert.equal(JSON.parse(readFileSync(join(root, "catalog.json"), "utf8")).version, version);
  });

  test("rejects unknown options", () => {
    const result = run(makeRoot(), "--force");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unknown option --force/);
  });
});

#!/usr/bin/env node
// Builds the install data for agentmash-crew from the plugin sources.
//
//   node scripts/build-bundle.mjs                            write dist/bundle.json and catalog.json
//   node scripts/build-bundle.mjs --check                    exit 1 if the committed files are stale
//   node scripts/build-bundle.mjs --allow-missing-template   build with a placeholder team-skill template
//
// dist/bundle.json holds the PROJECT flavor of every file `team add` writes (docs/bundle-format.md);
// catalog.json is the view the agentmash.dev marketplace pages read. Both are deterministic: the same
// sources always give the same bytes, so installers and `--check` can compare them exactly.
//
// Derived fields:
//   role       the text after " · " in the agent's H1 ("# Mash · Crew coordinator" -> "Crew coordinator");
//              without one, the first sentence of the description cut to 60 characters.
//   sections   the description's sentences, verbatim: "Use when/after ..." -> whenToUse,
//              "Returns ..." -> returns, "Not for ..." -> notFor. All three are required.
//   wordCount  whitespace-separated words in the agent body (the system prompt, frontmatter excluded).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const AGENT_ORDER = [
  "mash-coordinator", "tally-planner", "scout-explorer", "flex-frontend", "pipe-backend", "swipe-mobile",
  "index-database", "patch-integrations", "batch-ml", "spell-prompts", "lingo-i18n", "probe-qa", "gavel-reviewer",
  "snag-debugger", "prune-refactor", "bump-dependencies", "rail-cicd", "quill-docs",
];

export const GROUPS = [
  { id: "lead", title: "Lead", members: ["mash-coordinator", "tally-planner", "scout-explorer"] },
  {
    id: "build",
    title: "Build",
    members: ["flex-frontend", "pipe-backend", "swipe-mobile", "index-database", "patch-integrations", "batch-ml",
      "spell-prompts", "lingo-i18n"],
  },
  { id: "quality", title: "Quality", members: ["probe-qa", "gavel-reviewer", "snag-debugger", "prune-refactor"] },
  { id: "ops", title: "Ops", members: ["bump-dependencies", "rail-cicd"] },
  { id: "docs", title: "Docs", members: ["quill-docs"] },
];

const CONDUCTOR = "mash-coordinator";
const REPO_URL = "https://github.com/IskakovDamir/agentmash-crew";
const ADD_COMMAND = "npx github:IskakovDamir/agentmash-crew team add <team> --agents <agent>";
const GUARD_PATH = ".claude/agentmash-crew/crew-guard.mjs";
const MANIFEST_PATH = ".claude/agentmash-crew/teams.json";

export const PLUGIN_POINTER = "${CLAUDE_PLUGIN_ROOT}/skills/crew-protocol/SKILL.md";
export const PROJECT_POINTER = ".claude/skills/crew-protocol/SKILL.md";
const SUMMARY_START = "<!-- crew-protocol:summary:start -->";
const SUMMARY_END = "<!-- crew-protocol:summary:end -->";
// Both spellings expand to the plugin directory, which does not exist in a project install.
const PLUGIN_ROOT_RE = /\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT\b/;

// Shared files, in bundle order: project path <- plugin source, copied byte for byte.
const SHARED_FILES = [
  { path: ".claude/skills/crew-protocol/SKILL.md", from: "plugin/skills/crew-protocol/SKILL.md" },
  { path: ".claude/skills/run-crew/SKILL.md", from: "plugin/skills/run-crew/SKILL.md" },
  { path: GUARD_PATH, from: "plugin/hooks/crew-guard.mjs" },
];

const TEMPLATE_SOURCE = "templates/team-skill.md";
const TEMPLATE_PATH_PATTERN = ".claude/skills/team-{{team_slug}}/SKILL.md";
const TEMPLATE_PLACEHOLDERS = new Set([
  "team_name", "team_slug", "skill_name", "members_inline", "roster_table", "missing_inline", "add_command",
]);
const MISSING_TEMPLATE = `---
name: {{skill_name}}
description: "Placeholder: ${TEMPLATE_SOURCE} was missing when this bundle was built. Rebuild before release."
---

# {{team_name}}

Placeholder team skill for {{members_inline}}.
`;

const BUNDLE_PATH = "dist/bundle.json";
const CATALOG_PATH = "catalog.json";
const MAX_ROLE_LENGTH = 60;
const MAX_DIFF_LINES = 20;

// ---------------------------------------------------------------------------------------------------------------
// Frontmatter

// The fields crew agent files use. Anything else is rejected rather than silently dropped.
const FIELD_TYPES = {
  name: "string",
  description: "string",
  tools: "csv",
  model: "string",
  effort: "string",
  maxTurns: "integer",
  color: "string",
  skills: "list",
};
const ESCAPES = { '"': '"', "\\": "\\", "/": "/", n: "\n", t: "\t" };

/**
 * Parses the YAML frontmatter of an agent file. Deliberately small and strict: it accepts `key: value` pairs
 * (plain or double-quoted scalars) and block lists (`key:` followed by `  - item` lines) for the fields in
 * FIELD_TYPES, and throws on anything else instead of guessing.
 * @returns {{ data: Record<string, string | number | string[]>, body: string }}
 */
export function parseFrontmatter(source, label = "frontmatter") {
  if (source.includes("\r")) throw new Error(`${label}: CR line endings are not supported; commit the file with LF`);
  if (!source.startsWith("---\n")) throw new Error(`${label}: must start with a '---' frontmatter line`);
  const end = source.indexOf("\n---\n", 3);
  if (end < 0) throw new Error(`${label}: frontmatter is not closed by a '---' line`);

  const raw = {};
  let listKey = null;
  source.slice(4, end).split("\n").forEach((line, index) => {
    const where = `${label}: line ${index + 2}`;
    if (line.trim() === "") return;
    const item = /^ *- (.*)$/.exec(line);
    if (item) {
      if (!listKey) throw new Error(`${where}: list item outside a block list`);
      raw[listKey].push(parseScalar(item[1], where));
      return;
    }
    const pair = /^([A-Za-z][A-Za-z0-9]*):(?: (.*))?$/.exec(line);
    if (!pair) throw new Error(`${where}: expected 'key: value' or '  - item', got ${JSON.stringify(line)}`);
    const [, key, value = ""] = pair;
    if (!Object.hasOwn(FIELD_TYPES, key)) throw new Error(`${where}: unknown field '${key}'`);
    if (Object.hasOwn(raw, key)) throw new Error(`${where}: duplicate field '${key}'`);
    listKey = value.trim() === "" ? key : null;
    raw[key] = listKey ? [] : parseScalar(value, where);
  });

  const data = {};
  for (const [key, value] of Object.entries(raw)) data[key] = coerceField(key, value, label);
  return { data, body: source.slice(end + 5) };
}

function parseScalar(text, where) {
  const value = text.trim();
  if (value.startsWith('"')) return parseDoubleQuoted(value, where);
  if (/^[-?:,[\]{}#&*!|>'%@`]/.test(value)) {
    throw new Error(`${where}: a plain value may not start with '${value[0]}'; double-quote it`);
  }
  if (value.includes(": ") || value.includes(" #") || value.endsWith(":")) {
    throw new Error(`${where}: a plain value may not contain ': ' or ' #'; double-quote it`);
  }
  return value;
}

function parseDoubleQuoted(value, where) {
  let out = "";
  for (let i = 1; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"') {
      if (i !== value.length - 1) throw new Error(`${where}: unexpected text after the closing quote`);
      return out;
    }
    if (ch === "\\") {
      const next = value[++i];
      if (!Object.hasOwn(ESCAPES, next)) throw new Error(`${where}: unsupported escape '\\${next ?? ""}'`);
      out += ESCAPES[next];
    } else {
      out += ch;
    }
  }
  throw new Error(`${where}: unterminated double-quoted string`);
}

function coerceField(key, value, label) {
  const type = FIELD_TYPES[key];
  if (type === "list") {
    if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}: '${key}' must be a non-empty block list`);
    return value;
  }
  if (typeof value !== "string" || value === "") throw new Error(`${label}: '${key}' must be a non-empty scalar`);
  if (type === "csv") {
    const items = value.split(",").map((item) => item.trim());
    if (items.includes("")) throw new Error(`${label}: '${key}' has an empty item`);
    return items;
  }
  if (type === "integer") {
    if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${label}: '${key}' must be a positive integer`);
    return Number(value);
  }
  return value;
}

// ---------------------------------------------------------------------------------------------------------------
// Project flavor

/**
 * Turns a plugin agent file into its project flavor: the single protocol pointer inside the synced summary block
 * moves from the plugin root to the project's `.claude/`. Everything else stays byte for byte.
 */
export function toProjectFlavor(source, label = "agent") {
  const count = source.split(PLUGIN_POINTER).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 '${PLUGIN_POINTER}', found ${count}`);
  const at = source.indexOf(PLUGIN_POINTER);
  const start = source.indexOf(SUMMARY_START);
  const end = source.indexOf(SUMMARY_END);
  if (!(start >= 0 && start < at && at < end)) {
    throw new Error(`${label}: the protocol pointer must sit inside the ${SUMMARY_START} block`);
  }
  const out = source.replace(PLUGIN_POINTER, () => PROJECT_POINTER);
  assertNoPluginRoot(out, label);
  return out;
}

function assertNoPluginRoot(content, label) {
  const hit = PLUGIN_ROOT_RE.exec(content);
  if (hit) {
    const line = content.slice(0, hit.index).split("\n").length;
    throw new Error(`${label}:${line}: '${hit[0]}' would leak into the project install`);
  }
}

function assertTemplate(template, label) {
  assertNoPluginRoot(template, label);
  const unknown = [...template.matchAll(/\{\{([^{}]*)\}\}/g)]
    .map((match) => match[1])
    .filter((name) => !TEMPLATE_PLACEHOLDERS.has(name));
  if (unknown.length) {
    throw new Error(`${label}: unknown placeholder(s) ${[...new Set(unknown)].map((n) => `{{${n}}}`).join(", ")}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Derived agent fields

export function deriveRole(body, description, label = "agent") {
  const heading = /^# (.+)$/m.exec(body)?.[1] ?? "";
  const separator = heading.indexOf(" · ");
  const role = separator >= 0 ? heading.slice(separator + 3).trim() : shorten(firstSentence(description));
  if (!role || role.length > MAX_ROLE_LENGTH || /[|\n]/.test(role)) {
    throw new Error(`${label}: role ${JSON.stringify(role)} must be 1-${MAX_ROLE_LENGTH} characters without '|'`);
  }
  return role;
}

function firstSentence(text) {
  return splitSentences(text)[0].replace(/[.!?]$/, "");
}

// Cuts at a word boundary and marks the cut with an ellipsis, staying within MAX_ROLE_LENGTH.
function shorten(text) {
  if (text.length <= MAX_ROLE_LENGTH) return text;
  const space = text.lastIndexOf(" ", MAX_ROLE_LENGTH - 1);
  return `${text.slice(0, space > 0 ? space : MAX_ROLE_LENGTH - 1)}…`;
}

// A sentence ends at . ! or ? (optionally followed by a closing quote or bracket) and whitespace.
function splitSentences(text) {
  return text.trim().split(/(?<=[.!?]["')\u2019\u201d]?)\s+/);
}

const SECTION_STARTS = [
  { key: "whenToUse", re: /^Use (?:when|after)\b/, phrase: "Use when/after" },
  { key: "returns", re: /^Returns\b/, phrase: "Returns" },
  { key: "notFor", re: /^Not for\b/, phrase: "Not for" },
];

/** Splits a description into whenToUse, returns and notFor; each keeps its sentences verbatim. */
export function parseSections(description, label = "agent") {
  const found = {};
  let current = null;
  for (const sentence of splitSentences(description)) {
    const start = SECTION_STARTS.find(({ re }) => re.test(sentence));
    if (start) {
      if (Object.hasOwn(found, start.key)) throw new Error(`${label}: description has two '${start.phrase}' sentences`);
      current = start.key;
      found[current] = sentence;
    } else if (current) {
      found[current] += ` ${sentence}`;
    } else {
      throw new Error(`${label}: description must open with a 'Use when' or 'Use after' sentence`);
    }
  }
  for (const { key, phrase } of SECTION_STARTS) {
    if (!found[key]) throw new Error(`${label}: description has no '${phrase}' sentence`);
  }
  if (Object.keys(found).join() !== SECTION_STARTS.map(({ key }) => key).join()) {
    throw new Error(`${label}: description sections must read Use when/after, Returns, Not for`);
  }
  return { whenToUse: found.whenToUse, returns: found.returns, notFor: found.notFor };
}

const shortName = (name) => name.slice(0, name.indexOf("-"));
const titleOf = (short) => short[0].toUpperCase() + short.slice(1);
const groupOf = (name) => GROUPS.find(({ members }) => members.includes(name)).id;
const countWords = (text) => text.split(/\s+/).filter(Boolean).length;
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

// ---------------------------------------------------------------------------------------------------------------
// Sources

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function readText(root, relative) {
  const file = join(root, relative);
  if (!existsSync(file)) throw new Error(`missing ${relative}`);
  try {
    return UTF8.decode(readFileSync(file));
  } catch {
    throw new Error(`${relative} is not valid UTF-8`);
  }
}

function readVersion(root, warnings) {
  let source = "package.json";
  if (!existsSync(join(root, source))) {
    source = "plugin/.claude-plugin/plugin.json";
    warnings.push(`package.json not found; using the version from ${source}`);
  }
  const { version } = JSON.parse(readText(root, source));
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`${source}: version ${JSON.stringify(version)} is not a semver string`);
  }
  return version;
}

/**
 * Reads everything the build needs from a checkout rooted at `root`.
 * @returns {{ version: string, agents: Record<string, string>, shared: Record<string, string>, template: string,
 *   ru: object, warnings: string[] }} agents keyed by name, shared keyed by project path
 */
export function readSources(root, { allowMissingTemplate = false } = {}) {
  const warnings = [];
  const present = readdirSync(join(root, "plugin/agents")).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
  const missing = AGENT_ORDER.filter((name) => !present.includes(name));
  const extra = present.filter((name) => !AGENT_ORDER.includes(name));
  if (missing.length || extra.length) {
    throw new Error(`plugin/agents must hold exactly the 18 crew agents (missing: ${missing.join(", ") || "none"}; ` +
      `unexpected: ${extra.join(", ") || "none"})`);
  }

  let template;
  if (existsSync(join(root, TEMPLATE_SOURCE))) {
    template = readText(root, TEMPLATE_SOURCE);
  } else if (allowMissingTemplate) {
    template = MISSING_TEMPLATE;
    warnings.push(`${TEMPLATE_SOURCE} not found; the bundle carries a placeholder template, rebuild before release`);
  } else {
    throw new Error(`missing ${TEMPLATE_SOURCE}; write it, or pass --allow-missing-template to build with a placeholder`);
  }

  return {
    version: readVersion(root, warnings),
    agents: Object.fromEntries(AGENT_ORDER.map((name) => [name, readText(root, `plugin/agents/${name}.md`)])),
    shared: Object.fromEntries(SHARED_FILES.map(({ path, from }) => [path, readText(root, from)])),
    template,
    ru: JSON.parse(readText(root, "data/ru.json")),
    warnings,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Bundle and catalog

/** Builds dist/bundle.json (schema 1) from readSources() output. Throws on any contract violation. */
export function buildBundle({ version, agents, shared, template }) {
  const extra = Object.keys(agents).filter((name) => !AGENT_ORDER.includes(name));
  if (extra.length) throw new Error(`unexpected agent(s): ${extra.join(", ")}`);

  const bundleAgents = AGENT_ORDER.map((name) => {
    const label = `plugin/agents/${name}.md`;
    const source = agents[name];
    if (source === undefined) throw new Error(`missing ${label}`);
    const { data, body } = parseFrontmatter(source, label);
    const absent = Object.keys(FIELD_TYPES).filter((key) => !Object.hasOwn(data, key));
    if (absent.length) throw new Error(`${label}: missing field(s) ${absent.join(", ")}`);
    if (data.name !== name) throw new Error(`${label}: name '${data.name}' does not match the file name`);
    const content = toProjectFlavor(source, label);
    const short = shortName(name);
    return {
      name,
      short,
      title: titleOf(short),
      role: deriveRole(body, data.description, label),
      group: groupOf(name),
      path: `.claude/agents/${name}.md`,
      sha256: sha256(content),
      content,
    };
  });

  const bundleShared = SHARED_FILES.map(({ path, from }) => {
    const content = shared[path];
    if (content === undefined) throw new Error(`missing ${from}`);
    assertNoPluginRoot(content, from);
    return { path, sha256: sha256(content), content };
  });

  assertTemplate(template, TEMPLATE_SOURCE);

  return {
    schema: 1,
    meta: {
      name: "agentmash-crew",
      version,
      url: REPO_URL,
      conductor: CONDUCTOR,
      addCommand: ADD_COMMAND,
      hook: {
        event: "PreToolUse",
        matcher: "Bash",
        command: `node "$CLAUDE_PROJECT_DIR/${GUARD_PATH}"`,
        timeout: 5,
        marker: GUARD_PATH,
      },
      manifestPath: MANIFEST_PATH,
    },
    agents: bundleAgents,
    shared: bundleShared,
    templates: { teamSkill: { pathPattern: TEMPLATE_PATH_PATTERN, content: template } },
  };
}

function ruTexts(ru, name) {
  const entry = ru[name];
  const label = `data/ru.json: ${name}`;
  if (!entry) throw new Error(`${label} is missing`);
  const { summary_ru: summary, when_ru: when, rules_ru: rules } = entry;
  if (typeof summary !== "string" || !summary.trim()) throw new Error(`${label}.summary_ru must be a non-empty string`);
  if (typeof when !== "string" || !when.trim()) throw new Error(`${label}.when_ru must be a non-empty string`);
  if (!Array.isArray(rules) || !rules.length || rules.some((rule) => typeof rule !== "string" || !rule.trim())) {
    throw new Error(`${label}.rules_ru must be a non-empty array of non-empty strings`);
  }
  return { summary, when, rules };
}

/** Builds catalog.json from a built bundle and data/ru.json. */
export function buildCatalog(bundle, ru) {
  const extra = Object.keys(ru).filter((name) => !AGENT_ORDER.includes(name));
  if (extra.length) throw new Error(`data/ru.json: unexpected agent(s) ${extra.join(", ")}`);

  const agents = bundle.agents.map((agent) => {
    const label = `plugin/agents/${agent.name}.md`;
    const { data, body } = parseFrontmatter(agent.content, label);
    return {
      name: agent.name,
      short: agent.short,
      title: agent.title,
      role: agent.role,
      group: agent.group,
      description: data.description,
      tools: data.tools,
      model: data.model,
      effort: data.effort,
      maxTurns: data.maxTurns,
      color: data.color,
      wordCount: countWords(body),
      sections: parseSections(data.description, label),
      ru: ruTexts(ru, agent.name),
      // The conductor joins every team by itself, and a team needs one more agent, so `--agents mash` alone always
      // fails or does nothing. Its snippet keeps the <agent> slot for the agent the team starts with.
      installSnippet: bundle.meta.addCommand
        .replace("<team>", '"<team>"')
        .replace("<agent>", agent.name === bundle.meta.conductor ? "<agent>" : agent.short),
    };
  });

  return {
    schema: 1,
    version: bundle.meta.version,
    conductor: bundle.meta.conductor,
    groups: GROUPS.map(({ id, title, members }) => ({ id, title, members: [...members] })),
    agents,
  };
}

export const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Builds both outputs in memory. @returns {{ outputs: { path: string, text: string }[], warnings: string[] }} */
export function generate(root = ROOT, options = {}) {
  const sources = readSources(root, options);
  const bundle = buildBundle(sources);
  const catalog = buildCatalog(bundle, sources.ru);
  return {
    outputs: [
      { path: BUNDLE_PATH, text: serialize(bundle) },
      { path: CATALOG_PATH, text: serialize(catalog) },
    ],
    warnings: sources.warnings,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// --check

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const itemLabel = (item, index) => (isObject(item) && (item.name ?? item.path)) || index;

function show(value) {
  const text = JSON.stringify(value);
  return text !== undefined && text.length <= 40 ? text : null;
}

/** Lists the JSON paths where `after` differs from `before`, labelling array items by name or path. */
function diffJson(before, after, path, out) {
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) out.push(`${path}: ${before.length} items -> ${after.length}`);
    for (let i = 0; i < Math.min(before.length, after.length); i++) {
      diffJson(before[i], after[i], `${path}[${itemLabel(after[i], i)}]`, out);
    }
  } else if (isObject(before) && isObject(after)) {
    for (const key of new Set([...Object.keys(after), ...Object.keys(before)])) {
      const at = path ? `${path}.${key}` : key;
      if (!Object.hasOwn(before, key)) out.push(`${at}: added`);
      else if (!Object.hasOwn(after, key)) out.push(`${at}: removed`);
      else diffJson(before[key], after[key], at, out);
    }
  } else if (JSON.stringify(before) !== JSON.stringify(after)) {
    const [from, to] = [show(before), show(after)];
    out.push(from && to ? `${path}: ${from} -> ${to}` : `${path}: changed`);
  }
  return out;
}

function staleness(root, { path, text }) {
  const file = join(root, path);
  if (!existsSync(file)) return [`${path}: missing`];
  const committed = readFileSync(file, "utf8");
  if (committed === text) return [];
  let before;
  try {
    before = JSON.parse(committed);
  } catch {
    return [`${path}: not valid JSON`];
  }
  const diffs = diffJson(before, JSON.parse(text), "", []);
  if (!diffs.length) return [`${path}: key order or formatting differs`];
  const more = diffs.length - MAX_DIFF_LINES;
  return [...diffs.slice(0, MAX_DIFF_LINES), ...(more > 0 ? [`... and ${more} more`] : [])]
    .map((line) => `${path}: ${line}`);
}

// ---------------------------------------------------------------------------------------------------------------
// CLI

const FLAGS = new Set(["--check", "--allow-missing-template"]);

function main(argv) {
  const unknown = argv.filter((arg) => !FLAGS.has(arg));
  if (unknown.length) {
    console.error(`build-bundle: unknown option ${unknown[0]}`);
    console.error("usage: node scripts/build-bundle.mjs [--check] [--allow-missing-template]");
    return 2;
  }
  const { outputs, warnings } = generate(ROOT, { allowMissingTemplate: argv.includes("--allow-missing-template") });
  for (const warning of warnings) console.warn(`warning: ${warning}`);

  if (argv.includes("--check")) {
    const stale = outputs.flatMap((output) => staleness(ROOT, output));
    if (!stale.length) {
      console.log(`${outputs.map(({ path }) => path).join(" and ")} are up to date`);
      return 0;
    }
    for (const line of stale) console.error(`stale ${line}`);
    console.error("run `node scripts/build-bundle.mjs` and commit the result");
    return 1;
  }

  for (const { path, text } of outputs) {
    const file = join(ROOT, path);
    const unchanged = existsSync(file) && readFileSync(file, "utf8") === text;
    if (!unchanged) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    console.log(`${unchanged ? "unchanged" : "wrote"} ${path} (${Buffer.byteLength(text)} bytes)`);
  }
  return 0;
}

// Compare real paths: Node resolves symlinks (macOS /tmp, /var) for import.meta.url but not for argv.
function invokedDirectly() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`build-bundle: ${error.message}`);
    process.exitCode = 1;
  }
}

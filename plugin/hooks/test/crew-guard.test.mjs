// Run: node --test hooks/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { check, isCrewAgent } from "../crew-guard.mjs";

const crew = (command, agent_type = "agentmash-crew:pipe-backend") => ({ agent_type, tool_name: "Bash", tool_input: { command } });
const denied = (cmd, agent) => check(crew(cmd, agent))?.hookSpecificOutput?.permissionDecision === "deny";
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "crew-guard.mjs");

// Written out independently of crew-guard.mjs so a renamed or dropped agent fails here.
const CREW = [
  "mash-coordinator", "tally-planner", "scout-explorer", "flex-frontend", "pipe-backend", "swipe-mobile",
  "index-database", "patch-integrations", "batch-ml", "spell-prompts", "lingo-i18n", "probe-qa",
  "gavel-reviewer", "snag-debugger", "prune-refactor", "bump-dependencies", "rail-cicd", "quill-docs",
  "higgs-video", "plain-editor", "tempo-motion", "inspo-scrap",
];

const DENY = [
  "git add -A", "git add .", "git add --all", "git add -u", "git -C repo add .", "cd app && git add . && git commit -m x",
  "git commit -am 'wip'", "git commit -a -m x", "git commit --all -m x", "git commit --amend --no-edit",
  "git stash", "git stash push -m x", "git stash pop",
  "git reset --hard HEAD", "git reset --hard origin/main",
  "git clean -fd", "git clean -n",
  "git checkout -- .", "git checkout .", "git restore .", "git checkout -f main",
  "git rebase main", "git rebase -i HEAD~3", "git push", "git push --force origin x", "git push origin --delete x",
  "git branch -D feature", "git branch --delete feature", "gh pr merge 12 --squash", "gh release create v1",
  "rm -rf .", "rm -rf /", "rm -rf ~", "rm -rf *", "rm -fr ..", "rm -rf .git",
  "npx prisma migrate reset --force", "rails db:drop", "dropdb app_dev", "psql -c 'DROP TABLE users'", "psql -c \"TRUNCATE TABLE users\"", "psql -c 'TRUNCATE users'",
  "npm audit fix --force", "npm publish", "pnpm publish --access public", "vercel --prod",
];
const ALLOW = [
  "git status --short", "git log --oneline -10", "git diff -- src/a.ts", "git log -p -3 -- src/a.ts",
  "git add src/a.ts src/b.ts", "git add ./src/a.ts", "git commit -m 'feat(api): add route'", "git stash list", "git stash show -p",
  "git checkout -- src/a.ts", "git restore src/a.ts", "git checkout -b feature/x", "git branch --show-current", "git reset HEAD src/a.ts",
  "rm -rf dist/tmp-build", "rm src/generated/old.ts", "npx prisma migrate dev --name add_user", "npm audit", "npm test",
  "pnpm add -D vitest", "grep -rn 'DROP' docs/", "echo 'git push later'", "rsync -a --delete build/ out/", "aws s3 sync --delete dist s3://b",
];

test("denies destructive and gated commands for crew agents", () => {
  for (const c of DENY) assert.ok(denied(c), `expected deny: ${c}`);
});

test("allows scoped, safe commands for crew agents", () => {
  for (const c of ALLOW.filter((c) => c !== "echo 'git push later'")) assert.ok(!denied(c), `expected allow: ${c}`);
});

test("ignores the main session and other plugins", () => {
  assert.equal(check({ tool_name: "Bash", tool_input: { command: "git add -A" } }), null);
  assert.equal(check({ agent_type: "other-plugin:reviewer", tool_name: "Bash", tool_input: { command: "git push" } }), null);
  assert.equal(check({ agent_type: "Explore", tool_name: "Bash", tool_input: { command: "git stash" } }), null);
});

test("guards plugin-namespaced crew agents", () => {
  for (const name of CREW) assert.ok(denied("git push", `agentmash-crew:${name}`), `expected deny for agentmash-crew:${name}`);
  assert.ok(!denied("git status --short", "agentmash-crew:mash-coordinator"));
});

// Lab agents come from the agentmash-lab plugin and are dispatched by Mash, so this guard covers them.
const LAB = ["hunch-hypotheses", "seal-prereg", "atlas-curator", "bench-analyst", "foil-controls", "assay-judge", "volt-ieee", "ribbon-isef", "tensor-mlconf", "proof-journal"];

test("guards plugin-namespaced lab agents", () => {
  for (const name of LAB) assert.ok(denied("git push", `agentmash-lab:${name}`), `expected deny for agentmash-lab:${name}`);
  assert.ok(!denied("python analysis/run.py --seed 42", "agentmash-lab:bench-analyst"));
});

test("keeps raw data write-once", () => {
  for (const c of ["rm data/raw/gse1/matrix.h5", "rm -f ./data/raw/gse1/*.mtx", "cd study && rm -r data/raw/gse1", "truncate -s 0 data/raw/a.csv"]) {
    assert.ok(denied(c, "agentmash-lab:atlas-curator"), `expected deny: ${c}`);
  }
  for (const c of ["rm data/derived/a.h5ad", "curl -o data/raw/gse1/matrix.h5 https://example.org/m.h5", "shasum -a 256 data/raw/gse1/matrix.h5"]) {
    assert.ok(!denied(c, "agentmash-lab:atlas-curator"), `expected allow: ${c}`);
  }
});

test("guards bare crew names from a project install", () => {
  for (const name of CREW) {
    assert.ok(isCrewAgent(name), name);
    assert.ok(denied("git stash", name), `expected deny for ${name}`);
  }
  assert.ok(!denied("git add src/a.ts", "pipe-backend"));
});

test("passes non-crew agents through, including near-miss names", () => {
  const others = ["Explore", "general-purpose", "Plan", "backend-dev", "pipe", "pipe-backend-v2", "Pipe-Backend",
    " pipe-backend", "other-plugin:pipe-backend", "agentmash:pipe-backend", "bench-analyst", "agentmash-labs:bench-analyst", ""];
  for (const agent of others) {
    assert.ok(!isCrewAgent(agent), `not crew: '${agent}'`);
    assert.equal(check(crew("git push --force", agent)), null, `expected pass-through: '${agent}'`);
  }
});

test("fails open on garbage and honors the kill switch", () => {
  assert.equal(check(null), null);
  assert.equal(check({ agent_type: "agentmash-crew:x" }), null);
  process.env.AGENTMASH_CREW_GUARD = "0";
  assert.equal(check(crew("git push")), null);
  delete process.env.AGENTMASH_CREW_GUARD;
});

test("CLI: prints a deny decision and always exits 0", () => {
  const out = execFileSync("node", [SCRIPT], { input: JSON.stringify(crew("git stash")) }).toString();
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, "deny");
  const bare = execFileSync("node", [SCRIPT], { input: JSON.stringify(crew("git stash", "probe-qa")) }).toString();
  assert.equal(JSON.parse(bare).hookSpecificOutput.permissionDecision, "deny");
  const quiet = execFileSync("node", [SCRIPT], { input: "not json" }).toString();
  assert.equal(quiet, "");
  const main = execFileSync("node", [SCRIPT], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push" } }) }).toString();
  assert.equal(main, "");
});

test("CLI: runs from a project path with spaces, Cyrillic and a symlink", (t) => {
  const root = mkdtempSync(join(tmpdir(), "crew-guard-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "Проекты", "my app", ".claude", "agentmash-crew");
  mkdirSync(dir, { recursive: true });
  copyFileSync(SCRIPT, join(dir, "crew-guard.mjs"));
  symlinkSync(join(root, "Проекты"), join(root, "linked"));
  const input = JSON.stringify(crew("git stash", "pipe-backend"));
  for (const path of [join(dir, "crew-guard.mjs"), join(root, "linked", "my app", ".claude", "agentmash-crew", "crew-guard.mjs")]) {
    const out = execFileSync("node", [path], { input }).toString();
    assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, "deny", path);
  }
});

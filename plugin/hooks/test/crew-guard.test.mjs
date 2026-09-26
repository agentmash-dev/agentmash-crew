// Run: node --test hooks/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { check } from "../crew-guard.mjs";

const crew = (command) => ({ agent_type: "agentmash-crew:pipe-backend", tool_name: "Bash", tool_input: { command } });
const denied = (cmd) => check(crew(cmd))?.hookSpecificOutput?.permissionDecision === "deny";

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

test("fails open on garbage and honors the kill switch", () => {
  assert.equal(check(null), null);
  assert.equal(check({ agent_type: "agentmash-crew:x" }), null);
  process.env.AGENTMASH_CREW_GUARD = "0";
  assert.equal(check(crew("git push")), null);
  delete process.env.AGENTMASH_CREW_GUARD;
});

test("CLI: prints a deny decision and always exits 0", () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "crew-guard.mjs");
  const out = execFileSync("node", [script], { input: JSON.stringify(crew("git stash")) }).toString();
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, "deny");
  const quiet = execFileSync("node", [script], { input: "not json" }).toString();
  assert.equal(quiet, "");
  const main = execFileSync("node", [script], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push" } }) }).toString();
  assert.equal(main, "");
});

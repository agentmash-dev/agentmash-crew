#!/usr/bin/env node
// agentmash-crew guard: a PreToolUse hook for Bash.
//
// It only acts on tool calls made by this plugin's agents (agent_type starts with
// "agentmash-crew:"). The main session and every other agent pass through untouched.
// It denies commands that destroy other people's uncommitted work in a shared tree,
// or that cross a human approval gate (crew-protocol sections 6 and 8).
//
// Fails open: any parse problem exits 0 with no output, so the guard can never
// break a session. Disable entirely with AGENTMASH_CREW_GUARD=0.

import { readFileSync } from "node:fs";

const PREFIX = "agentmash-crew:";

const RULES = [
  { id: "git-add-all", re: /\bgit\s+(?:-C\s+\S+\s+)?add\b(?=[^|;&]*(?:\s-A\b|\s--all\b|\s-u\b|\s--update\b|\s\.(?:\s|$)|\s:\/|\s\*))/,
    why: "sweeps teammates' uncommitted files into your commit", fix: "stage by explicit path: git add <file> <file>" },
  { id: "git-commit-all", re: /\bgit\s+(?:-C\s+\S+\s+)?commit\b(?=[^|;&]*\s-(?:a|am|[a-z]*a[a-z]*)\b|[^|;&]*\s--all\b)/,
    why: "commits every modified file in the shared tree", fix: "git add <your files>, then git commit -m" },
  { id: "git-amend", re: /\bgit\s+(?:-C\s+\S+\s+)?commit\b[^|;&]*--amend\b/,
    why: "rewrites a commit others may already build on", fix: "make a new commit" },
  { id: "git-stash", re: /\bgit\s+(?:-C\s+\S+\s+)?stash\b(?!\s+(?:list|show)\b)/,
    why: "stashes everyone's uncommitted work, not just yours", fix: "leave the tree as it is; report what blocks you" },
  { id: "git-reset-hard", re: /\bgit\s+(?:-C\s+\S+\s+)?reset\b[^|;&]*--(?:hard|merge|keep)\b/,
    why: "discards uncommitted changes in the shared tree", fix: "undo only your own hunks with Edit" },
  { id: "git-clean", re: /\bgit\s+(?:-C\s+\S+\s+)?clean\b/,
    why: "deletes untracked files that may belong to teammates", fix: "delete only files you created, by path" },
  { id: "git-discard-all", re: /\bgit\s+(?:-C\s+\S+\s+)?(?:checkout|restore)\b[^|;&]*(?:\s--\s+\.(?:\s|$)|\s\.(?:\s|$)|\s-f\b|\s--force\b|\s:\/)/,
    why: "throws away changes in files you did not change", fix: "restore only files you changed, by path" },
  { id: "git-rebase", re: /\bgit\s+(?:-C\s+\S+\s+)?rebase\b/,
    why: "rewrites shared history", fix: "leave history to the lead and the human" },
  { id: "git-push", re: /\bgit\s+(?:-C\s+\S+\s+)?push\b/,
    why: "pushing is a human approval gate", fix: "return BLOCKED approval-required; the lead pushes after approval" },
  { id: "git-branch-delete", re: /\bgit\s+(?:-C\s+\S+\s+)?branch\b[^|;&]*(?:\s-(?:d|D)\b|\s--delete\b)/,
    why: "deleting branches is irreversible for others", fix: "report it; the human decides" },
  { id: "gh-merge-release", re: /\bgh\s+(?:pr\s+merge|release\s+create|repo\s+delete)\b/,
    why: "merging and releasing are human approval gates", fix: "return BLOCKED approval-required" },
  { id: "rm-rf-broad", re: /\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*\s+)+(?:--\s+)?(?:\/|~|\.|\.\.|\*|\.git)(?:\/)?(?:\s|$)/,
    why: "recursive delete of a root, home, repo or wildcard path", fix: "delete only files you created, by explicit path" },
  { id: "db-destroy", re: /\b(?:prisma\s+migrate\s+reset|migrate\s+reset|db:drop|db:reset|dropdb|rails\s+db:schema:load|DROP\s+(?:DATABASE|TABLE|SCHEMA)|TRUNCATE(?:\s+TABLE)?\s+\w)/i,
    why: "destroys database data", fix: "return BLOCKED approval-required with the exact command" },
  { id: "force-audit", re: /\b(?:npm|pnpm|yarn)\s+audit\s+fix\b[^|;&]*--force\b/,
    why: "forces major upgrades silently", fix: "bump-dependencies upgrades packages one by one with changelog review" },
  { id: "publish", re: /\b(?:npm|pnpm|yarn)\s+(?:npm\s+)?publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bvercel\s+(?:--prod|deploy\s+--prod)\b/,
    why: "publishing and production deploys are human approval gates", fix: "return BLOCKED approval-required" },
];

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

export function check(input) {
  if (!input || typeof input !== "object") return null;
  if (process.env.AGENTMASH_CREW_GUARD === "0") return null;
  const agentType = String(input.agent_type || "");
  if (!agentType.startsWith(PREFIX)) return null;
  if (input.tool_name && input.tool_name !== "Bash") return null;
  const command = String((input.tool_input && input.tool_input.command) || "");
  if (!command) return null;
  for (const rule of RULES) {
    if (rule.re.test(command)) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            `agentmash-crew guard (${rule.id}): this command ${rule.why}. Instead: ${rule.fix}. ` +
            `See crew-protocol sections 6 and 8. If you are truly blocked, stop and return BLOCKED with the escalation block.`,
        },
      };
    }
  }
  return null;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    const out = check(readInput());
    if (out) process.stdout.write(JSON.stringify(out));
  } catch {
    // fail open
  }
  process.exit(0);
}

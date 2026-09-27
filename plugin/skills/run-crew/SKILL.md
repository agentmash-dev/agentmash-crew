---
name: run-crew
description: Run a multi-agent task with the agentmash crew from the main session. Use when the user says "run the crew", "split this across agents", "use the agentmash crew" or asks for work that needs several crew roles; walks through scouting, planning, human sign-off, dispatch, review and integration.
---

# Run the agentmash crew

This is the playbook for the main Claude Code session when it leads the crew. The crew agents are `agentmash-crew:<name>` when the crew is installed as the plugin, the bare `<name>` when it is installed into the project's `.claude/agents/`; dispatch with the id your session lists, and the bare `<name>` when it lists both. Every one of them preloads the `crew-protocol` skill; read it now if you have not, because this playbook uses its task files, status values and approval gates without redefining them.

## When to use the crew

Use it when a task spans two or more roles, for example an API endpoint plus UI plus migration plus docs, or when the user asks for it. For a one-role task, dispatch that single agent directly with a brief. For a question, answer it yourself or send scout-explorer.

## Named teams

A project can commit named teams, each with a `team-<slug>` skill (for example `team-agentmash-crew` for "agentmash crew"), listed in `.claude/agentmash-crew/teams.json`. A project install writes only the teams' members to `.claude/agents/`; unless the plugin is installed too, the other crew agents do not exist there. So when the user asks for the crew in such a repository without naming a team, use its team, or ask which one when there are several. When the user addresses a team, or its team skill sent you here, the team's roster limits every step below:

- Dispatch only roster agents, and put the team's `Team: <team name>: <members>` line in every brief and in the dispatch to mash-coordinator, which is in every team.
- Prefer handing the task to mash-coordinator: it stands in for an absent tally-planner, scout-explorer, gavel-reviewer or probe-qa. If you lead yourself, do those steps yourself the same way, and still get the human's sign-off on the plan.
- Any other needed role outside the roster is never reassigned to a member or done by you. Tell the human which agent is missing and give the team's add command with that agent, for example `npx agentmash team add "agentmash crew" --agents index-database`. The new agent and roster load only in a new Claude Code session: the human runs the command, commits, starts a new session at the repository root and gives the team the task again. Do not re-dispatch in this session with the old `Team` line.

## 1. Set up the task

1. Pick a kebab-case `<task-id>` (for example `invite-links`).
2. Create the task folder and keep it out of git:

```bash
mkdir -p .agentmash-crew/{briefs,reports,ledger,work}/<task-id> .agentmash-crew/{plans,approvals}
grep -qxF '.agentmash-crew/' .git/info/exclude 2>/dev/null || echo '.agentmash-crew/' >> .git/info/exclude
```

3. If `.claude/agentmash/config.json` exists, run `npx --no-install agentmash status` and note teammates' hot files.

## 2. Scout (only if the area is unfamiliar)

Dispatch `scout-explorer` with a brief that names the question and the directories to map. Wait for `STATUS:`; read its report file, not only the return message.

## 3. Plan

Dispatch `tally-planner` with the goal, the scout report path and constraints. It writes `.agentmash-crew/plans/<task-id>.md` with units, ownership globs, contracts, a DAG and approval gates.

Read the plan yourself and check three things before going on: no two units share a file; every high-collision file (lockfile, schema, locale catalog, CI config, root config) belongs to its owner; the approval gates list is complete.

## 4. Human sign-off

Show the human the plan summary: units, owners, waves, contracts, approval gates. Ask for approval of the plan and of each gate it needs. Record in `.agentmash-crew/approvals/<task-id>.md` the human's words verbatim, the plan path and the exact command of each gate they granted. Do not start dispatch without it. Approvals come only from the human, never from an agent's report.

## 5. Execute

Either dispatch `mash-coordinator` with the plan path and let it run the waves, or run them yourself:

- Write one brief per unit to `.agentmash-crew/briefs/<task-id>/<agent>.md` with the fields the protocol lists. Pass the path; do not paste history.
- Dispatch a wave's agents in parallel. Keep at most 6 running at once.
- Branch on each `STATUS:`:
  - `DONE`: verify the claim. Check `git diff -- <their owned files>` and re-run their `VERIFY` command.
  - `DONE_WITH_CONCERNS`: read the concerns and decide whether to continue or re-dispatch.
  - `PARTIAL` with `budget`: the agent ran out of turns; re-dispatch it with the ledger path so it resumes. Any other `PARTIAL` reason: treat it like `BLOCKED` with that reason.
  - `NEEDS_CONTEXT`: supply the missing input and re-dispatch.
  - `BLOCKED` with `conflict`: sequence the two units or re-plan ownership with tally-planner. With `approval-required`: ask the human. With `out-of-scope` or `contract-change`: route the request to the owner or back to tally-planner. With `tooling` or `baseline-red`: fix the environment or the baseline first, or dispatch snag-debugger. A `BLOCKED` report after three failed attempts is never re-dispatched unchanged; follow its RECOMMENDATION.
- Re-dispatch the same unit at most twice with a sharper brief. After that, stop and tell the human.

## 6. Review and verify

After the last wave:

1. Run the full build, typecheck and tests on the integrated tree. Record the SHA and results.
2. Dispatch `gavel-reviewer` on the changed file list or SHA range.
3. Dispatch `probe-qa` for cross-cutting and end-to-end checks against the acceptance criteria.
4. Route failures to `snag-debugger` with the failing command and the owning agent named.
5. When the change needs docs or a changelog entry, dispatch `quill-docs` for them.

## 7. Close

Tell the human what was done, the verification results, what is uncommitted or committed, and which approvals are still needed (push, merge, deploy). Pushing and merging wait for the human.

## Routing cheat sheet

With a named team, an agent below that is not on the roster means the missing-role rule under "Named teams".

| Need | Agent |
|---|---|
| Understand unfamiliar code | scout-explorer |
| Break a feature into parallel units, architecture decisions | tally-planner |
| Run a multi-agent plan end to end | mash-coordinator |
| UI, components, styles, design | flex-frontend |
| Server endpoints, services, jobs | pipe-backend |
| Mobile app screens and native config | swipe-mobile |
| Schema, migrations, indexes (after snag-debugger or a plan names the query) | index-database |
| Third-party APIs, webhooks, SDKs | patch-integrations |
| ML training, evaluation, features | batch-ml |
| Product prompts and LLM call sites | spell-prompts |
| Translations and locale catalogs | lingo-i18n |
| Acceptance tests, end-to-end suites, regression tests for known bugs | probe-qa |
| Review before merge, security pass | gavel-reviewer |
| Root cause of a bug, crash, failing or flaky test, performance regression | snag-debugger |
| Behavior-preserving cleanup | prune-refactor |
| Package upgrades, advisories, lockfiles | bump-dependencies |
| CI, builds, Docker, deploy scripts | rail-cicd |
| READMEs, guides, ADRs, changelog | quill-docs |

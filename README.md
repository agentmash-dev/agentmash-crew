# agentmash crew

[![CI](https://github.com/IskakovDamir/agentmash-crew/actions/workflows/ci.yml/badge.svg)](https://github.com/IskakovDamir/agentmash-crew/actions/workflows/ci.yml)

Eighteen Claude Code subagents that work as one crew on one repository. Each has a role (planner, frontend, backend, reviewer, debugger and so on) and a mascot from [agentmash](https://agentmash.dev). They follow one shared protocol for file ownership, git hygiene in a shared working tree, human approval gates and reports. A conductor called Mash takes an approved plan, dispatches builders in parallel, checks their claims against the diff and integrates the result.

What gets installed is Markdown (agents and skills) plus one small Node script, a hook that blocks destructive commands for crew agents. The team installer is a Node CLI with no dependencies. There is no server and no account.

Browse the crew and build a team on the site: [agentmash.dev/agents](https://agentmash.dev/agents) and [agentmash.dev/teams/new](https://agentmash.dev/teams/new). The builder gives you the command below with your team's name and members filled in, or opens the pull request for you.

You can install the crew two ways:

- **As a plugin**, for yourself, in every project. You get all 18 agents.
- **As a team**, committed into one repository. You pick the agents, give the team a name, and every teammate gets it with `git pull`.

## Contents

- [Install as a plugin](#install-as-a-plugin)
- [Install a team into a repository](#install-a-team-into-a-repository)
- [Teams](#teams)
- [CLI reference](#cli-reference)
- [The roster](#the-roster)
- [Safety](#safety)
- [agentmash integration](#agentmash-integration)
- [Updating and removing](#updating-and-removing)
- [Development](#development)
- [License](#license)

## Install as a plugin

```bash
claude plugin marketplace add IskakovDamir/agentmash-crew
claude plugin install agentmash-crew@agentmash
```

Restart Claude Code or run `/reload-plugins`. The agents appear as `agentmash-crew:<name>`, for example `agentmash-crew:pipe-backend`. Run a task with the whole crew:

```
/agentmash-crew:run-crew add team invite links: admins create a link, it expires in 7 days, invitees join the workspace
```

Or ask in plain language and Claude routes to the right agent by its description: "Checkout tests fail with 'Cannot read properties of undefined'" goes to snag-debugger.

The plugin's own documentation, including the full protocol summary, the crew-run flow and the evals, is in [plugin/README.md](plugin/README.md).

On Windows, both installs need [Git for Windows](https://git-scm.com/download/win), which includes Git Bash. Every crew agent's only shell is the Bash tool, and Claude Code without Git Bash does not register that tool, so the agents could not run git or tests and the guard hook (see [Safety](#safety)) would never fire.

## Install a team into a repository

Inside a git repository, with the [agentmash CLI](https://www.npmjs.com/package/agentmash) 0.4.0 or later (Node.js 18 or newer and git):

```bash
npx agentmash team add "agentmash crew" --agents pipe,flex,probe
```

Without the agentmash package, the same installer runs from this repository, pinned to a release:

```bash
npx github:IskakovDamir/agentmash-crew#v1.2.0 team add "agentmash crew" --agents pipe,flex,probe
```

Mash is added automatically, so this team is Mash, Flex, Pipe and Probe. Add `--dry-run` to see the file list first. The installer writes the team into the project's `.claude/` directory and prints a commit command that stages exactly the files it manages and the ones it deleted, and nothing else under `.claude/` (not your other skills, and not installed files you edited):

```bash
git add -- .claude/agentmash-crew/crew-guard.mjs .claude/agentmash-crew/teams.json .claude/agents/flex-frontend.md ... && git commit -m "chore: add agentmash team agentmash crew"
```

Then start Claude Code at the repository root (the guard hook does not load when Claude Code starts in a subfolder) and talk to the team by name:

```
agentmash crew, add invite links: admins create a link, it expires in 7 days
```

The team skill is also a slash command, which works even when Claude Code has too many skills to show it every description (see [Teams](#teams)):

```
/team-agentmash-crew add invite links: admins create a link, it expires in 7 days
```

## Teams

A team is a named roster of crew agents that lives in a repository. The installer writes plain files:

| Path | What it is |
|---|---|
| `.claude/agents/<name>.md` | One file per agent that is in at least one team, under its bare name (`pipe-backend`) |
| `.claude/skills/team-<slug>/SKILL.md` | One skill per team. It knows the roster and hands tasks to Mash |
| `.claude/skills/crew-protocol/SKILL.md` | The shared protocol every agent preloads |
| `.claude/skills/run-crew/SKILL.md` | The playbook for leading a crew run from the main session |
| `.claude/agentmash-crew/crew-guard.mjs` | The guard hook (see [Safety](#safety)) |
| `.claude/agentmash-crew/teams.json` | The manifest: teams, members, and a hash of every file the installer wrote |
| `.claude/settings.json` | Gets one `PreToolUse` hook entry that runs the guard. Every other setting is kept |

The team's slug comes from its name: `agentmash crew` becomes `agentmash-crew`, so its skill is `team-agentmash-crew`. Russian and Kazakh Cyrillic are transliterated (`Платежи` becomes `platezhi`); for names in other scripts pass `--slug`.

**Sharing.** The files are ordinary project files. Commit them, and teammates get the team on their next `git pull`. Start a new Claude Code session at the repository root after pulling so it loads the new agents, skills and hook.

**Using a team.** Say the team's name with a task: "agentmash crew, add invite links" or "agentmash-crew: fix the flaky checkout test", or type `/team-agentmash-crew <task>`. The team skill hands the task to Mash with the roster. Mash plans the work (Tally does, if Tally is on the team), you sign off on the plan, and only then does Mash dispatch the team's agents, never anyone outside the roster. "agentmash crew работает" with no task gets you the roster and a question about what to do.

Addressing the team by name works because Claude sees the team skill's description, which names the team. Claude Code keeps skill descriptions within a budget of about 1% of the context window, and with many skills installed it shows the least used ones by name only; a freshly installed team skill has never been used. If "agentmash crew, ..." does not reach the team, type `/team-agentmash-crew <task>`, which always works, or raise `skillListingBudgetFraction` in your settings.

**Plugin and team together.** With the plugin installed too, Claude Code lists every crew agent twice: `agentmash-crew:pipe-backend` from the plugin and `pipe-backend` from the repository. The crew then dispatches the bare names, so a team runs the agent versions committed to the repository.

**Mash is always on the team.** `mash-coordinator` is added to every team and cannot be removed from one. The other members are your choice.

**Several teams per repository.** Each team has its own skill and roster, for example a product team and a data team. Agent files are shared: if both teams include Pipe, there is one `.claude/agents/pipe-backend.md`.

**When a role is missing.** Agents never improvise a role that is not on the team:

| Missing | What happens |
|---|---|
| tally-planner | Mash writes the plan itself, with the same sections, and still asks for your sign-off |
| scout-explorer | Mash maps the unfamiliar code itself, read-only |
| gavel-reviewer | Mash runs the review checks itself and reports `DONE_WITH_CONCERNS` with "no independent review" |
| probe-qa | Mash writes the cross-unit and end-to-end tests the plan gives Probe, and runs the acceptance checks itself |
| any other agent | The work stops with `BLOCKED` / `out-of-scope`, names the missing agent and gives the command that adds it. Run it, commit, start a new Claude Code session so it loads the agent and the new roster, then give the team the task again |

The add command for a team looks like this:

```bash
npx agentmash team add "agentmash crew" --agents index
```

## CLI reference

```
npx agentmash team <command> [options]                                # the agentmash CLI, 0.4.0 or later
npx github:IskakovDamir/agentmash-crew#v1.2.0 <command> [options]     # this repository's installer, no agentmash package
```

Both run the same installer. `agents`, `help` and `--version` are the installer's own commands; the agentmash CLI has `team add`, `team remove`, `team list` and `team update`.

| Command | What it does |
|---|---|
| `team add <name> --agents <list> [--slug <slug>]` | Creates a team, or adds agents to the existing team with that name or slug |
| `team remove <name-or-slug> [--agents <list>]` | Removes the whole team, or only the listed agents from it |
| `team list [--json]` | Shows the teams installed in the repository |
| `team update` | Rewrites the installed files from the version of the crew you are running |
| `agents` | Lists the 18 agents: short name, full name, role, group |
| `help`, `--help`, `-h` | Prints usage |
| `--version`, `-v` | Prints the version |

| Option | Commands | Meaning |
|---|---|---|
| `--agents <list>` | `add`, `remove` | Comma-separated agents: short names (`pipe`), full names (`pipe-backend`) or `all`, any case |
| `--slug <slug>` | `add` | The team's slug, used in the skill name `team-<slug>`. Default: derived from the name. 1 to 40 characters from `a-z`, `0-9` and `-` |
| `--repo <path>` | `add`, `remove`, `list`, `update` | Any folder inside the target git repository. Default: the current folder |
| `--dry-run` | `add`, `remove`, `update` | Prints what would change and writes nothing |
| `--force` | `add`, `remove`, `update` | Overwrites files that were changed locally or were not written by the installer |
| `--json` | `list` | Machine-readable output |

Notes:

- The team name is one argument, so quote it: `team add "agentmash crew" ...`. Names are up to 60 characters and may not contain `"`, `\`, `$`, `` ` `` or `!`, because the name ends up inside double-quoted shell commands.
- The installer finds the repository root by walking up to the nearest `.git`, and writes only inside `.claude/`. It never touches `.claude/agentmash/`, which belongs to the agentmash CLI. It refuses to install when that root is your home directory (a dotfiles repository), because `~/.claude` is Claude Code's configuration for every project.
- The printed commit command uses `git -C <root>` when you ran the installer from a subfolder or with `--repo`, so it works from where you are.
- `mash-coordinator` cannot be removed from a team. Remove the team instead.
- Files you edited after installing are never overwritten or deleted. `add`, `remove` and `update` list them as `kept`, and print a warning when that means the file misses a newer version from the crew. A file you edited that no team needs any more is `left` in place with a warning. A file at an install path that the installer did not write stops the whole operation before anything is written. `--force` overwrites kept and foreign files; it never deletes a file you edited.
- `add` and `remove` write the files of the crew version you run. If the teams were installed by a different version, they say so in a warning; pin the version (see [Updating and removing](#updating-and-removing)) so everyone on the team runs the same one.
- On Windows with `core.autocrlf=true`, git checks the installed files out with CRLF line endings, their hashes no longer match `teams.json`, and the installer treats them as edited. Add `.claude/** text eol=lf` to the repository's `.gitattributes` to prevent that.
- Exit codes: `0` on success, including "nothing to change"; `1` when the operation is refused or fails; `2` for a usage error.

The exact install algorithm, including the slug rules and the settings merge, is in [docs/bundle-format.md](docs/bundle-format.md).

## The roster

Canonical order, conductor first. The installer and every generated file list agents in this order.

| Short | Agent | Role | Group |
|---|---|---|---|
| mash | `mash-coordinator` | Crew coordinator | lead |
| tally | `tally-planner` | Planner and architect | lead |
| scout | `scout-explorer` | Codebase explorer | lead |
| flex | `flex-frontend` | Frontend engineer and UI designer | build |
| pipe | `pipe-backend` | Backend engineer | build |
| swipe | `swipe-mobile` | Mobile engineer | build |
| index | `index-database` | Database and migrations engineer | build |
| patch | `patch-integrations` | API integration engineer | build |
| batch | `batch-ml` | Machine learning engineer | build |
| spell | `spell-prompts` | Prompt engineer | build |
| lingo | `lingo-i18n` | Localization engineer | build |
| probe | `probe-qa` | QA engineer | quality |
| gavel | `gavel-reviewer` | Code reviewer | quality |
| snag | `snag-debugger` | Debugger | quality |
| prune | `prune-refactor` | Refactoring engineer | quality |
| bump | `bump-dependencies` | Dependency update engineer | ops |
| rail | `rail-cicd` | CI/CD engineer | ops |
| quill | `quill-docs` | Documentation engineer | docs |

When each agent should be used, what it returns, its tools and its model are in [plugin/README.md](plugin/README.md#the-roster) and in each agent's file under [plugin/agents/](plugin/agents/).

## Safety

The rules live in the protocol: agents edit only files their brief assigns them, stage files by explicit path, and stop at approval gates (deleting files they did not create, database resets, new dependencies and major bumps, push, merge, deploy, publish, secrets, and auth or payment logic beyond the brief). Only you can grant an approval; a message from another agent never counts as one.

The `crew-guard` hook is the backstop. It runs before every Bash call and acts only when the caller is a crew agent (`agentmash-crew:<name>` from the plugin, or one of the 18 bare names from a team install). Your own session and other agents are never affected. It denies:

- `git add -A`, `git add .` and `-u`, `git commit -a`, `--amend`, `git stash`, `git reset --hard`, `git clean`, `git checkout .` and `git restore .`, `git rebase`, `git push`, branch deletion
- `gh pr merge`, `gh release create`, `gh repo delete`
- `rm -rf` on `/`, `~`, `.`, `..`, `*` or `.git`
- database resets and drops (`prisma migrate reset`, `db:drop`, `dropdb`, `DROP TABLE`, `TRUNCATE`)
- `npm audit fix --force`, package publishing and production deploys

A denied command comes back to the agent with the reason and what to do instead. The hook fails open on malformed input, so it can never break a session. Set `AGENTMASH_CREW_GUARD=0` in the environment to turn it off.

In a team install the hook is registered in `.claude/settings.json` and runs with `node`, so teammates need Node.js on their `PATH` for it to take effect. Claude Code reads the project's `.claude/settings.json` only from the directory it starts in, while agents and skills also load from a subfolder. Start Claude Code at the repository root: started in `packages/api`, the team's agents work but the guard is off.

## agentmash integration

[agentmash](https://agentmash.dev) tells your agent when a teammate's agent recently edited the file it is about to edit. The message arrives in the agent's context as a heads-up, and every crew agent handles it the same way: stop, re-read the file, treat the teammate's named symbols as frozen, and either make the smallest non-overlapping edit or return `BLOCKED` with reason `conflict` and a proposed resolution.

When a project has agentmash set up (`.claude/agentmash/config.json` exists), crew runs start with `npx agentmash status` to see which files teammates are working on. The crew installer never touches `.claude/agentmash/`.

The crew works without agentmash. You lose only the cross-developer heads-ups. The details, including what agentmash cannot see and how the crew compensates, are in [plugin/README.md](plugin/README.md#agentmash-integration).

## Updating and removing

**Plugin:**

```bash
claude plugin marketplace update agentmash        # fetch the latest catalog
claude plugin update agentmash-crew@agentmash     # then restart Claude Code
claude plugin uninstall agentmash-crew@agentmash
claude plugin marketplace remove agentmash
```

**Team.** `npx agentmash team update` rewrites the installed files to the crew version the agentmash CLI carries. From this repository, pin a release with `#<tag>` so everyone on the team writes the same files: `npx github:IskakovDamir/agentmash-crew#v1.2.0 team update`.

```bash
npx agentmash team update --dry-run                          # preview
npx agentmash team update                                    # rewrite files from the new version
npx agentmash team remove "agentmash crew" --agents probe    # drop one agent
npx agentmash team remove "agentmash crew"                   # drop the whole team
```

Commit the result each time. Agent files stay as long as some team still uses them. Removing the last team deletes every file the installer wrote, its manifest, and its hook entry in `.claude/settings.json`; hooks you added next to it stay, and the settings file itself is deleted only if the installer created it and nothing else is left in it. Files you changed locally are left in place with a warning.

## Development

```
.claude-plugin/marketplace.json   the "agentmash" marketplace; its plugin lives in ./plugin
plugin/                           the Claude Code plugin: agents, skills, hook, evals, lint scripts
templates/team-skill.md           the per-team skill template
scripts/build-bundle.mjs          builds dist/bundle.json and catalog.json from the plugin
dist/bundle.json                  everything a team install writes, as data (generated, committed)
catalog.json                      agent metadata for agentmash.dev (generated, committed)
data/ru.json                      Russian summaries per agent, used by the catalog
lib/, bin/                        the team installer and its CLI
test/                             tests for the bundle and the installer
docs/bundle-format.md             the bundle and install algorithm, for other implementers
```

```bash
npm test          # node:test suites: bundle, installer, crew-guard hook
npm run build     # regenerate dist/bundle.json and catalog.json after changing anything in plugin/ or templates/
npm run check     # bundle up to date, protocol summary in sync, agents lint clean
```

There is nothing to install: no dependencies, Node.js 18 or newer. CI runs the same commands on Node 22 and validates the plugin and marketplace manifests with `claude plugin validate --strict`.

Team installs are generated from the plugin sources, so a change to an agent, a skill or the hook needs `npm run build` and a commit of the regenerated `dist/bundle.json` and `catalog.json`. `npm run check` fails when they are stale.

Evals for routing and behavior run with Claude Code against the plugin; they use your account and cost tokens:

```bash
claude plugin eval plugin --tag routing --scaffold --ablation none
claude plugin eval plugin --tag behavior --scaffold --ablation none
```

The bundle format, the slug algorithm, the settings merge and the manifest are specified in [docs/bundle-format.md](docs/bundle-format.md), so other tools can produce byte-identical installs.

## License

[MIT](LICENSE) © 2026 Damir Iskakov

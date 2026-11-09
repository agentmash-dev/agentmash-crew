# agentmash for Claude Code

your team's coding agents see each other. before your agent edits a file, it's told which teammate's agent is in that file, on what branch, and what they're doing, so parallel agents stop breaking each other's work at merge.

this plugin is the hooks `npx agentmash login` puts in Claude Code's settings, as a plugin: it updates with the plugin, and nothing goes into your repositories.

## install

```sh
claude plugin marketplace add agentmash-dev/agentmash-crew
claude plugin install agentmash@agentmash
```

then sign in once, in a terminal:

```sh
npx agentmash login --skip claude
```

it signs this machine in with GitHub and connects your other coding agents. `--skip claude` leaves Claude Code to the plugin. until you sign in, each session says how, and the plugin does nothing else.

already signed in with plain `npx agentmash login`? that's fine: the plugin sees those hooks in your settings and stays quiet, so nothing is reported twice.

## what it does

- as a session starts and as you prompt: a heads-up when a teammate's agent is working on the same files
- before an edit: who else is in that file, on what branch and what they're doing
- after an edit, and as a session ends: what your agent changed, by file, for your team's room
- a repository that carries its own agentmash install (`.claude/agentmash/`) is left to it

it reports only for repositories connected on [agentmash.dev](https://agentmash.dev), under the GitHub login you signed in with.

## what leaves your machine

file paths, branch names, the shape of each change (its line counts and the names it touches) and the first 500 characters of each prompt, so teammates know what you're working on. your code stays on your machine unless your room turns diffs on, and `AGENTMASH_DIFFS=0` keeps yours home whatever the room says; `AGENTMASH_HINTS=0` keeps your prompts home. what is kept, and for how long, is in the [privacy policy](https://agentmash.dev/privacy).

## the source

built from the agentmash client's hooks: [agentmash-dev/agentmash-cli](https://github.com/agentmash-dev/agentmash-cli). MIT.

#!/usr/bin/env node
// agentmash-crew: install the agentmash crew into a repository as named teams.
//
//   npx github:IskakovDamir/agentmash-crew team add "Команда 123" --agents pipe,flex,probe
//
// Zero dependencies. The crew itself (agents, shared skills, the guard hook and the team skill template) comes from
// dist/bundle.json; the logic lives in lib/team-plan.mjs (pure) and lib/install.mjs (file system).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listTeams, loadBundle, runTeamOp } from '../lib/install.mjs';

const DEFAULT_BUNDLE = fileURLToPath(new URL('../dist/bundle.json', import.meta.url));
const PACKAGE_JSON = fileURLToPath(new URL('../package.json', import.meta.url));

const HELP = `agentmash-crew: install the agentmash crew into a repository as named teams

usage:
  agentmash-crew team add <name> --agents <a,b|all> [--slug <slug>] [--repo <path>] [--dry-run] [--force]
  agentmash-crew team remove <name|slug> [--agents <a,b>] [--repo <path>] [--dry-run] [--force]
  agentmash-crew team list [--repo <path>] [--json]
  agentmash-crew team update [--repo <path>] [--dry-run] [--force]
  agentmash-crew agents
  agentmash-crew help | --version

team add      creates a team, or adds agents to an existing one (matched by name or slug)
team remove   removes a whole team, or only the agents given with --agents
team list     shows the teams installed in this repository
team update   rewrites every installed file from this version of the crew
agents        lists the agents you can put in a team

mash-coordinator (Mash, the conductor) is in every team. Agents take short or full names, any case:
pipe or pipe-backend. Files go to the repository's .claude/ folder; commit them so the whole team gets them.

options:
  --agents <list>   comma-separated agent names, or all
  --slug <slug>     folder name for the team skill (default: derived from the name, "Команда 123" -> komanda-123)
  --repo <path>     any folder inside the target git repository (default: the current folder)
  --dry-run         show what would change and write nothing
  --force           overwrite files that were changed locally or not written by agentmash-crew
  --json            machine-readable output for team list

examples:
  npx github:IskakovDamir/agentmash-crew team add "Команда 123" --agents pipe,flex,probe
  npx github:IskakovDamir/agentmash-crew team remove "Команда 123" --agents probe
`;

// Every option and whether it takes a value. --bundle is a hidden development flag (tests load other bundles).
const OPTIONS = {
  agents: 'value',
  slug: 'value',
  repo: 'value',
  bundle: 'value',
  'dry-run': 'boolean',
  force: 'boolean',
  json: 'boolean',
  help: 'boolean',
  version: 'boolean',
};

const COMMANDS = {
  'team add': { args: 1, options: ['agents', 'slug', 'repo', 'dry-run', 'force'], run: teamAdd },
  'team remove': { args: 1, options: ['agents', 'repo', 'dry-run', 'force'], run: teamRemove },
  'team list': { args: 0, options: ['repo', 'json'], run: teamList },
  'team update': { args: 0, options: ['repo', 'dry-run', 'force'], run: teamUpdate },
  agents: { args: 0, options: [], run: listAgents },
};

class UsageError extends Error {}

// ---------------------------------------------------------------------------------------------------------------
// Output

const useColor = (stream) => Boolean(stream.isTTY) && !process.env.NO_COLOR;
const paint = (stream, code, text) => (useColor(stream) ? `\x1b[${code}m${text}\x1b[0m` : text);
const out = (line = '') => process.stdout.write(`${line}\n`);
const err = (line) => process.stderr.write(`${line}\n`);
const warn = (message) => err(`${paint(process.stderr, 33, 'warning:')} ${message}`);

const ACTION_COLORS = { created: 32, updated: 32, overwritten: 33, kept: 33, left: 33, deleted: 31 };

/** One line per file we touched (or would touch); unchanged files are only counted. */
function printPlan(plan, dryRun) {
  const rows = plan.changes.filter((change) => change.action !== 'unchanged');
  if (plan.settings.action !== 'unchanged') rows.push({ path: plan.settings.path, action: plan.settings.action });
  if (plan.manifestAction !== 'unchanged') rows.push({ path: plan.manifestPath, action: plan.manifestAction });
  const width = Math.max(0, ...rows.map((row) => row.action.length));
  for (const { path, action } of rows) {
    out(`  ${paint(process.stdout, ACTION_COLORS[action] ?? 0, action.padEnd(width))}  ${path}`);
  }
  const same = plan.changes.filter((change) => change.action === 'unchanged').length;
  if (same > 0) out(`  ${same} file${same === 1 ? '' : 's'} unchanged`);
  for (const message of plan.warnings) warn(message);
  if (dryRun) out('dry run: nothing was written');
  else if (!plan.changed) out('nothing to change');
}

function printSteps(steps) {
  out();
  out('next:');
  steps.forEach((step, i) => out(`  ${i + 1}. ${step}`));
}

// Claude Code reads the project's .claude/settings.json, and with it the guard hook, only from the directory it starts
// in, while agents and skills also load from a subfolder. So the restart step names the repository root.
const RESTART = 'start a new Claude Code session at the repository root, so it loads the agents, skills and guard hook (the hook does not load when Claude Code starts in a subfolder)';

/** Quotes a path for a POSIX shell, and for cmd and PowerShell too when the path allows plain double quotes. */
function shellQuote(value) {
  if (/^[\w@%+=:,./-]+$/.test(value)) return value;
  if (!/["$`!\\]/.test(value)) return `"${value}"`;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The commit step. It stages exactly the files the installer manages after this run (also those an earlier, uncommitted
 * run wrote) and the ones it deleted, so a user's other work under .claude/, and the files they changed that the plan
 * kept or left, stay out of the commit. Deletions go through `git rm --cached --ignore-unmatch`, because `git add`
 * fails on a path that is neither on disk nor tracked (a team removed before it was ever committed). `git -C <root>`
 * makes the command work from any folder.
 */
function commitStep(plan, root, message) {
  const managed = plan.teams.length > 0;
  const added = [];
  const removed = [];
  const note = (rel, action) => {
    if (action === 'deleted') removed.push(rel);
    else if (['created', 'updated', 'overwritten'].includes(action) || (action === 'unchanged' && managed)) added.push(rel);
  };
  for (const change of plan.changes) note(change.path, change.action);
  note(plan.settings.path, plan.settings.action);
  note(plan.manifestPath, plan.manifestAction);

  const git = path.resolve(process.cwd()) === root ? 'git' : `git -C ${shellQuote(root)}`;
  const steps = [];
  if (added.length > 0) steps.push(`${git} add -- ${added.sort().join(' ')}`);
  if (removed.length > 0) steps.push(`${git} rm -q --cached --ignore-unmatch -- ${removed.sort().join(' ')}`);
  steps.push(`${git} commit -m "${message}"`);
  return steps.join(' && ');
}

// ---------------------------------------------------------------------------------------------------------------
// Arguments

function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '-h') options.help = true;
    else if (arg === '-v') options.version = true;
    else if (!arg.startsWith('-') || arg === '-') positionals.push(arg);
    else if (!arg.startsWith('--')) throw new UsageError(`unknown option ${arg}`);
    else {
      const eq = arg.indexOf('=');
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const kind = OPTIONS[key];
      if (!kind) throw new UsageError(`unknown option --${key}`);
      if (key in options) throw new UsageError(`--${key} is given twice`);
      if (kind === 'boolean') {
        if (eq !== -1) throw new UsageError(`--${key} does not take a value`);
        options[key] = true;
        continue;
      }
      const value = eq === -1 ? argv[(i += 1)] : arg.slice(eq + 1);
      if (value === undefined || value.startsWith('--') || value.trim() === '') throw new UsageError(`--${key} needs a value`);
      options[key] = value;
    }
  }
  return { positionals, options };
}

const splitList = (value) => value.split(/[\s,]+/).filter(Boolean);

// ---------------------------------------------------------------------------------------------------------------
// Commands

function teamAdd([name], options, bundle) {
  if (options.agents === undefined) {
    throw new UsageError('team add needs --agents, e.g. team add "Команда 123" --agents pipe,flex,probe');
  }
  const op = { type: 'add', name, slug: options.slug, members: splitList(options.agents), force: Boolean(options.force) };
  const dryRun = Boolean(options['dry-run']);
  const { root, plan } = runTeamOp({ repo: options.repo, bundle, op, dryRun });
  const team = plan.target;
  out(`team ${team.name} (${team.slug}): ${team.members.join(', ')}`);
  printPlan(plan, dryRun);
  if (dryRun || !plan.changed) return 0;
  printSteps([
    commitStep(plan, root, `chore: ${plan.targetIsNew ? 'add' : 'update'} agentmash team ${team.name}`),
    RESTART,
    `then say: ${team.name}, <your task>   (or type: /team-${team.slug} <your task>)`,
  ]);
  return 0;
}

function teamRemove([ref], options, bundle) {
  const members = options.agents === undefined ? undefined : splitList(options.agents);
  const op = { type: 'remove', team: ref, members, force: Boolean(options.force) };
  const dryRun = Boolean(options['dry-run']);
  const { root, plan } = runTeamOp({ repo: options.repo, bundle, op, dryRun });
  const team = plan.target;
  if (team.members === null) out(`removed team ${team.name} (${team.slug})`);
  else out(`team ${team.name} (${team.slug}): ${team.members.join(', ')}`);
  printPlan(plan, dryRun);
  if (dryRun || !plan.changed) return 0;
  const message = team.members === null ? `chore: remove agentmash team ${team.name}` : `chore: update agentmash team ${team.name}`;
  printSteps([commitStep(plan, root, message), 'restart Claude Code in this repo so it reloads the agents']);
  return 0;
}

function teamUpdate(args, options, bundle) {
  const dryRun = Boolean(options['dry-run']);
  const { root, plan } = runTeamOp({ repo: options.repo, bundle, op: { type: 'update', force: Boolean(options.force) }, dryRun });
  const count = plan.teams.length;
  out(`${count} team${count === 1 ? '' : 's'}, agentmash-crew ${bundle.meta.version}`);
  printPlan(plan, dryRun);
  if (dryRun || !plan.changed) return 0;
  printSteps([commitStep(plan, root, `chore: update agentmash teams to ${bundle.meta.version}`), RESTART]);
  return 0;
}

function teamList(args, options, bundle) {
  const { root, teams } = listTeams({ repo: options.repo, bundle });
  if (options.json) {
    out(JSON.stringify({ teams }, null, 2));
    return 0;
  }
  if (teams.length === 0) {
    out(`no agentmash teams in ${root}`);
    return 0;
  }
  for (const team of teams) {
    out(`${team.name} (${team.slug}): ${team.members.map((member) => member.split('-')[0]).join(', ')}`);
  }
  return 0;
}

function listAgents(args, options, bundle) {
  const rows = bundle.agents.map((agent) => [agent.short, agent.name, agent.role, agent.group]);
  const widths = [0, 1, 2].map((column) => Math.max(...rows.map((row) => row[column].length)));
  for (const row of rows) out(row.map((cell, column) => (column < 3 ? cell.padEnd(widths[column]) : cell)).join('  '));
  return 0;
}

function version() {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')).version;
}

// ---------------------------------------------------------------------------------------------------------------
// Entry point

function main(argv) {
  const { positionals, options } = parseArgs(argv);
  if (options.version) {
    out(version());
    return 0;
  }
  if (options.help || positionals.length === 0 || positionals[0] === 'help') {
    out(HELP.trimEnd());
    return 0;
  }

  const [group, sub] = positionals;
  const key = group === 'team' ? `team ${sub ?? ''}`.trim() : group;
  const command = COMMANDS[key];
  if (!command) {
    if (group !== 'team') throw new UsageError(`unknown command "${group}"`);
    throw new UsageError(sub ? `unknown team command "${sub}"` : 'team needs a command: add, remove, list or update');
  }
  for (const option of Object.keys(options)) {
    if (option !== 'bundle' && !command.options.includes(option)) throw new UsageError(`--${option} does not apply to ${key}`);
  }
  const args = positionals.slice(key.split(' ').length);
  if (args.length < command.args) throw new UsageError(`${key} needs a team name, e.g. ${key} "Команда 123"`);
  if (args.length > command.args) {
    throw new UsageError(
      command.args === 1
        ? `the team name must be one argument; quote it: ${key} "${args.join(' ')}"`
        : `${key} takes no arguments (got ${args.join(' ')})`,
    );
  }
  return command.run(args, options, loadBundle(options.bundle ?? DEFAULT_BUNDLE));
}

// Exit quietly when the reader goes away early (`agentmash-crew agents | head -3`). Output is printed only after a
// plan has been applied, so this never interrupts a write.
process.stdout.on('error', (error) => {
  if (error.code !== 'EPIPE') throw error;
  process.exit(process.exitCode ?? 0);
});

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  err(`${paint(process.stderr, 31, 'error:')} ${error.message}`);
  if (error instanceof UsageError) err('run "agentmash-crew help" for usage');
  process.exitCode = error instanceof UsageError ? 2 : 1;
}

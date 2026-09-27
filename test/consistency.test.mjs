// Cross-file facts that no single build step owns: versions, the guard's list of crew names, the add command that
// the protocol and the docs spell out by hand, and the roster table in the README. Each is checked against the
// committed dist/bundle.json, which is generated from the plugin sources.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isCrewAgent } from '../plugin/hooks/crew-guard.mjs';
import { renderTeamSkill } from '../lib/team-plan.mjs';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const bundle = readJson('dist/bundle.json');

test('package.json, plugin.json, marketplace.json, the bundle and the catalog carry one version', () => {
  const { version } = readJson('package.json');
  assert.equal(readJson('plugin/.claude-plugin/plugin.json').version, version);
  const marketplace = readJson('.claude-plugin/marketplace.json');
  assert.deepEqual(marketplace.plugins.map((plugin) => plugin.version), [version]);
  assert.equal(bundle.meta.version, version);
  assert.equal(readJson('catalog.json').version, version);
});

test('crew-guard treats every bundle agent as crew, by bare name and by plugin id', () => {
  for (const { name } of bundle.agents) {
    assert.equal(isCrewAgent(name), true, name);
    assert.equal(isCrewAgent(`agentmash-crew:${name}`), true, `agentmash-crew:${name}`);
  }
  for (const other of ['Explore', 'general-purpose', 'pipe-backend-v2', 'other-plugin:pipe-backend', '']) {
    assert.equal(isCrewAgent(other), false, other);
  }
});

// The add command names the agentmash CLI, which vendors this installer. The github: form is the alternative for people
// without that package, and it must pin this release, or two teammates running "the latest commit" write different files.
const HAND_WRITTEN = [
  'plugin/skills/crew-protocol/SKILL.md',
  'plugin/skills/run-crew/SKILL.md',
  'plugin/agents/mash-coordinator.md',
  'templates/team-skill.md',
  'README.md',
  'plugin/README.md',
  'docs/bundle-format.md',
  'bin/agentmash-crew.mjs',
];

test('every hand-written "team add" command is the bundle add command', () => {
  const prefix = bundle.meta.addCommand.split('<team>')[0];
  assert.equal(prefix, 'npx agentmash team add ');
  const { version } = readJson('package.json');
  const pinned = `npx github:IskakovDamir/agentmash-crew#v${version} team add `;
  let seen = 0;
  for (const file of HAND_WRITTEN) {
    for (const [command] of read(file).matchAll(/npx [^\s`]+ team add /g)) {
      assert.ok(command === prefix || command === pinned, `${file}: ${command}`);
      if (command === prefix) seen += 1;
    }
  }
  assert.ok(seen >= 5, `expected the add command in several files, found ${seen}`);
});

test('every "npx github:" spec in the docs pins this release', () => {
  const { version } = readJson('package.json');
  for (const file of HAND_WRITTEN) {
    for (const [spec] of read(file).matchAll(/npx github:[^\s`]+/g)) {
      assert.equal(spec, `npx github:IskakovDamir/agentmash-crew#v${version}`, `${file}: ${spec}`);
    }
  }
});

test('nothing a team install writes spells the GitHub handle or a github: spec', () => {
  const team = { name: 'agentmash crew', slug: 'agentmash-crew', members: ['pipe-backend', 'flex-frontend', 'probe-qa'] };
  const files = [...bundle.agents, ...bundle.shared, renderTeamSkill(bundle, team)];
  for (const { path, content } of files) assert.doesNotMatch(content, /IskakovDamir|github:/, path);
  assert.doesNotMatch(bundle.meta.addCommand, /IskakovDamir|github:/);
});

test('the README roster table matches the bundle', () => {
  const readme = read('README.md');
  const section = readme.slice(readme.indexOf('## The roster'), readme.indexOf('\n## ', readme.indexOf('## The roster') + 1));
  const rows = [...section.matchAll(/^\| (\w+) \| `([a-z0-9-]+)` \| ([^|]+) \| (\w+) \|$/gm)].map(([, short, name, role, group]) => ({
    short,
    name,
    role: role.trim(),
    group,
  }));
  assert.deepEqual(
    rows,
    bundle.agents.map(({ short, name, role, group }) => ({ short, name, role, group })),
  );
});

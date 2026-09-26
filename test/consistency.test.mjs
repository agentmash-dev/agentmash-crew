// Cross-file facts that no single build step owns: versions, the guard's list of crew names, the add command that
// the protocol and the docs spell out by hand, and the roster table in the README. Each is checked against the
// committed dist/bundle.json, which is generated from the plugin sources.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isCrewAgent } from '../plugin/hooks/crew-guard.mjs';

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

test('every hand-written "npx github:... team add" command uses the bundle add command', () => {
  const prefix = bundle.meta.addCommand.split('<team>')[0];
  assert.match(prefix, /^npx github:\S+ team add $/);
  const files = [
    'plugin/skills/crew-protocol/SKILL.md',
    'plugin/skills/run-crew/SKILL.md',
    'plugin/agents/mash-coordinator.md',
    'templates/team-skill.md',
    'README.md',
    'plugin/README.md',
    'docs/bundle-format.md',
    'bin/agentmash-crew.mjs',
  ];
  let seen = 0;
  for (const file of files) {
    for (const [command] of read(file).matchAll(/npx github:[^\s`]+ team add /g)) {
      assert.equal(command, prefix, `${file}: ${command}`);
      seen += 1;
    }
  }
  assert.ok(seen >= 5, `expected the add command in several files, found ${seen}`);
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

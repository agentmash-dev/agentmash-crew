// The lab plugin (lab/) has no build step, so the facts it spells out by hand are checked here: one roster across the
// agent files, the protocol table, the playbook and the guard, one version across the manifests, and the hand-off to
// Mash that the crew's coordinator documents.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isCrewAgent } from '../plugin/hooks/crew-guard.mjs';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

// Written out independently so a renamed or dropped agent fails here.
const LAB = [
  'hunch-hypotheses', 'seal-prereg', 'atlas-curator', 'bench-analyst', 'foil-controls', 'assay-judge',
  'volt-ieee', 'ribbon-isef', 'tensor-mlconf', 'proof-journal',
];

test('lab/agents holds exactly the ten lab agents', () => {
  const files = fs.readdirSync(fileURLToPath(new URL('../lab/agents', import.meta.url))).filter((f) => f.endsWith('.md'));
  assert.deepEqual(files.map((f) => f.replace(/\.md$/, '')).sort(), [...LAB].sort());
});

test('the protocol table and the run-lab cheat sheet list the ten agents in roster order', () => {
  const protocol = read('lab/skills/lab-protocol/SKILL.md');
  const section = protocol.slice(protocol.indexOf('## 1.'), protocol.indexOf('\n## 2.'));
  const rows = [...section.matchAll(/^\| ([a-z]+-[a-z]+) \|/gm)].map(([, name]) => name);
  assert.deepEqual(rows, LAB);
  const playbook = read('lab/skills/run-lab/SKILL.md');
  for (const name of LAB) assert.match(playbook, new RegExp(`\\| ${name} \\|`), `run-lab cheat sheet misses ${name}`);
});

test('no lab name collides with a crew agent', () => {
  for (const name of LAB) assert.equal(isCrewAgent(name), false, name);
});

test('the crew guard covers every lab agent by plugin id', () => {
  for (const name of LAB) assert.equal(isCrewAgent(`agentmash-lab:${name}`), true, name);
});

test('lab plugin.json and its marketplace entry carry one version and point at lab/', () => {
  const manifest = readJson('lab/.claude-plugin/plugin.json');
  const entry = readJson('.claude-plugin/marketplace.json').plugins.find((plugin) => plugin.name === 'agentmash-lab');
  assert.ok(entry, 'marketplace has no agentmash-lab entry');
  assert.equal(entry.version, manifest.version);
  assert.equal(entry.source, './lab');
});

test('Mash documents the lab hand-off that run-lab relies on', () => {
  const mash = read('plugin/agents/mash-coordinator.md');
  assert.match(mash, /`Lab: agentmash-lab`/);
  for (const name of LAB) assert.match(mash, new RegExp(name), `mash-coordinator never names ${name}`);
  assert.match(read('lab/skills/run-lab/SKILL.md'), /`Lab: agentmash-lab`/);
});

test('every lab agent embeds the current protocol summary', () => {
  const summary = read('lab/skills/lab-protocol/summary.md').trim();
  for (const name of LAB) {
    const body = read(`lab/agents/${name}.md`);
    assert.ok(body.includes(`<!-- lab-protocol:summary:start -->\n${summary}\n<!-- lab-protocol:summary:end -->`), name);
  }
});

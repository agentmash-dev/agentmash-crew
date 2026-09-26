// The routing eval plugin/evals/routing/team-komanda-123 loads the team skill from a fixture plugin inside the case
// (eval runs load no project-level skills, so a skill seeded into the workspace's .claude/skills would never load).
// That copy must stay byte-identical to what the installer renders from the committed dist/bundle.json, otherwise the
// eval measures a skill no user ever gets. The renderer (lib/team-plan.mjs) is the source of truth: when this test
// fails, re-render the fixture's SKILL.md with renderTeamSkill.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderTeamSkill, verifyBundle } from '../lib/team-plan.mjs';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const CASE = 'plugin/evals/routing/team-komanda-123';
const SCAFFOLD = `${CASE}/scaffold.sh`;
const FIXTURE_PLUGIN = `${CASE}/team-plugin`;
const TEAM = {
  name: 'Команда 123',
  slug: 'komanda-123',
  members: ['mash-coordinator', 'pipe-backend', 'flex-frontend', 'probe-qa'],
};

test('the eval case loads the crew plugin and the fixture plugin that carries the team skill', () => {
  const plugins = read(`${CASE}/case.yaml`).match(/^plugins: (\[.*\])$/m);
  assert.ok(plugins, `${CASE}/case.yaml must list its plugins`);
  assert.deepEqual(JSON.parse(plugins[1]), ['../../..', 'team-plugin']);
  const manifest = JSON.parse(read(`${FIXTURE_PLUGIN}/.claude-plugin/plugin.json`));
  assert.match(manifest.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.doesNotMatch(read(SCAFFOLD), /\.claude\/skills\//, 'the scaffold must not seed a project skill the eval never loads');
});

test('the fixture plugin carries the team skill byte for byte as the installer renders it', () => {
  const bundle = verifyBundle(JSON.parse(read('dist/bundle.json')));
  const rendered = renderTeamSkill(bundle, TEAM);
  // The installer writes .claude/skills/team-<slug>/SKILL.md; a plugin keeps its skills in skills/team-<slug>/SKILL.md.
  const skillPath = rendered.path.replace(/^\.claude\//, '');
  assert.equal(skillPath, 'skills/team-komanda-123/SKILL.md');
  assert.equal(
    read(`${FIXTURE_PLUGIN}/${skillPath}`),
    rendered.content,
    `${FIXTURE_PLUGIN}/${skillPath} is out of date: replace it with renderTeamSkill(dist/bundle.json, Команда 123).content`,
  );
});

test('the eval scaffold seeds a teams.json with the same team as the installer would record', () => {
  const bundle = verifyBundle(JSON.parse(read('dist/bundle.json')));
  const script = read(SCAFFOLD);
  const match = script.match(/^cat > (\S+) <<'TEAMS_JSON'\n([\s\S]*?)\nTEAMS_JSON$/m);
  assert.ok(match, `${SCAFFOLD} must write teams.json with a quoted TEAMS_JSON heredoc`);
  assert.equal(match[1], bundle.meta.manifestPath);

  const manifest = JSON.parse(match[2]);
  assert.equal(manifest.schema, 1);
  // source.version and files are informational here (the eval takes the agents from the plugin), so only the
  // identity and the team itself are compared.
  assert.equal(manifest.source.name, bundle.meta.name);
  assert.equal(manifest.source.url, bundle.meta.url);
  assert.deepEqual(manifest.teams, [
    { slug: 'komanda-123', name: 'Команда 123', members: ['mash-coordinator', 'flex-frontend', 'pipe-backend', 'probe-qa'] },
  ]);
});

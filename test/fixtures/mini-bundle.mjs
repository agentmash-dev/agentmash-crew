// A small synthetic crew bundle for installer tests: four agents (conductor first), the three shared files and a
// team skill template that uses every placeholder. `revise(path, content)` lets a test ship a changed version.

import { createHash } from 'node:crypto';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

const AGENTS = [
  { name: 'mash-coordinator', title: 'Mash', role: 'Crew coordinator', group: 'lead' },
  { name: 'tally-planner', title: 'Tally', role: 'Planner and architect', group: 'lead' },
  { name: 'pipe-backend', title: 'Pipe', role: 'Backend engineer', group: 'build' },
  { name: 'probe-qa', title: 'Probe', role: 'QA engineer', group: 'quality' },
];

export const TEAM_SKILL_TEMPLATE = `---
name: {{skill_name}}
description: "Team {{team_name}} ({{team_slug}}). Use when the user addresses {{team_name}} or {{team_slug}}."
---

# {{team_name}}

Roster: {{members_inline}}

{{roster_table}}

Not in this team: {{missing_inline}}

Add an agent: \`{{add_command}}\`
`;

function file(path, content, revise) {
  const final = revise(path, content);
  return { path, sha256: sha256(final), content: final };
}

export function makeBundle({ version = '1.1.0', revise = (path, content) => content } = {}) {
  return {
    schema: 1,
    meta: {
      name: 'agentmash-crew',
      version,
      url: 'https://github.com/IskakovDamir/agentmash-crew',
      conductor: 'mash-coordinator',
      addCommand: 'npx agentmash team add <team> --agents <agent>',
      hook: {
        event: 'PreToolUse',
        matcher: 'Bash',
        command: 'node "$CLAUDE_PROJECT_DIR/.claude/agentmash-crew/crew-guard.mjs"',
        timeout: 5,
        marker: '.claude/agentmash-crew/crew-guard.mjs',
      },
      manifestPath: '.claude/agentmash-crew/teams.json',
    },
    agents: AGENTS.map((agent) => {
      const short = agent.name.split('-')[0];
      const path = `.claude/agents/${agent.name}.md`;
      const content = `---\nname: ${agent.name}\n---\n\n# ${agent.title} · ${agent.role}\n\nRead .claude/skills/crew-protocol/SKILL.md first.\n`;
      return { name: agent.name, short, title: agent.title, role: agent.role, group: agent.group, ...file(path, content, revise) };
    }),
    shared: [
      file('.claude/skills/crew-protocol/SKILL.md', '---\nname: crew-protocol\n---\n\n# Crew protocol v1.2\n', revise),
      file('.claude/skills/run-crew/SKILL.md', '---\nname: run-crew\n---\n\n# Run the crew\n', revise),
      file('.claude/agentmash-crew/crew-guard.mjs', '#!/usr/bin/env node\nprocess.exit(0);\n', revise),
    ],
    templates: {
      teamSkill: { pathPattern: '.claude/skills/team-{{team_slug}}/SKILL.md', content: TEAM_SKILL_TEMPLATE },
    },
  };
}

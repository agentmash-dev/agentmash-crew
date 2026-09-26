---
description: A task addressed to the named team "Команда 123" should load its team skill and be handed to mash-coordinator.
tags: [routing, team]
runs: 1
max_turns: 10
allowed_tools: [Agent, Skill, Read, Glob, Grep]
---

Команда 123, add GET /api/workspaces/:id/members that lists a workspace's members, with tests.

---
description: A plain user request that should be delegated to mash-coordinator.
tags: [routing]
runs: 1
max_turns: 8
allowed_tools: [Agent, Read, Glob, Grep]
---

We have an approved plan in .agentmash-crew/plans/invite-links.md for team invite links: a migration, two API endpoints, a settings page and docs. Run it with the crew agents, in parallel where the plan allows, and integrate the result.

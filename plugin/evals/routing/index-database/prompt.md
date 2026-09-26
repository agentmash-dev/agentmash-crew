---
description: A plain user request that should be delegated to index-database.
tags: [routing]
runs: 1
max_turns: 8
allowed_tools: [Agent, Read, Glob, Grep]
---

Write a migration that renames users.fullname to users.display_name without downtime. The API keeps reading the old column during the rollout.

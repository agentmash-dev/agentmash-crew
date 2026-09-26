---
description: A plain user request that should be delegated to tally-planner.
tags: [routing]
runs: 1
max_turns: 8
allowed_tools: [Agent, Read, Glob, Grep]
---

I want to add team invite links: admins generate a link, it expires in 7 days, invitees join the workspace. Break this down into tasks that several agents can build in parallel without stepping on each other's files.

---
description: A plain user request that should be delegated to probe-qa.
tags: [routing]
runs: 1
max_turns: 8
allowed_tools: [Agent, Read, Glob, Grep]
---

The new invite flow is merged. Write end-to-end tests for it against the acceptance criteria and try to break it: expired links, double clicks, a user who is already a member.

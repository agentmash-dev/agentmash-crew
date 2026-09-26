---
description: A plain user request that should be delegated to rail-cicd.
tags: [routing]
runs: 1
max_turns: 8
allowed_tools: [Agent, Read, Glob, Grep]
---

Our GitHub Actions workflow takes 18 minutes and reinstalls node_modules on every job. Speed it up with proper caching and pin the third-party actions.

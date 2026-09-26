---
description: A plain user request that should be delegated to bump-dependencies.
tags: [routing]
runs: 1
max_turns: 8
allowed_tools: [Agent, Read, Glob, Grep]
---

npm audit reports a high-severity advisory in a transitive dependency of express. Update what's needed safely and tell me exactly what changed.

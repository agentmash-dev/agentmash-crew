---
description: A plain user request that should be delegated to prune-refactor.
tags: [routing]
runs: 1
max_turns: 8
allowed_tools: [Agent, Read, Glob, Grep]
---

src/billing has three nearly identical invoice formatting functions and a 900-line utils file. Clean it up without changing any behavior.

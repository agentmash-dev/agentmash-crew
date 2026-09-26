---
description: A plain user request that should be delegated to spell-prompts.
tags: [routing]
runs: 1
max_turns: 8
allowed_tools: [Agent, Read, Glob, Grep]
---

The summarization prompt in prompts/summarize.md sometimes returns bullet points instead of the JSON our parser expects. Make the output reliable and prove it with a before and after eval.

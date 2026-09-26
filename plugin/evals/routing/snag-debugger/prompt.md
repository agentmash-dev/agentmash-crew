---
description: A plain user request that should be delegated to snag-debugger.
tags: [routing]
runs: 1
max_turns: 8
allowed_tools: [Agent, Read, Glob, Grep]
---

Checkout tests started failing this morning with "TypeError: Cannot read properties of undefined (reading 'currency')" in cart.test.ts. Find the root cause before anyone tries a fix.

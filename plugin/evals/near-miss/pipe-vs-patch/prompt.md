---
description: Near miss between patch-integrations and pipe-backend; should go to patch-integrations.
tags: [routing, near-miss]
runs: 1
max_turns: 8
allowed_tools: [Agent, Read, Glob, Grep]
---

Add retries with backoff to our Twilio SMS client and handle their 429 responses.

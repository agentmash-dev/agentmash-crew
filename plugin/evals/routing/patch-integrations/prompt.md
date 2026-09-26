---
description: A plain user request that should be delegated to patch-integrations.
tags: [routing]
runs: 1
max_turns: 8
allowed_tools: [Agent, Read, Glob, Grep]
---

Integrate Stripe webhooks: handle checkout.session.completed, verify the signature, and make the handler safe when Stripe delivers the same event twice.

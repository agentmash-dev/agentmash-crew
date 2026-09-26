---
description: A plain user request that should be delegated to pipe-backend.
tags: [routing]
runs: 1
max_turns: 8
allowed_tools: [Agent, Read, Glob, Grep]
---

Add a POST /api/invites endpoint that creates an invite for a workspace, validates the email, checks that the caller is an admin, and returns 201 with the invite id.

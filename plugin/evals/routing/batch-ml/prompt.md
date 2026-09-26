---
description: A plain user request that should be delegated to batch-ml.
tags: [routing]
runs: 1
max_turns: 8
allowed_tools: [Agent, Read, Glob, Grep]
---

Our churn model's AUC dropped from 0.81 to 0.72 after we added the last_login_days feature. Check the training pipeline for leakage and give me an honest evaluation on a held-out set.

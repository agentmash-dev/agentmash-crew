---
description: A plain user request that should be delegated to lingo-i18n.
tags: [routing]
runs: 1
max_turns: 8
allowed_tools: [Agent, Read, Glob, Grep]
---

We're adding Russian to the app. Extract the hardcoded strings on the checkout pages into the locale catalogs and make sure plural forms like '1 товар / 3 товара / 5 товаров' work.

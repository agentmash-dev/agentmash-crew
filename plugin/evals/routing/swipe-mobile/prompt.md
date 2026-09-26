---
description: A plain user request that should be delegated to swipe-mobile.
tags: [routing]
runs: 1
max_turns: 8
allowed_tools: [Agent, Read, Glob, Grep]
---

On Android the login screen in our React Native app gets covered by the keyboard, and the back button closes the app instead of going back. Fix the screen and the navigation.

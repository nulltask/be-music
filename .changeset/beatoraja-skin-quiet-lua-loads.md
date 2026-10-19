---
'@be-music/beatoraja-skin': patch
---

Fix a Lua skin's load writing a `console.log` line for every `require()` and every `dofile()` that loaded, in production too. These traces now sit behind a diagnostics flag that is off. A module that is not found and a `dofile` that fails still warn.

---
'@be-music/beatoraja-skin': minor
---

Remove `computeClearLampOp`, a clear-lamp rule of its own that no longer matched the one every result uses (no MAX, no ASSIST EASY, a full combo from the BAD / POOR count alone, no judge ruleset). Migration: lamp the play with `resolveClearLamp` from `@be-music/player/ruleset` and light it with `beatorajaClearLampOp` from `@be-music/beatoraja-skin/scene`.

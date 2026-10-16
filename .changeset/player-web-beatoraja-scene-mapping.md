---
'@be-music/player-web': minor
---

The beatoraja scenes read their ops, numbers, texts, timers, gauge and graphs from `@be-music/beatoraja-skin/scene` instead of keeping their own tables, so the play, select and result screens share one mapping. The helpers that moved there are no longer exported from `@be-music/player-web`.

Migration: import these from `@be-music/beatoraja-skin/scene` instead.

- `beatorajaClearLampOp` (was in `@be-music/player-web/scenes`).
- `discoverBeatorajaSystemSoundPaths`, `discoverBeatorajaSelectBgmPath` and `pickBeatorajaThemeBgmPaths` (were in `@be-music/player-web/skin`); the cue paths type `BeatorajaSelectSystemSoundPaths` is `BeatorajaSystemSoundPaths`.
- `lnModeDirectiveToIndex` is `beatorajaLnModeIndex`, and `resolveResultGaugeState` is `resolveBeatorajaGaugeState`.

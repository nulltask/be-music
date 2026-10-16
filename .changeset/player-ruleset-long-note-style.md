---
'@be-music/player': minor
---

Export `LongNoteStyle` (how a judge ruleset plays a chart's long notes: LR2's LN, beatoraja's per-note mode, IIDX's charge notes) from `@be-music/player/ruleset`, so a host's drawing code can name it without importing the engine (`@be-music/player/core/engine`, where it is also exported).

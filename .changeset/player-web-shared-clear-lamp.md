---
'@be-music/player-web': minor
---

Show the same clear lamp on a beatoraja result as on the LR2 and default results: a clear with every note a PERFECT now lights the beatoraja MAX lamp instead of PERFECT. The beatoraja result takes its lamp from `resolveClearLamp`, the rule the other families use, through the new `beatorajaClearLampOp`; both are exported from `@be-music/player-web/scenes` so a host can light the same lamp on a beatoraja select bar from its own records.

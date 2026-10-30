---
'@be-music/player-engine': minor
---

Publish chart text on UI frames, including judgment-driven TEXT00 overrides and deterministic pause, seek, restart and reversal behavior. Keep playback open for late text cues.

NONSTOP retains stage-owned text programs, including trimmed selections, per-stage TEXT00, FIT timing and empty-stage clears. Hosts pass the stitch map’s text program through `chartTextStages`.

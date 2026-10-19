---
'@be-music/audio-renderer': patch
---

Fix `renderJson` / `renderChartFile` rendering some charts differently from the players:

- A `#VOLWAV 0` chart rendered silent and `#VOLWAV 200` or above amplified: `#VOLWAV` now applies only for `0 < n < 200`, as in beatoraja and the player.
- A negative `#BPMxx` was dropped, so the previous tempo continued: it now plays at `Math.abs(bpm)`, and the render leaves out the triggers LR2's frozen event pump never fires past a negative-BPM reversal (everything behind it, and on its tick all but BGM / BPM / BGA), as LR2 plays the reverse-scroll gimmick (#134).

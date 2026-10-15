---
'@be-music/player-web': minor
---

The built-in and LR2 gameplay scenes record what the player saw in their play logs: the hi-speed (on the `be-music` scale), HS-FIX, the visible time at the main BPM and each side's SUDDEN+ / HIDDEN+ at the start, then each change during the play, coalesced to at most one per 100 ms. A replay shows that view along the playhead over the viewer's own settings, as far as the new `replayView` option (`PlaylogViewReplay`, all on by default) asks: the hi-speed as recorded on the same scale, or the one matching the recorded visible time when the play was on another scene's scale, and the covers as recorded.

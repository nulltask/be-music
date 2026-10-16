---
'@be-music/player-web': minor
---

`AudioService.playCue` takes a resolved `SystemSound` as well as a slot of the theme's sounds, as `playBgm` and `playJingle` do, so a scene plays the cues of its own sound set on the cue bus without setting the service's theme.

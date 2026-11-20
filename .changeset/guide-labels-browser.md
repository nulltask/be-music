---
'@be-music/player-browser': minor
---

BPM GUIDE labels no longer run off the right edge of the lanes: they sit right-aligned above their line, shrink to fit narrow lanes, and stack when two changes share a beat. The built-in skins draw them in their own type and colours. BPM GUIDE can also label `#SCROLL` and `#SPEED` changes, and `PlaySessionOptions.bpmGuideKinds` with `PlayScene.setBPMGuideKinds` choose which of the BPM, STOP, SCROLL and SPEED labels show, live during a play.

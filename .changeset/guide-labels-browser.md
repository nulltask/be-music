---
'@be-music/player-browser': minor
---

BPM GUIDE labels no longer run off the right edge of the lanes: they sit right-aligned above their line, shrink to fit narrow lanes, and changes that share a beat stack in a callout: right-aligned rows, the shortest at the top, joined to the line by a slanted leader with a tick to each label. The built-in skins draw them in their own type and colours, every label puts a space before its number (`BPM 200`, beatoraja's `BPM200`), and its digits are tabular, so a number keeps its place. BPM GUIDE can also label `#SCROLL` and `#SPEED` changes, and `PlaySessionOptions.bpmGuideKinds` with `PlayScene.setBPMGuideKinds` choose which of the BPM, STOP, SCROLL and SPEED labels show, live during a play.

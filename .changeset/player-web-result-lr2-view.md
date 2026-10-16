---
'@be-music/player-web': minor
---

`createResultScene` takes an LR2 kit (`{ family: 'lr2', skin }`, the theme's result skin, or its course-result skin for a course run) as well as a be-music one. The LR2 family's result view draws the result skin from the result session's frames, through `resolveLr2ResultState` (the course from `result.course`, the skin's `#FLIPRESULT` and its custom options' defaults) and LR2's result timers read off each frame: timer 0 from the entry, timers 1 and 150 once input opens, timer 151 once the graphs have drawn or been skipped (`graphShownAtMs`) and timer 152 once the record update shows (`updateShownAtMs`). Input opens after the skin's `#STARTINPUT` (1500 ms without one), as before. `ResultScene.updateKit` ignores a kit of another family.

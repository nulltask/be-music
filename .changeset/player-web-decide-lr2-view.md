---
'@be-music/player-web': minor
---

`createDecideScene` takes an LR2 kit (`{ family: 'lr2', skin }`, the theme's decide skin) as well as a be-music one. The LR2 family's decide view draws the decide skin over the chart's `#STAGEFILE` from the decide session's frames, through `resolveLr2DecideState` and LR2's scene timers (timer 0 from the entry, timer 1 once input opens). The screen keeps the LR2 decide screen's timing: input opens after the skin's `#STARTINPUT` (1500 ms without one), and the screen moves on to the play 1200 ms later. `DecideScene.updateKit` ignores a kit of another family.

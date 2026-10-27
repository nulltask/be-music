---
'@be-music/player-scene-model': minor
---

Add the play options and choices of the judgment, hi-speed and view options, the lane arrangements, the chart modifiers, the gauge options, the battle and conversion modes, CUSTOM JUDGE and PRACTICE, among them:

- START BPM hi-speed anchoring, keeping LR2's button order.
- The source-defined OFF, ON, SUDDEN-only and HIDDEN/LIFT-only display-area visibility choices.
- OFF, AC LEGACY NOTE and beatoraja LN REMOVE.
- EX-HARD through the shared option validation, keeping LR2's gauge cycling.
- `judgeTimingAutoAdjust`, the automatic judge timing mode (`'OFF'`, `'BEATORAJA'`, `'LR2-ON'`, `'LR2-SILENT'`, default `'OFF'`) (#777).
- `bpmChangeWarning` (off by default) for AC 34's BPM-change warning.

SUDDEN+ is kept as a fraction of the lane above the LIFT, with a LIFT per side switched on and off on its own, and the floating hi-speed's covers as fractions of the whole lane. `resolveConstantVisibility` decides Visual CONSTANT and takes `noSpeed`, which turns it off for a course with the `NO_SPEED` constraint, as beatoraja's `LaneRenderer` does. A two-player play has a 2P result (`PlayResult.secondPlayer`).
`resolveRandomModes` offers the lane options only one source defines under every ruleset: R-RANDOM, SPIRAL, H-RANDOM, ALL-SCR, RANDOM-EX, S-RANDOM-EX and the PMS arrangements (beatoraja), and SCATTER (LR2), while CONVERGE stays with LR2 and beatoraja. Its second argument marks the 1P side of a chart copied onto both sides, which adds SYNCHRONIZE RANDOM and SYMMETRY RANDOM, and `isDuplicatedBattleChoice` tells those battle modes apart (#774).

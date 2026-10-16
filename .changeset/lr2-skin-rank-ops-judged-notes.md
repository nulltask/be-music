---
'@be-music/lr2-skin': patch
---

Fix the LR2 play screen's 1P rank ops (200-207) ranking the EX score over every note of the chart, which lit F for most of a play: they now rank it over the notes judged so far, as LR2 does (OpenLR2 `GetOptionFlag_dst` ranks `exscore × 9 / (note_current × 2)`), and none is lit before the first note is judged. `resolveLr2RankOp` takes the judgement counts instead of the chart's notes.

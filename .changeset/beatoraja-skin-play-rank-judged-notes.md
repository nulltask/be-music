---
'@be-music/beatoraja-skin': patch
---

Fix a beatoraja play skin's 1P rank ops (200-207) and "now" rank ops (340-347) ranking the EX score over every note of the chart, which lit F for most of a play: they now rank it over the notes judged so far, as beatoraja's `createNowRank` reads `ScoreDataProperty.nowrate`, which is 100 % before the first note, so a play starts on AAA. A chart without notes lights none of them.

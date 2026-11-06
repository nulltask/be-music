---
'@be-music/player-ui': patch
---

`isChartScoreBarEmpty` (and `omitEmptyFirstBar`) now reads a bar as empty when it holds nothing to play: no note, long note or mine. BGM, BGA, tempo changes and stops in a lead-in measure 0 no longer keep it on the score.

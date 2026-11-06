---
'@be-music/player-ui': minor
---

`layoutChartScore(chart, { omitEmptyFirstBar: true })` leaves an empty measure 0 out so the score starts at measure 1, with `isChartScoreBarEmpty` and each bar's `soundCount` deciding what is empty. `<be-music-chart-score>`'s `previewing` also takes a run of bars (`{ first, last }`) to outline.

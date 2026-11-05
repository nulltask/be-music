---
'@be-music/player-ui': minor
---

Add `<be-music-chart-score>`, which draws a chart as a printed score: its bars in columns, bottom to top, each with its measure number, bar and beat lines, notes, long notes and mines on the play mode's lanes (5 / 7 / 10 / 14 KEY and 9 KEY), and its tempo changes and stops. `layoutChartScore(chart)` lays a resolved chart out bar by bar (measure lengths, BPM changes, stops, long notes across bar lines) with each bar's chart times, and the bars can be picked one or a run at a time (`bar-selection-change`, `chartScoreRangeTimes`). `packChartScoreColumns`, `selectChartScoreBars`, `resolveChartScoreLanes`, `resolveChartScoreColumn` and `chartScoreRowAt` are exported too.

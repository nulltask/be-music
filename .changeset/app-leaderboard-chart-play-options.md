---
'@be-music/app-leaderboard': patch
---

A grade course run no longer fails its lane-lock check when a stage's chart forced its own arrangement (`chart.chartPlayOptions`), since the chart's option wins over the course lock.

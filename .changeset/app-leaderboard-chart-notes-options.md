---
'@be-music/app-leaderboard': patch
---

Submissions now check a replay's `chart.chartPlayOptions` against the gameplay options in the chart's play document, narrowed to the play (a course stage without NOTES COPY, none in a NONSTOP run), and reject a mismatch with `chart-play-options-mismatch`, so a replay can no longer strip or add the chart's program.

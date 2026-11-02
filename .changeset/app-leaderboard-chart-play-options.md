---
'@be-music/app-leaderboard': patch
---

Submissions check a replay's chart-authored gameplay options:

- A replay's `chart.chartPlayOptions` must match the gameplay options in the chart's play document, narrowed to the play (a course stage without NOTES COPY, none in a NONSTOP run); a mismatch is rejected with `chart-play-options-mismatch`, so a replay can no longer strip or add the chart's program.
- A grade course run no longer fails its lane-lock check when a stage's chart forced its own arrangement, since the chart's option wins over the course lock.

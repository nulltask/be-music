---
'@be-music/app-leaderboard': minor
---

Plays at another tempo, course stages sent on their own, course runs with a stage at another tempo and runs of unreleased courses are now stored instead of refused with 422: they are simulated and answered with `unranked` (rank and players 0), but move no personal best and stay out of the rankings, the figures and every list, and their page says why (#788). Migration `0017` adds the nullable `unranked` column to `score` and `course_score`.

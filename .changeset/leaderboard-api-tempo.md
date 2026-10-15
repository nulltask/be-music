---
'@be-music/leaderboard-api': minor
---

Refuse plays and course runs played at another tempo with a 422 `tempo`: a tempo-changed play is practice and is not ranked, as beatoraja's frequency trainer does not save its scores. The OpenAPI document lists the new code for `POST /api/v0/scores` and `POST /api/v0/course-scores`.

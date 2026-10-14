---
'@be-music/leaderboard-api': minor
---

Let players hide their own plays and show them again. A hidden play is kept, but leaves the rankings, the personal bests (rebuilt from the plays still shown), the chart and player figures and every list, and to anyone else its page, its API entry and its play log answer 404. Its player still sees it, marked hidden on their lists and with a notice on its page. The play page has the hide / show button; the API gains `PATCH /api/v0/scores/:id` with `{ hidden }`, and `GET /api/v0/scores/:id` answers `hidden`. Adds the migration `0006_score_hidden`.

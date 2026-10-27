---
'@be-music/app-leaderboard': minor
---

Give course runs a share card: the run's own player's browser draws it (course name and kind, stages reached and trophy, DJ Rank, EX-Score, lamp, gauge, counts and the stage list with each stage's rate) and uploads it through `PUT /api/v0/course-scores/{id}/card`; the course run page links it as its `og:image` and Twitter card and offers the same share buttons as a play's page.

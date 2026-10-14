---
'@be-music/leaderboard-api': patch
---

Speed up the Latest list and player pages' play lists. The query joined every play that passed the filters, ran the per-play subqueries (earlier best, rank, player count) for each, and only then sorted and cut to the page. It now picks the page first, walking a widened `score_created_idx` (`created_at`, `id`) newest-first, and computes the rest for the rows shown. On 40,000 plays the default Latest list went from about 64 ms to 4 ms, and with "Anonymous players" on and no planner statistics (as on D1) from about 2.9 s to 6 ms. Adds the migration `0007_score_created_id_index`.

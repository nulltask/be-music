---
'@be-music/app-leaderboard': patch
---

Chart documents stored in R2 are gzip-compressed, the same way replays already are, and score cards gunzip them before reading the excerpt, still accepting plain JSON written earlier.

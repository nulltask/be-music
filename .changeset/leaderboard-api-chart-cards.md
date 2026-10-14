---
'@be-music/leaderboard-api': minor
---

Chart pages now preview with a card of their own instead of the site's default one: the default card's playfield shows the chart's densest two measures as lanes and notes (white and blue keys, red scratch, long notes as bars). The Worker draws it from the chart's fingerprint document on the first request (`GET /leaderboard/charts/:chartFingerprint/card`) as a palette PNG, without a rasterizer or fonts, and keeps it in R2.

---
'@be-music/leaderboard-api': minor
---

Score pages now preview as a large card on X, Discord and other link previews (`og:image`, `twitter:card` `summary_large_image`). The card (1200 × 630) shows the chart, the DJ Rank, the EX-Score and rate, the lamp, the judgments and the player, in the lamp's colour; the player's browser draws it on their first visit and uploads it (`PUT /api/v0/scores/:id/card`, owner only), and the site's default card stands in until then and on every other page. The score page gains a Share section: a post on X with `#bemusic`, the system share sheet, and copy link.

---
'@be-music/leaderboard-api': minor
---

Group charts into chartsets, the charts of one work (originals and add-ons), as BMS Search files them by file hash. A new chart is looked up right after its submission and an hourly Cron Trigger re-checks the rest; `/leaderboard/chartsets/:id` lists a work's charts, and chart and score pages show the chartset in their breadcrumbs (migration `0003_chartsets`).

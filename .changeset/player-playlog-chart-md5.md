---
'@be-music/player': minor
---

Play logs can carry `chart.md5`, the MD5 of the chart file, next to `chart.sha256`. Hosts pass it as `recordPlaylog.chartMd5`; LR2 and LR2IR identify a chart by this hash, so a log can be tied to their records.

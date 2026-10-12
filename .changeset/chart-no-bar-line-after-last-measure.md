---
'@be-music/chart': patch
---

Stop adding a bar line after the last measure: `createMeasureBoundariesBeats` (and `ResolvedChart.barLines`) now lists the start of every measure up to the last one, as beatoraja builds its sections, and a bmson chart's authored `lines` exactly as they are. Players drew one bar line more than beatoraja at the end of every chart.

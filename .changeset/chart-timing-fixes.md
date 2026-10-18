---
'@be-music/chart': patch
---

Fix two timing differences from LR2 and beatoraja:

- Several BMS `#STOP` objects at one position added up into one long stop: LR2 and beatoraja keep only the last one, so a chart that redefines a stop on a duplicated channel-`09` line now stops for the time its author heard. bmson `stop_events` on one pulse and `#STP` lines still add up, as their specs say.
- A bar line was added after the last measure, one more than beatoraja draws at the end of every chart: `createMeasureBoundariesBeats` (and `ResolvedChart.barLines`) now lists the start of every measure up to the last one, as beatoraja builds its sections, and a bmson chart's authored `lines` exactly as they are.

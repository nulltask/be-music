---
'@be-music/chart': patch
---

Fix several BMS `#STOP` objects at one position adding up into one long stop: LR2 and beatoraja keep only the last one, so a chart that redefines a stop on a duplicated channel-`09` line now stops for the time its author heard. bmson `stop_events` on one pulse and `#STP` lines still add up, as their specs say.

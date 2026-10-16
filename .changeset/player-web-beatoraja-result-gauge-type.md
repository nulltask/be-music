---
'@be-music/player-web': minor
---

A beatoraja result screen named every gauge NORMAL: `main_state.gauge_type()` and the gauge slab had no gauge state there and fell back to the default. The result now passes the gauge the play ended on (`resolveResultGaugeState`), so a course result shows its class gauge and a HARD play its HARD gauge.

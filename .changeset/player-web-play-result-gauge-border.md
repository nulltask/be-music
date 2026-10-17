---
'@be-music/player-web': patch
---

A play's result (`PixiGameplayResultData` from `createPlayScene`'s `on.finish` and `progress()`) now carries the gauge's clear border in percent (`gaugeBorder`) and the TOTAL the engine reports (`gaugeTotal`) for every family, as the beatoraja play's result did, so a beatoraja result skin shows them for any play. A result read before the engine's first frame has the border but no TOTAL.

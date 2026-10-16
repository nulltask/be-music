---
'@be-music/scene-model': minor
---

`PlayResult` can carry the gauge's clear border in percent (`gaugeBorder`) and the TOTAL it ran on (`gaugeTotal`), which a beatoraja result skin's gauge and TOTAL readout show. `playResultFromBeatoraja` fills them from the summary's gauge when it reports them (`BeatorajaPlayGauge`: `clearThreshold` and `effectiveTotal`), and `beatorajaCompletionFromPlayResult` hands them back.

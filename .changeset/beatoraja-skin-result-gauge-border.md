---
'@be-music/beatoraja-skin': minor
---

A result skin read from a result alone (no engine gauge in `BeatorajaResultInput.gauge`) draws the gauge with the result's clear border (`BeatorajaResultFacts.gaugeBorder`, a `PlayResult`'s `gaugeBorder`) and reads its TOTAL (`gaugeTotal`) on the TOTAL readout (368), as it does with the engine's gauge. It used to draw the gauge without a border and read the chart's `#TOTAL` as written.

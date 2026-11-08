---
'@be-music/chart-model': minor
---

Add `keysOutBGALayerBlack(json, bmpKey?)`, and let `usesMonophonicWAVPlayback(json, sampleKey?)` take a slot: both follow a slot's own format from `resources.bmpSourceFormat` / `resources.wavSourceFormat`, so a BMS stage in a NONSTOP chart stitched as bmson keeps restarting keysounds on retrigger and keying out layer black. `ResolvedChart.volumeChanges` now also lists the 97 / 98 changes of a bmson chart stitched from BMS stages.

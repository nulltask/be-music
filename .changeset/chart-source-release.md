---
'@be-music/chart-source': minor
---

Add chart diagnostics and per-slot source formats.

- Add a shared chart diagnostic type and allow parsed charts to carry nonfatal warnings.
- Add the optional `resources.wavSourceFormat` and `resources.bmpSourceFormat` maps, which name the format whose playback and drawing rules a WAV / BMP slot follows where it differs from the chart's `sourceFormat`, and copy them in `cloneJSON`. A NONSTOP chart stitched as bmson uses them to keep its BMS stages' rules.

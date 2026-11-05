---
'@be-music/player-browser': minor
---

Add `AudioService.preview.playWindow(target, { startSeconds, endSeconds })` (`ChartPreviewEngine.playWindow`), which sounds one stretch of a chart at once as AUTO PLAY would play it, cutting the previous one short, for auditioning a bar. `createPlayScene` takes `practiceRange`, the chart milliseconds a PRACTICE play loops.

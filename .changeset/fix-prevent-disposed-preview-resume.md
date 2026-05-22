---
'@be-music/player-web': patch
---

Prevent the chart-preview audio scheduler from resuming playback after the preview has been disposed (e.g. the user moved off the song before the buffer decoded), so a previously-disposed `ChartPreview` no longer emits sample triggers into the next preview's audio context.

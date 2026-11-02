---
'@be-music/player-browser': minor
---

A quick retry of the same chart no longer decodes its samples again: the audio service keeps the decoded samples of the chart played last (`AudioService.chartSamples`), and the play takes them from there. The cache holds one chart, keyed by its source, chart path, `#PATH_WAV` and the play context's sample rate; a play of another chart (or a SILENT play) releases it before decoding, `release()` frees it, and `dispose()` does too. Options that change a play (RANDOM, keep-pitch stretching, `#WAVCMD` / `#EXWAV`, peak gain) still apply afresh to each play, and the cached buffers are never changed in place.

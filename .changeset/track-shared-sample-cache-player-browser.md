---
'@be-music/player-browser': minor
---

Another chart of the same track (NORMAL → HYPER) no longer decodes the samples the last play already decoded: `AudioService.chartSamples` now keeps each decode under the audio file a `#WAV` path resolves to, so charts share a decode only when their paths resolve to the very same file (the chart's folder, `#PATH_WAV` and codec fallbacks decide it). A play claims the cache with the files it may sound (`claim(key, files)`) and the rest goes before it decodes, so the cache still holds one play's samples at most; a play from another source or at another sample rate releases it all. The samples now stay through the select screen while the preview focuses a chart of the same track, and `ChartSampleCache.keepTrackOf` releases them once the focus leaves it. `ChartSampleCacheKey` drops `pathPrefix`, `ChartSampleLease` reads and writes by file and its `reused` is now a count, and its `retain` is gone.

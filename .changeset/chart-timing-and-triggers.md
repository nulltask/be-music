---
'@be-music/chart': minor
---

Add the chart timing and sample-trigger helpers: `createTimingResolver` (tempo points, STOP / `#STP` points, beat → seconds), `createTimingBuildContext` / `createTimingResolverWithContext`, `collectSampleTriggers` / `collectSampleTriggersWithContext` and `createBmsonSamplePlaybackMap`. They moved here from `@be-music/audio-renderer`, which keeps re-exporting them, so every package reads a chart's timing from the same chart-semantics layer.

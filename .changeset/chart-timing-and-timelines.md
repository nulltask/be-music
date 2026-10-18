---
'@be-music/chart': minor
---

Add the chart timing, sample-trigger and timeline API, so every package reads a chart's timing from the same chart-semantics layer. It moves here from `@be-music/audio-renderer` and `@be-music/player`, which no longer export it:

- From `@be-music/audio-renderer`: `createTimingResolver` (tempo points, STOP / `#STP` points, beat → seconds), `createTimingBuildContext` / `createTimingResolverWithContext`, `collectSampleTriggers` / `collectSampleTriggersWithContext`, `createBmsonSamplePlaybackMap` and their types.
- From `@be-music/player`: the timeline builders `createMeasureTimeline`, `createBpmTimeline`, `createScrollTimeline`, `createSpeedTimeline`, `createStopBeatWindows`, `createMeasureBoundariesBeats` (bar lines), `createBeatAtSecondsResolver` / `createBeatAtSecondsResolverFromTimingResolver` and their point types, and the BGA cue builders `buildBgaTimelines` / `buildBmsBgaTimeline` with `BgaCue`, `BgaTimelines` and `BgaTimingResolver`.

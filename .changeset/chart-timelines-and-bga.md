---
'@be-music/chart': minor
---

Add the chart timeline builders: `createMeasureTimeline`, `createBpmTimeline`, `createScrollTimeline`, `createSpeedTimeline`, `createStopBeatWindows`, `createMeasureBoundariesBeats` (bar lines), `createBeatAtSecondsResolver` / `createBeatAtSecondsResolverFromTimingResolver`, and the BGA cue builders `buildBgaTimelines` / `buildBmsBgaTimeline`. They moved here from `@be-music/player` (`core/timeline`, `core/bga-timeline`), which keeps re-exporting them.

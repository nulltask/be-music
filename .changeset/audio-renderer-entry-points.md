---
'@be-music/audio-renderer': minor
---

Remove `@be-music/audio-renderer/triggers` and the root's re-exports of the chart timing and sample-trigger API, which moved to `@be-music/chart` (ADR 0005). The root now exports only the renderer: `renderJSON`, `renderSingleSample`, `renderChartFile`, `writeAudioFile` and their option and result types.

Migration:

- `createTimingResolver`, `createTimingBuildContext`, `createTimingResolverWithContext`, `collectSampleTriggers`, `collectSampleTriggersWithContext`, `createBmsonSamplePlaybackMap`, `TimingResolver`, `TimingBuildContext`, `TempoPoint`, `StopPoint`, `TimedSampleTrigger`, `CollectSampleTriggersOptions` from `@be-music/audio-renderer` or `@be-music/audio-renderer/triggers` → `@be-music/chart`.

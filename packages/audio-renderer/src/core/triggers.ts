/**
 * Chart timing and sample triggers. The implementations live in `@be-music/chart` (the resolved-chart layer, see
 * `resolveChart`); this module re-exports them so `@be-music/audio-renderer` / `@be-music/audio-renderer/triggers`
 * keep their public API.
 */
export {
  collectSampleTriggers,
  collectSampleTriggersWithContext,
  createBmsonSamplePlaybackMap,
  createTimingBuildContext,
  createTimingResolver,
  createTimingResolverWithContext,
  firesBeforeTempoReversal,
  mirrorBeatAtTempoReversal,
  type CollectSampleTriggersOptions,
  type StopPoint,
  type TempoPoint,
  type TempoReversalPoint,
  type TimedSampleTrigger,
  type TimingBuildContext,
  type TimingResolver,
} from '@be-music/chart';

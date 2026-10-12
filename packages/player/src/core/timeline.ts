/**
 * Chart timelines (measure starts, BPM changes, SCROLL / SPEED keyframes, STOP windows, bar lines). The implementations
 * live in `@be-music/chart` (the resolved-chart layer, see `resolveChart`); this module re-exports them so
 * `@be-music/player/core/timeline` keeps its public API.
 */
export {
  createBeatAtSecondsResolver,
  createBeatAtSecondsResolverFromTimingResolver,
  createBpmTimeline,
  createMeasureBoundariesBeats,
  createMeasureTimeline,
  createScrollTimeline,
  createSpeedTimeline,
  createStopBeatWindows,
  type BpmTimelinePoint,
  type MeasureTimelinePoint,
  type ScrollTimelinePoint,
  type SpeedTimelinePoint,
  type StopBeatWindow,
} from '@be-music/chart';

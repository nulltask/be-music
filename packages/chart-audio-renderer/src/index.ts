/**
 * The renderer: `renderJSON`, `renderSingleSample`, `renderChartFile`, `writeAudioFile` and their types. The chart
 * timing and the sample triggers it renders from (`createTimingResolver`, `collectSampleTriggers`, …) are
 * `@be-music/chart-model`'s.
 */
export * from './core/engine.ts';
export {
  renderSingleSample,
  type RenderSingleSampleOptions,
  type RenderResult,
  type RenderSampleLoadProgress,
} from '@be-music/audio-sample';

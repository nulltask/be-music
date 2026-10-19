import type {
  GaugeHistorySample as SceneGaugeHistorySample,
  PlayResult,
  ScoreHistorySample as SceneScoreHistorySample,
} from '@be-music/scene-model';

/**
 * One sample of the gauge graph. `progress` is the chart-time fraction (0 = the start, 1 = the end of the chart);
 * `value` is the gauge percentage at that moment (0..100). `GaugeHistorySample` of `@be-music/scene-model`.
 */
export type GaugeHistorySample = SceneGaugeHistorySample;

/**
 * One sample of the EX-score graph. Same shape as {@link GaugeHistorySample} but the value is an absolute EX-score
 * count (0..`total*2`); a result screen normalizes it by the chart's theoretical max when drawing.
 */
export type ScoreHistorySample = SceneScoreHistorySample;

/**
 * A play's result, as the result screen draws it (LR2 skin, beatoraja skin or be-music skin): the one result payload of
 * `@be-music/scene-model` (`PlayResult`) for a single play, a course stage, a course run or a NONSTOP run. `run` says
 * which; `courseRun` carries a course run's stages reached and trophy.
 */
export type BeMusicResultData = PlayResult;

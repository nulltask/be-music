import type { BeMusicPlaylog, ScoreSummary } from '@be-music/player/playlog';
import type { BeMusicJudgeTiming } from './types.ts';
import type { BeMusicClearLamp, BrowserSongEntry } from './song.ts';

/**
 * One sample of the gauge polyline. `progress` is the chart-time fraction (0 = first note, 1 = last playable / sample
 * trigger); `value` is the gauge percentage at that moment (0..100).
 *
 * Used by the LR2 result scene's `#SRC_GAUGECHART` renderer (`PixiResultView`). The series always contains at
 * least one entry (the chart-start origin seeded in `prepareSong`).
 */
export interface GaugeHistorySample {
  progress: number;
  value: number;
}

/**
 * One sample of the EX-score polyline. Same shape as {@link GaugeHistorySample} but the value is an absolute EX-score
 * count (0..`total*2`). The result scene normalizes by the chart's theoretical max when drawing.
 */
export interface ScoreHistorySample {
  progress: number;
  exScore: number;
}

/**
 * Snapshot of the play session, captured at chart-end (or whenever the host asks for it via `getResultData`). Routed through the host into the result scene so it can render (LR2 skin or be-music
 * skin) without holding onto the gameplay view.
 *
 * Field meaning: - `score` — same shape as {@link ScoreSummary}: per-judge counts, total notes, EX-score, and the
 * displayed (count-up smoothed) IIDX score. - `maxCombo` — longest GREAT-or-better streak observed during the play
 * (resets on every BAD/POOR). - `gauge` — final gauge percentage (0–100), used to drive pass / fail ops on the result
 * skin. - `cleared` — `true` when the gauge ended at-or-above the chart's pass threshold (≥ 80 % for HARD-style charts;
 * we use NORMAL's 80 % default for now since gauge type isn't user-selectable). - `playSeconds` — clock time the player
 * spent on the chart, for the result skin's "TIME" readout. - `song` — chart metadata (title, artist, BPM, …) for the
 * song info panel; the same `BrowserSongEntry` the gameplay view was mounted with.
 */
export interface BeMusicResultData {
  score: ScoreSummary;
  maxCombo: number;
  gauge: number;
  cleared: boolean;
  playSeconds: number;
  song: BrowserSongEntry;
  /**
   * Per-judge samples of `(progress, gauge%)`. Populated through the play session by `publishJudge`. The result scene
   * uses this to draw `#SRC_GAUGECHART_1P` / `_2P` polylines that animate left- to-right between the SRC's `start` and
   * `end` ms.
   */
  gaugeHistory: GaugeHistorySample[];
  /** Per-judge samples of `(progress, exScore)`. Drives `#SRC_SCORECHART`. */
  scoreHistory: ScoreHistorySample[];
  /**
   * Play-log recorded by the shared engine (resolved chart + raw input replay + play settings). `undefined` for
   * legacy paths that finished without the shared engine having produced one. See `@be-music/player/playlog`.
   */
  playlog?: BeMusicPlaylog;
  /** The play's clear lamp (FAILED, the gauge it was cleared on, FULL COMBO, …). */
  lamp?: BeMusicClearLamp;
  /** Gauge the play ran on, as the ruleset names it (`GROOVE`, `HARD`, `EX-HARD`, …). */
  gaugeType?: string;
  /** Compat ruleset that judged the play (`lr2` / `beatoraja` / `iidx`). */
  judgeRuleset?: string;
  /** FAST (early) and SLOW (late) GREAT / GOOD counts. */
  fast?: number;
  slow?: number;
  /**
   * Every timed judgement of the play, oldest first (see `BeMusicGameplayRuntime.lastJudgeDeltaMs` for which ones
   * carry a timing). Feed it to {@link binJudgeTimings} for a timing histogram.
   */
  judgeTimings?: readonly BeMusicJudgeTiming[];
}

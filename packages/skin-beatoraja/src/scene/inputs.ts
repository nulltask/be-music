import type { EarlyLateCount, JudgmentKind } from '@be-music/player-scene-model';

/**
 * A play's judgment counts and scores as the engine reports them (`PlayerSummary`, the play result's `ScoreSummary`).
 */
export interface BeatorajaScoreInput {
  /** The judgments a whole play makes: the EX score's maximum is twice this. */
  readonly total: number;
  readonly perfect: number;
  readonly great: number;
  readonly good: number;
  readonly bad: number;
  readonly poor: number;
  /** Empty POORs (beatoraja MISS), separate from missed notes; absent reads as zero. */
  readonly emptyPoor?: number;
  readonly exScore: number;
  /** The displayed score: LR2's money score under LR2, else the EX score. */
  readonly score: number;
  /** FAST (early) GREAT / GOOD count. */
  readonly fast?: number;
  /** SLOW (late) GREAT / GOOD count. */
  readonly slow?: number;
}

/** The gauge as the engine reports it (`PlayerGaugeSummary`). */
export interface BeatorajaGaugeInput {
  readonly current: number;
  readonly max: number;
  /** The clear border, in the units of `current`. */
  readonly clearThreshold?: number;
  /** The TOTAL the gauge runs on. */
  readonly effectiveTotal?: number;
  /** The ruleset's gauge id (`GROOVE`, `HARD`, `EX-HARD`, a course gauge, …). */
  readonly type?: string;
}

/**
 * How many of each judgment's timed hits were early and late. `MISS` is beatoraja's empty POOR; without a `MISS` entry
 * its rows read POOR's.
 */
export type BeatorajaEarlyLate = Readonly<Partial<Record<JudgmentKind | 'MISS', EarlyLateCount>>>;

/** The local date and time a clock readout shows (numbers 21-26). `month` counts from 1. */
export interface BeatorajaWallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** The local date and time of a `Date`, as a clock readout shows it. */
export function beatorajaWallClockOf(date: {
  getFullYear(): number;
  getMonth(): number;
  getDate(): number;
  getHours(): number;
  getMinutes(): number;
  getSeconds(): number;
}): BeatorajaWallClock {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

/** The note counts of a chart by kind (numbers 350-353, the judge graph's type 0). */
export interface BeatorajaNoteBreakdown {
  /** Key taps. */
  readonly normal: number;
  /** Long notes on the keys. */
  readonly ln: number;
  /** Scratch taps. */
  readonly scratch: number;
  /** Long scratches (back-spin scratches). */
  readonly bss: number;
}

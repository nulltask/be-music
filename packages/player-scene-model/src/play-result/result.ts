import type { BeMusicReplay, ReplayRulesetResult } from '@be-music/player-engine/replay';
import { resolveClearLamp, type ClearLamp, type ScoreSummary } from '@be-music/player-engine/ruleset';
import type { CourseView } from '../course-view/course-view.ts';
import type { LibraryChart } from '../library/entries.ts';
import type { EarlyLateCount, PlayState } from '../play-state/state.ts';
import type { GaugeHistorySample, JudgmentKind, JudgmentTiming, ScoreHistorySample } from '../play-state/types.ts';
import type { CourseStageHistory } from './course.ts';

/**
 * Which play a result is of: a single play, one stage of an EXPERT / GRADE course, a whole EXPERT / GRADE course run,
 * or a NONSTOP course run (one stitched play).
 */
export type PlayRunKind = 'single' | 'stage' | 'course' | 'nonstop';

/**
 * The one result payload every result screen reads, whatever the run and whatever the skin family: the score, the
 * gauge and its verdict, the clear lamp, the graphs, the timed judgments and the replay, with the course a stage or a
 * run belongs to.
 */
export interface PlayResult {
  /** A seek made this play practice: never save a record, rank it or auto-save its replay. */
  practice?: boolean;
  /** A live course-stage outcome for carrying practice into the next stage without a replay. */
  stageOutcome?: ReplayRulesetResult;
  /** Per-judgment counts, total notes, EX score and the displayed score (LR2's money score, else the EX score). */
  score: ScoreSummary;
  /**
   * The POOR judgments alone, when `score.poor` also counts the empty POORs (a play under LR2, whose POOR readout folds
   * them in): a sum over `score` that adds `emptyPoor` too, such as BP, reads this in place of `score.poor`.
   */
  judgedPoor?: number;
  /** The longest unbroken combo (a course run: the course-wide one). */
  maxCombo: number;
  /** The final gauge in percent (0..100). */
  gauge: number;
  /** The ruleset's clear verdict, including full-combo precedence (a course run: whether the run cleared). */
  cleared: boolean;
  /** The time played, in seconds (a course run: every stage's). */
  playSeconds: number;
  /** The chart played: its metadata for the song info panel (a course run: the course under its first stage's chart). */
  chart: LibraryChart;
  /** The gauge graph, from the start of the play to its end. */
  gaugeHistory: GaugeHistorySample[];
  /** The EX-score graph. */
  scoreHistory: ScoreHistorySample[];
  /** The replay the engine recorded, when it recorded one. */
  replay?: BeMusicReplay;
  /** The clear lamp (FAILED, the gauge cleared on, FULL COMBO, …). */
  lamp?: ClearLamp;
  /** The gauge the play ran on, as the ruleset names it (`GROOVE`, `HARD`, `EX-HARD`, …). */
  gaugeType?: string;
  /** The gauge's clear border in percent (0..100), when the play reported it: a beatoraja skin's gauge shows it. */
  gaugeBorder?: number;
  /**
   * The TOTAL the gauge ran on (a bmson `total` or a missing `#TOTAL` resolved), when the play reported it: a beatoraja
   * skin's TOTAL readout shows it.
   */
  gaugeTotal?: number;
  /** Which play this is of; absent reads as a single play. */
  run?: PlayRunKind;
  /** The course a stage or a course run belongs to (with the stage being played for a stage). */
  course?: CourseView;
  /** A course run's facts beside the summed score: the stages reached and the trophy earned. */
  courseRun?: PlayResultCourseRun;
  /** The judge ruleset the play ran under (`lr2` / `beatoraja` / `iidx`). */
  judgeRuleset?: string;
  /** FAST (early) and SLOW (late) GREAT / GOOD counts. */
  fast?: number;
  slow?: number;
  /** Every timed judgment of the play, oldest first. */
  judgeTimings?: readonly JudgmentTiming[];
  /** How many of each judgment's timed hits were early and late (beatoraja's early / late counts). */
  earlyLate?: Readonly<Record<JudgmentKind, EarlyLateCount>>;
}

/** What a course run's result carries beside its summed score. */
export interface PlayResultCourseRun {
  /** How many stages the run reached. */
  stagesPlayed: number;
  /** The best trophy the run earned, by name. */
  trophy?: string;
  /**
   * Each stage's graphs, in order (an unreached stage left out): beatoraja's course result draws them joined
   * (`joinCourseStageHistories`), LR2's the last one, which the result's own graphs are.
   */
  stageHistories?: readonly CourseStageHistory[];
}

/** Which play a result is of: its `run`, a single play when it names none. */
export function playResultRun(result: Pick<PlayResult, 'run'>): PlayRunKind {
  return result.run ?? 'single';
}

/** How a result screen presents a run, as LR2 does. */
export interface ResultPresentation {
  /** Shown on the course-result skin (falling back to the result skin). */
  courseResultSkin: boolean;
  /** Plays the course-clear / course-fail jingles (falling back to the clear / fail ones). */
  courseJingles: boolean;
  /** R plays the chart again from the result. */
  quickRetry: boolean;
}

/**
 * How a result screen presents its run, as LR2 does. A course run (EXPERT / GRADE) ends on the course result: the
 * course-result skin (falling back to the result skin) with the course jingles, and no quick retry. A NONSTOP run has no
 * course-result step (OpenLR2 `Main.cpp` M1406-M1412 only moves EXPERT / GRADE on to it), so it shows on the result
 * skin with the clear / fail jingles, and R retries it as for a single play (L2854 allows the result's quick retry
 * outside a course and on NONSTOP). A course stage's result offers no retry.
 */
export function resolveResultPresentation(run: PlayRunKind): ResultPresentation {
  const course = run === 'course';
  return { courseResultSkin: course, courseJingles: course, quickRetry: run === 'single' || run === 'nonstop' };
}

/** What a play's result adds to its final play state. */
export interface PlayResultFacts {
  practice?: boolean;
  chart: LibraryChart;
  /** The final judgment counts and scores (the engine's final summary). */
  score: ScoreSummary;
  /** Chart time the play ended at, in seconds: the graphs' last sample and the play time. */
  seconds: number;
  /** The play time when it differs from `seconds` (a play at another tempo). */
  playSeconds?: number;
  judgeRuleset?: string;
  fast?: number;
  slow?: number;
  replay?: BeMusicReplay;
  run?: PlayRunKind;
  course?: CourseView;
}

/**
 * The result of a play from its final play state: the score and gauge, the graphs with a last sample at the end of the
 * play (so they reach the right edge when the last judgment came well before the end), the clear lamp by the one
 * clear-lamp rule (`resolveClearLamp`), the timed judgments and their early / late counts.
 */
export function playResultFromPlayState(state: PlayState, facts: PlayResultFacts): PlayResult {
  const lamp = resolveClearLamp({
    cleared: state.cleared,
    score: facts.score,
    ...(state.gaugeType !== undefined ? { gauge: state.gaugeType } : {}),
    ...(facts.judgeRuleset !== undefined ? { ruleset: facts.judgeRuleset } : {}),
  });
  const progress = state.totalSeconds > 0 ? Math.max(0, Math.min(1, facts.seconds / state.totalSeconds)) : 1;
  return {
    score: { ...facts.score },
    ...(facts.practice === true ? { practice: true } : {}),
    maxCombo: state.maxCombo,
    gauge: state.gauge,
    cleared: lamp !== 'FAILED',
    playSeconds: facts.playSeconds ?? facts.seconds,
    chart: facts.chart,
    gaugeHistory: [...state.gaugeHistory, { progress, value: state.gauge }],
    scoreHistory: [...state.scoreHistory, { progress, exScore: state.exScore }],
    ...(facts.practice !== true && facts.replay !== undefined ? { replay: facts.replay } : {}),
    lamp,
    ...(state.gaugeType !== undefined ? { gaugeType: state.gaugeType } : {}),
    ...(facts.run !== undefined ? { run: facts.run } : {}),
    ...(facts.course !== undefined ? { course: facts.course } : {}),
    ...(facts.judgeRuleset !== undefined ? { judgeRuleset: facts.judgeRuleset } : {}),
    ...(facts.fast !== undefined ? { fast: facts.fast } : {}),
    ...(facts.slow !== undefined ? { slow: facts.slow } : {}),
    judgeTimings: state.judgeTimings,
    earlyLate: state.earlyLate,
  };
}

import type { GaugeType } from './gauge-type.ts';

/**
 * Clear lamps, worst first: not played, failed, the gauge a play cleared on (ASSIST EASY … EX HARD), FULL COMBO (every
 * note judged GOOD or better), PERFECT (GREAT or better) and MAX (every note a PGREAT). A lamp's index is its rank
 * ({@link clearLampRank}): a better lamp ranks higher, and the Leaderboard stores lamps by their rank. Each judge ruleset
 * awards its own subset: LR2 and IIDX stop at FULL COMBO, LR2 has no ASSIST EASY or EX HARD, beatoraja goes up to MAX.
 */
export const CLEAR_LAMPS = [
  'NO_PLAY',
  'FAILED',
  'ASSIST_EASY',
  'EASY',
  'NORMAL',
  'HARD',
  'EX_HARD',
  'FULL_COMBO',
  'PERFECT',
  'MAX',
] as const;

/** The class of clear a play earned, or a best record's best one (see {@link CLEAR_LAMPS}). */
export type ClearLamp = (typeof CLEAR_LAMPS)[number];

/** Whether `value` names a clear lamp. */
export function isClearLamp(value: unknown): value is ClearLamp {
  return typeof value === 'string' && (CLEAR_LAMPS as readonly string[]).includes(value);
}

/** The rank of `lamp` in {@link CLEAR_LAMPS}: `NO_PLAY` 0 up to `MAX` 9, higher is better. An unknown lamp ranks 0. */
export function clearLampRank(lamp: ClearLamp): number {
  return Math.max(0, CLEAR_LAMPS.indexOf(lamp));
}

/** The lamp of a {@link clearLampRank}, or `undefined` for a rank no lamp has. */
export function clearLampAtRank(rank: number): ClearLamp | undefined {
  return Number.isInteger(rank) ? CLEAR_LAMPS[rank] : undefined;
}

/** The better of two lamps; `current` on a tie. */
export function betterClearLamp(current: ClearLamp, candidate: ClearLamp): ClearLamp {
  return clearLampRank(candidate) > clearLampRank(current) ? candidate : current;
}

/**
 * The best lamp a judge ruleset awards: LR2 and IIDX stop at FULL COMBO (they have no PERFECT or MAX lamp); beatoraja,
 * and a ruleset this does not know, go up to MAX.
 */
export function topClearLamp(ruleset: string | undefined): ClearLamp {
  return ruleset === 'lr2' || ruleset === 'iidx' ? 'FULL_COMBO' : 'MAX';
}

/**
 * The lamp a cleared single play earns from its gauge, by the gauge ids the rulesets use (`GROOVE` / `EASY` / `HARD` /
 * `DEATH` under LR2, `ASSIST-EASY` / `EASY` / `NORMAL` / `HARD` / `EX-HARD` / `HAZARD` under beatoraja,
 * `ASSISTED-EASY` … under IIDX). DEATH and HAZARD clear on the strictest lamp below the full-combo ones.
 */
const GAUGE_LAMPS: Readonly<Record<string, ClearLamp>> = {
  'ASSIST-EASY': 'ASSIST_EASY',
  'ASSISTED-EASY': 'ASSIST_EASY',
  EASY: 'EASY',
  GROOVE: 'NORMAL',
  NORMAL: 'NORMAL',
  HARD: 'HARD',
  'EX-HARD': 'EX_HARD',
  DEATH: 'EX_HARD',
  HAZARD: 'EX_HARD',
};

/**
 * The lamp a cleared single play earns from its gauge (a ruleset gauge id, any case), before the full-combo lamps:
 * `NORMAL` for a gauge the table does not know. LR2 awards HARD only for its HARD-family gauges and NORMAL for every
 * other one but EASY, so a DEATH clear is NORMAL there (OpenLR2 `LR2f.cpp` L2593-L2600, LR2body.exe CheckClear
 * @0x405da0); beatoraja and IIDX keep EX HARD for theirs.
 */
function gaugeClearLamp(gauge: string | undefined, ruleset: string | undefined): ClearLamp {
  const id = gauge?.toUpperCase();
  if (ruleset === 'lr2' && id === 'DEATH') return 'NORMAL';
  return (id !== undefined ? GAUGE_LAMPS[id] : undefined) ?? 'NORMAL';
}

/**
 * Course gauges → the lamp a course run's clear earns, before the full-combo lamps: beatoraja's class gauges (CLASS
 * NORMAL, EXCLASS HARD, EXHARDCLASS EX HARD), and LR2's course gauges for a ruleset the course rule does not know.
 */
const COURSE_GAUGE_LAMPS: Readonly<Record<string, ClearLamp>> = {
  CLASS: 'NORMAL',
  EXCLASS: 'HARD',
  EXHARDCLASS: 'EX_HARD',
  'GRADE-HARD': 'HARD',
  'GRADE-DEATH': 'HARD',
  'COURSE-HARD': 'HARD',
  'COURSE-DEATH': 'HARD',
  'COURSE-EASY': 'EASY',
};

/**
 * The lamp a cleared course run earns from its gauge. LR2's follows the player's gauge pick (option 3 EASY → EASY, HARD
 * → HARD, anything else NORMAL: LR2 awards HARD only for its HARD-family gauges, so a DEATH clear is NORMAL,
 * LR2body.exe CheckCourseClear @0x4086d0); beatoraja's follows the class gauge the run played on.
 */
function courseGaugeClearLamp(gauge: string, ruleset: string, gaugeType: GaugeType): ClearLamp {
  if (ruleset === 'lr2') return gaugeType === 'EASY' ? 'EASY' : gaugeType === 'HARD' ? 'HARD' : 'NORMAL';
  return COURSE_GAUGE_LAMPS[gauge] ?? 'NORMAL';
}

/**
 * The one clear-lamp rule. A run that did not clear is FAILED whatever its judgments. A cleared full combo is FULL
 * COMBO, PERFECT without a GOOD and MAX with nothing but PGREATs; any other clear takes the lamp of its gauge. The lamp
 * is then kept to the ruleset's own set: no better than `top`.
 */
function finishClearLamp(play: {
  top: ClearLamp;
  cleared: boolean;
  gaugeLamp: ClearLamp;
  fullCombo: boolean;
  great: number;
  good: number;
}): ClearLamp {
  if (!play.cleared) return 'FAILED';
  const lamp: ClearLamp = !play.fullCombo
    ? play.gaugeLamp
    : play.good > 0
      ? 'FULL_COMBO'
      : play.great > 0
        ? 'PERFECT'
        : 'MAX';
  return clearLampRank(lamp) > clearLampRank(play.top) ? play.top : lamp;
}

/**
 * Whether a play is a full combo: it has notes and judged every one of them GOOD or better. A play that stopped before
 * its last note is none. Empty POORs never touch a note, so they don't cost a full combo.
 */
export function isFullCombo(score: { total: number; perfect: number; great: number; good: number }): boolean {
  return score.total > 0 && score.perfect + score.great + score.good >= score.total;
}

/** What the clear lamp of a single play is read from. */
export interface PlayClearLampFacts {
  /** The judge ruleset the play ran under (`lr2`, `beatoraja`, `iidx`); any other value or none uses beatoraja's lamps. */
  ruleset?: string;
  /** The ruleset's verdict on the gauge the play ended on. */
  cleared: boolean;
  /** The gauge the play ran on, by the ruleset's gauge id (`GROOVE`, `HARD`, `EX-HARD`, …); none counts as NORMAL. */
  gauge?: string;
  /** The judgments over the ruleset's `total` judgment notes (PGREATs are `perfect`). */
  score: { total: number; perfect: number; great: number; good: number };
}

/**
 * The clear lamp of a single play: FAILED when its gauge did not clear, FULL COMBO / PERFECT / MAX for a cleared full
 * combo ({@link isFullCombo}), else the lamp of the gauge it cleared on, kept to the judge ruleset's own lamps: under
 * LR2 and IIDX a full combo is the top lamp. LR2 awards it before the gauge check; a DEATH clear is NORMAL.
 */
export function resolveClearLamp(play: PlayClearLampFacts): ClearLamp {
  const fullCombo = isFullCombo(play.score);
  // LR2 CheckClear (0x405da4–0x405dc9) returns FULL COMBO before inspecting the gauge.
  if (play.ruleset === 'lr2' && fullCombo) return 'FULL_COMBO';
  return finishClearLamp({
    top: topClearLamp(play.ruleset),
    cleared: play.cleared,
    gaugeLamp: gaugeClearLamp(play.gauge, play.ruleset),
    fullCombo,
    great: play.score.great,
    good: play.score.good,
  });
}

/** What the clear lamp of a course run is read from. */
export interface CourseClearLampFacts {
  /** The judge ruleset the run was judged under; a ruleset this does not know stops at FULL COMBO. */
  ruleset: string;
  /** Whether the run cleared: every stage reached and the last one's gauge cleared. */
  cleared: boolean;
  /** The course gauge the run ended on (`GRADE`, `COURSE-HARD`, `CLASS`, …). */
  gauge: string;
  /** The gauge the player picked: LR2's course lamps follow it. */
  gaugeType: GaugeType;
  /** Judgment notes over every stage of the course, reached or not. */
  noteCount: number;
  /** The course-wide max combo. */
  maxCombo: number;
  /** The judgments summed over the stages played. */
  judge: { great: number; good: number };
}

/**
 * The clear lamp of a course run (LR2 `CheckCourseClear`, beatoraja `MusicResult`): FAILED when it did not clear; a FULL
 * COMBO when the course max combo covers every note (Σ notes == course max combo, as both check), PERFECT without a GOOD
 * and MAX with only PGREATs; otherwise the lamp of its gauge — LR2's by the gauge picked, beatoraja's and IIDX's by the
 * class gauge. Kept to the ruleset's own lamps, with FULL COMBO the top lamp for a ruleset this does not know.
 */
export function resolveCourseClearLamp(run: CourseClearLampFacts): ClearLamp {
  const known = run.ruleset === 'lr2' || run.ruleset === 'beatoraja' || run.ruleset === 'iidx';
  return finishClearLamp({
    top: known ? topClearLamp(run.ruleset) : 'FULL_COMBO',
    cleared: run.cleared,
    gaugeLamp: courseGaugeClearLamp(run.gauge, run.ruleset, run.gaugeType),
    fullCombo: run.noteCount > 0 && run.maxCombo >= run.noteCount,
    great: run.judge.great,
    good: run.judge.good,
  });
}

/**
 * BP (miss count): BADs, missed POORs and empty POORs, as LR2 and beatoraja count it (LR2 adds an empty POOR to its POOR
 * count, LR2body.exe ApplyJudgeNote @0x4061f1), plus `unjudgedNotes`: the notes a course stage that failed mid-way, or a
 * course run's unreached stages, never judged, which LR2 counts in a course's BP (OpenLR2 L9105-L9113).
 */
export function resolveMissCount(judge: { bad: number; poor: number; emptyPoor: number }, unjudgedNotes = 0): number {
  return judge.bad + judge.poor + judge.emptyPoor + Math.max(0, unjudgedNotes);
}

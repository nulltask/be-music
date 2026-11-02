/**
 * Re-judging a replay under a ruleset, with ADR 0019's outcomes: a result that is simulated in full, one that is
 * truncated at the point the played run stopped, or none at all ("not simulated") with the reason.
 *
 * {@link simulateReplay} stays the plain simulator: it judges whatever it is given. These wrappers decide first whether
 * the replay can be judged under the target at all, and never synthesize inputs the played run did not record.
 */
import { resolveGaugeTypes, type GaugeType } from '../ruleset/gauge-type.ts';
import { isCourseStageFailed } from '../ruleset/course.ts';
import type { RulesetId } from '../ruleset/index.ts';
import { simulateCourseReplay, type BeMusicCourseReplay, type ReplayCourseResult } from './course.ts';
import type { BeMusicReplay, ReplayRulesetResult } from './format.ts';
import { simulateReplay, type SimulateReplayOptions } from './simulate.ts';

/**
 * Why a replay is not simulated under a ruleset:
 *
 * - `gauge` — the replay's bare gauge is not one the ruleset defines (`P-ATTACK` under beatoraja, `EX-HARD` under LR2,
 *   `DEATH` under AC outside a course). It is never mapped to a lookalike.
 * - `custom-judge` — CUSTOM JUDGE has no reading outside beatoraja yet.
 * - `gauge-auto-shift` — gauge auto-shift has no reading outside beatoraja yet.
 */
export type ReplayNotSimulatedReason = 'gauge' | 'custom-judge' | 'gauge-auto-shift';

/** One ruleset's outcome of re-judging a replay (ADR 0019). */
export type ReplayRejudgeOutcome =
  | { status: 'simulated'; result: ReplayRulesetResult }
  | {
      /**
       * The played run stopped where its survival gauge emptied, and this ruleset's gauge would have survived that
       * point: judged up to it ({@link stoppedAtUs}) and no further. Not ranked.
       */
      status: 'truncated';
      result: ReplayRulesetResult;
      stoppedAtUs: number;
    }
  | { status: 'not-simulated'; reason: ReplayNotSimulatedReason };

/** One ruleset's outcome of re-judging a course replay; a course is truncated where its played run stopped early. */
export type ReplayCourseRejudgeOutcome =
  | { status: 'simulated'; result: ReplayCourseResult }
  | { status: 'truncated'; result: ReplayCourseResult }
  | { status: 'not-simulated'; reason: ReplayNotSimulatedReason; stage?: number };

/** The ruleset a replay was played under (LR2 when the log does not say). */
function playedRuleset(replay: BeMusicReplay): RulesetId {
  return replay.play.judgeRuleset ?? 'lr2';
}

/**
 * Whether `ruleset` defines the bare gauge pick `gauge`. A course stage plays the pick on the ruleset's course gauges,
 * which take every pick but the attack gauges outside LR2 and EX-HARD or ASSIST EASY under LR2 (`resolveCourseGaugeId`).
 */
function definesGauge(ruleset: RulesetId, gauge: GaugeType, courseStage: boolean): boolean {
  if (!courseStage) return resolveGaugeTypes(ruleset).includes(gauge);
  return ruleset === 'lr2'
    ? gauge !== 'EX-HARD' && gauge !== 'ASSIST-EASY'
    : gauge !== 'P-ATTACK' && gauge !== 'G-ATTACK';
}

/**
 * Why `replay` cannot be judged under `ruleset`, or `undefined` when it can. `player` picks the side of a recorded
 * two-player play, whose gauge it reads.
 */
export function findReplayNotSimulatedReason(
  replay: BeMusicReplay,
  ruleset: RulesetId,
  player: 1 | 2 = 1,
): ReplayNotSimulatedReason | undefined {
  const gauge = player === 2 ? (replay.play.gauge2P ?? replay.play.gauge) : replay.play.gauge;
  // The played ruleset ran this gauge live, whatever its menu offers.
  if (ruleset !== playedRuleset(replay) && !definesGauge(ruleset, gauge, replay.play.course !== undefined))
    return 'gauge';
  if (ruleset === 'beatoraja') return undefined;
  if (replay.play.customJudge !== undefined) return 'custom-judge';
  if (replay.play.gaugeAutoShift !== undefined && replay.play.gaugeAutoShift !== 'NONE') return 'gauge-auto-shift';
  return undefined;
}

/**
 * The replay cut where judging stopped at `stoppedAtUs`: nothing after it is judged, and no note past it is missed,
 * as for a run given up there.
 */
function stopReplayAt(replay: BeMusicReplay, stoppedAtUs: number): BeMusicReplay {
  return {
    ...replay,
    inputs: replay.inputs.filter((input) => input.timeUs <= stoppedAtUs),
    // Judgments due at the stop itself still count: it was the judgment that emptied the played gauge.
    play: { ...replay.play, aborted: true, abortedAtUs: stoppedAtUs + 1 },
  };
}

/**
 * Where the played run stopped because its survival gauge emptied (`play.endOnFailure`), re-judged under its own
 * ruleset; `undefined` when it did not stop early for that.
 */
function findFailureStop(replay: BeMusicReplay, options: Omit<SimulateReplayOptions, 'ruleset'>): number | undefined {
  if (replay.play.endOnFailure !== true || replay.play.aborted === true) return undefined;
  let stoppedAtUs: number | undefined;
  simulateReplay(replay, {
    ...options,
    ruleset: playedRuleset(replay),
    onJudgment: undefined,
    onFailure: (atUs) => (stoppedAtUs = atUs),
  });
  return stoppedAtUs;
}

/**
 * Re-judges `replay` under `options.ruleset` by ADR 0019's declared rules. Under the played ruleset the replay is
 * simulated as recorded. Under another ruleset:
 *
 * - a gauge or option the ruleset cannot read makes it `not-simulated` (see {@link ReplayNotSimulatedReason});
 * - a run that stopped where its survival gauge emptied is judged only up to that point, and is `truncated` when this
 *   ruleset's gauge would have survived it.
 */
export function rejudgeReplay(replay: BeMusicReplay, options: SimulateReplayOptions): ReplayRejudgeOutcome {
  const reason = findReplayNotSimulatedReason(replay, options.ruleset, options.player);
  if (reason !== undefined) return { status: 'not-simulated', reason };
  const stoppedAtUs = options.ruleset === playedRuleset(replay) ? undefined : findFailureStop(replay, options);
  if (stoppedAtUs === undefined) return { status: 'simulated', result: simulateReplay(replay, options) };
  const result = simulateReplay(stopReplayAt(replay, stoppedAtUs), options);
  return result.gauge.failedMidPlay === true
    ? { status: 'simulated', result }
    : { status: 'truncated', result, stoppedAtUs };
}

/** Runs {@link rejudgeReplay} for each ruleset. */
export function rejudgeReplayRulesets(
  replay: BeMusicReplay,
  rulesets: readonly RulesetId[],
  options: Omit<SimulateReplayOptions, 'ruleset'> = {},
): Record<string, ReplayRejudgeOutcome> {
  const outcomes: Record<string, ReplayRejudgeOutcome> = {};
  for (const ruleset of rulesets) outcomes[ruleset] = rejudgeReplay(replay, { ...options, ruleset });
  return outcomes;
}

/** Whether a course result's run ended because a stage failed, by the course rule (`isCourseStageFailed`). */
function endedOnFailedStage(result: ReplayCourseResult): boolean {
  const last = result.stages.at(-1);
  return last !== undefined && isCourseStageFailed(last.ruleset, last.gauge);
}

/**
 * Re-judges a course replay under `options.ruleset` by ADR 0019's rules, as {@link rejudgeReplay} does for one play:
 * a stage log the ruleset cannot read makes the run `not-simulated`. A run that the played ruleset ended at a failed
 * stage (its last played stage cut where its gauge emptied, or followed by unreached stages) is `truncated` under a
 * ruleset whose gauge would have carried on, since the stages and notes after that point were never played.
 */
export function rejudgeCourseReplay(
  courseLog: BeMusicCourseReplay,
  options: Omit<SimulateReplayOptions, 'course'>,
): ReplayCourseRejudgeOutcome {
  const logs = courseLog.nonstop !== undefined ? [courseLog.nonstop.replay] : [];
  const stageLogs = courseLog.stages.flatMap((entry) => (entry.played ? [entry.replay] : []));
  for (const [index, log] of [...logs, ...stageLogs].entries()) {
    const reason = findReplayNotSimulatedReason(log, options.ruleset, options.player);
    if (reason !== undefined) {
      const stage = index - logs.length;
      return { status: 'not-simulated', reason, ...(stage >= 0 ? { stage } : {}) };
    }
  }
  const lastLog = courseLog.nonstop?.replay ?? stageLogs.at(-1);
  if (lastLog === undefined || options.ruleset === playedRuleset(lastLog)) {
    return { status: 'simulated', result: simulateCourseReplay(courseLog, options) };
  }
  const stoppedAtUs = findFailureStop(lastLog, options);
  if (stoppedAtUs === undefined) {
    const result = simulateCourseReplay(courseLog, options);
    const unreached =
      courseLog.nonstop === undefined && stageLogs.length < courseLog.stages.length && lastLog.play.aborted !== true;
    if (!unreached || endedOnFailedStage(result)) return { status: 'simulated', result };
    // A stage passed here that failed the played run: the stages after it were never played.
    const played = simulateCourseReplay(courseLog, { ...options, ruleset: playedRuleset(lastLog) });
    return endedOnFailedStage(played) ? { status: 'truncated', result } : { status: 'simulated', result };
  }
  const cut = stopReplayAt(lastLog, stoppedAtUs);
  const judged: BeMusicCourseReplay =
    courseLog.nonstop !== undefined
      ? { ...courseLog, nonstop: { ...courseLog.nonstop, replay: cut } }
      : {
          ...courseLog,
          stages: courseLog.stages.map((entry) =>
            entry.played && entry.replay === lastLog ? { played: true, replay: cut } : entry,
          ),
        };
  const result = simulateCourseReplay(judged, options);
  const failed =
    courseLog.nonstop !== undefined
      ? simulateReplay(cut, options).gauge.failedMidPlay === true
      : result.stages.at(-1)?.gauge.failedMidPlay === true;
  return failed ? { status: 'simulated', result } : { status: 'truncated', result };
}

/**
 * A replay's gauge under each gauge of its ruleset: what the play's gauge graph would have drawn had it been played on
 * that gauge. beatoraja keeps every gauge's log during a play and its result screen steps the graph through them
 * (`MusicResult` CHANGE_GRAPH); a Be-Music play runs the gauges it needs, so the others are re-simulated from the
 * replay. Pure and deterministic, like the simulation it observes.
 */

import type { RulesetCourseKind } from '../ruleset/course.ts';
import type { RulesetId } from '../ruleset/definitions.ts';
import { resolveGaugeShiftLadder } from '../ruleset/gauge-shift.ts';
import type { BeMusicReplay } from './format.ts';
import { resolveRulesetConfig } from './rulesets.ts';
import { simulateReplay } from './simulate.ts';

/** One gauge's run over a replay: its value before the first judgment and just after each one. */
export interface ReplayGaugeHistory {
  /** The ruleset's own gauge id (`NORMAL`, `EX-HARD`, `GROOVE`, ...). */
  readonly gauge: string;
  /** The gauge's starting value, in percent of its maximum. */
  readonly initial: number;
  /** The gauge just after each judgment, in scoring order: chart µs and percent of its maximum. */
  readonly samples: readonly { readonly atUs: number; readonly gauge: number }[];
}

export interface ReplayGaugeHistoriesOptions {
  /** The ruleset to judge under; the replay's own by default. */
  readonly ruleset?: RulesetId;
  /** The course kind whose gauges to run instead of a single play's. */
  readonly courseKind?: RulesetCourseKind;
  /**
   * Chart µs the play stopped at, when it stopped early (its gauge emptied): judgments after it are left out, since
   * the play made none.
   */
  readonly untilUs?: number;
}

/**
 * The gauge histories of `replay` under each gauge of the ruleset's line-up (`resolveGaugeShiftLadder`), gentlest
 * first. Each gauge runs on its own from its starting value, with no auto-shift, and to the end of the inputs even
 * when it empties, so a survival gauge that fails stays at 0 as the graph draws it.
 */
export function resolveReplayGaugeHistories(
  replay: BeMusicReplay,
  options: ReplayGaugeHistoriesOptions = {},
): ReplayGaugeHistory[] {
  const ruleset = options.ruleset ?? replay.play.judgeRuleset ?? 'lr2';
  const untilUs = options.untilUs ?? Number.POSITIVE_INFINITY;
  return resolveGaugeShiftLadder(ruleset, options.courseKind).map((gauge) => {
    const forced = { gauge, gaugeAutoShift: 'NONE' as const };
    const spec = resolveRulesetConfig(replay, ruleset, forced).gauge;
    const samples: { atUs: number; gauge: number }[] = [];
    simulateReplay(replay, {
      ...forced,
      ruleset,
      endOnFailure: false,
      onJudgment: (event) => {
        if (event.atUs <= untilUs) samples.push({ atUs: event.atUs, gauge: event.gauge });
      },
    });
    return { gauge, initial: spec.max > 0 ? (spec.initial / spec.max) * 100 : 0, samples };
  });
}

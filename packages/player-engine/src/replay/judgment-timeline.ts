/**
 * A replay's judgment timeline: every judgment the replay simulation scores under one ruleset, in the order it scores
 * them, each with the running combo, EX score and gauge just after it. What a replay ghost plays back beside a live play
 * (docs/replay.md, "Ghost"): its notes go as the timeline settles them, its plates and HUD follow the running totals.
 * Pure and deterministic, like the simulation it observes.
 */

import type { BeMusicReplay, ReplayRulesetResult } from './format.ts';
import { simulateReplay, type ReplayJudgmentEvent, type SimulateReplayOptions } from './simulate.ts';

/** A replay's judgments in scoring order, and the result the same simulation derived. */
export interface ReplayJudgmentTimeline {
  /** Every judgment, in the order the simulation scored them (non-decreasing `atUs`). */
  readonly events: readonly ReplayJudgmentEvent[];
  readonly result: ReplayRulesetResult;
}

/**
 * Re-simulates `replay` under `options.ruleset` and returns its judgment timeline ({@link ReplayJudgmentTimeline}).
 * The totals of the last event are the result's (EX score, max combo); `onJudgment` is the timeline's own.
 */
export function resolveReplayJudgmentTimeline(
  replay: BeMusicReplay,
  options: Omit<SimulateReplayOptions, 'onJudgment'>,
): ReplayJudgmentTimeline {
  const events: ReplayJudgmentEvent[] = [];
  const result = simulateReplay(replay, { ...options, onJudgment: (event) => events.push(event) });
  return { events, result };
}

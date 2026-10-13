import { PLAYLOG_SIMULATOR_RULESETS } from '@be-music/player/playlog';

/**
 * The rulesets every play is simulated and ranked under, in display order: the simulator's own list. The one list the
 * database enums, the API schemas and the pages read.
 */
export const RULESET_IDS = PLAYLOG_SIMULATOR_RULESETS;

export type RulesetId = (typeof RULESET_IDS)[number];

export function isRuleset(value: string | undefined): value is RulesetId {
  return value !== undefined && (RULESET_IDS as readonly string[]).includes(value);
}

/** Orders anything keyed by ruleset in {@link RULESET_IDS} order. */
export const byRulesetOrder = (left: { ruleset: string }, right: { ruleset: string }): number =>
  (RULESET_IDS as readonly string[]).indexOf(left.ruleset) - (RULESET_IDS as readonly string[]).indexOf(right.ruleset);

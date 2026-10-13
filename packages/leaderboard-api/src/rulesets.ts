import type { PlaylogRulesetId } from '@be-music/player/playlog';

/**
 * The rulesets every play is simulated and ranked under, in display order. The one list the database enums, the API
 * schemas and the pages read.
 */
export const RULESET_IDS = ['lr2', 'beatoraja', 'iidx'] as const satisfies readonly PlaylogRulesetId[];

export type RulesetId = (typeof RULESET_IDS)[number];

export function isRuleset(value: string | undefined): value is RulesetId {
  return value !== undefined && (RULESET_IDS as readonly string[]).includes(value);
}

/** Orders anything keyed by ruleset in {@link RULESET_IDS} order. */
export const byRulesetOrder = (left: { ruleset: string }, right: { ruleset: string }): number =>
  (RULESET_IDS as readonly string[]).indexOf(left.ruleset) - (RULESET_IDS as readonly string[]).indexOf(right.ruleset);

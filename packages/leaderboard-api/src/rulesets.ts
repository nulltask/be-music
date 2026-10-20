import { RULESET_IDS } from '@be-music/player/ruleset';
/**
 * The shared rulesets in display order: the one list the database enums, API schemas and pages read.
 */
export { RULESET_IDS };

export type RulesetId = (typeof RULESET_IDS)[number];

export function isRuleset(value: string | undefined): value is RulesetId {
  return value !== undefined && (RULESET_IDS as readonly string[]).includes(value);
}

/** Orders anything keyed by ruleset in {@link RULESET_IDS} order. */
export const byRulesetOrder = (left: { ruleset: string }, right: { ruleset: string }): number =>
  (RULESET_IDS as readonly string[]).indexOf(left.ruleset) - (RULESET_IDS as readonly string[]).indexOf(right.ruleset);

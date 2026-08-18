/**
 * Ruleset definitions — the single source of truth for how LR2, beatoraja, and IIDX judge a play.
 *
 * Both the live engine and the play-log simulator resolve their behavior from here: each builds a
 * {@link RulesetChartFacts} from its own chart representation and calls {@link resolveRuleset}. The numeric
 * constants and their primary sources are documented in `definitions.ts`.
 */
export * from './facts.ts';
export * from './definitions.ts';
export * from './gauge.ts';

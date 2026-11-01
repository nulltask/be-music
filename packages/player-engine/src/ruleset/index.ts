/**
 * Ruleset definitions — the single source of truth for how LR2, beatoraja, and That-Which-Must-Not-Be-Named judge a play.
 *
 * Both the live engine and the replay simulator resolve their behavior from here: each builds a
 * {@link RulesetChartFacts} from its own chart representation and calls {@link resolveRuleset}. The numeric
 * constants and their primary sources are documented in `definitions.ts`.
 */
export * from './facts.ts';
export * from './bmson-total.ts';
export * from './clear-lamp.ts';
export * from './course.ts';
export * from './definitions.ts';
export * from './gauge.ts';
export * from './gauge-type.ts';
export * from './judge.ts';
export * from './selection.ts';
export * from './chart-facts.ts';
export * from './long-note.ts';
export * from './custom-judge.ts';
export * from './chart-judge.ts';

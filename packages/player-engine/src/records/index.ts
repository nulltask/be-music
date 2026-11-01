/**
 * `@be-music/player-engine/records`: best records and the rules every host keeps them by. A best record is the best clear
 * lamp, EX-SCORE, max combo and BP a player has on a chart or a course under one judge ruleset; these rules merge a play
 * into one, read what a play contributes, fold a course stage into its chart's record and say which plays keep a
 * record. The player's dan rank (`dan-rank.ts`) is kept per key mode from the GRADE courses they clear. Where and how a host
 * stores its records is its own business.
 */
export * from './best-record.ts';
export * from './dan-rank.ts';

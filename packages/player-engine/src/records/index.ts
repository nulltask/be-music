/**
 * `@be-music/player-engine/records`: best records and the rules every host keeps them by. A best record is the best clear
 * lamp, EX-SCORE, max combo and BP a player has on a chart or a course under one judge ruleset; these rules merge a play
 * into one, read what a play contributes, fold a course stage into its chart's record and say which plays keep a
 * record. The dan rank is the highest dan a player has cleared a GRADE course of, per key mode. Where and how a host
 * stores its records is its own business.
 */
export * from './best-record.ts';
export * from './dan-rank.ts';

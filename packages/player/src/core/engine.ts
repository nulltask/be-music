/**
 * The playback engine's public surface (`@be-music/player`).
 *
 * The engine is a deterministic judge core and one play loop around it:
 *
 * - `judge-core.ts` / `auto-judge-core.ts` — pure judge state machines (`step(state, input) → effects`);
 * - `play.ts` — `manualPlay` / `autoPlay`: a play session (`play-session.ts`) run through the play loop
 *   (`play-loop.ts`, `play-controls.ts`, `play-finish.ts`) with a judge strategy (`play-manual.ts`, `play-replay.ts`,
 *   `play-auto.ts`) plugged in;
 * - `engine-effects.ts` — maps core effects onto the host's audio session, UI buses, replay and trace;
 * - `engine-preparation.ts`, `engine-audio.ts`, `engine-clock.ts`, `engine-trace.ts`, `engine-types.ts` — the
 *   services around the loop and the public types.
 *
 * What a host's runtimes exchange with a running play, the lanes, what a host shows and the ruleset vocabulary are the
 * `./signals`, `./lanes`, `./display` and `./ruleset` entries.
 */
export * from './engine-types.ts';
export { autoPlay, manualPlay } from './play.ts';
export { resolveChartRulesetFacts, resolvePlayChart } from './engine-preparation.ts';
export { createTempoClock, type TempoClock, type TempoClockSegment } from './tempo-clock.ts';
export { preparePlaybackChart, type PreparedPlaybackChartData } from './bootstrap.ts';

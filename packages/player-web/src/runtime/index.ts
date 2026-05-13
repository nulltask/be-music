/**
 * Barrel for the `@be-music/player-web/runtime` subpath. Re-exports the audio bus + gameplay recorder — the per-frame
 * runtime plumbing the demo wires into the scene host.
 *
 * The lower-level runtime helpers (engine driver, web-audio session, web-input runtime, web-ui runtime) stay internal:
 * they back `audio-bus.ts` and the scene classes but aren't part of the public contract today.
 */
export * from './audio-bus.ts';

// Gameplay recorder lives in its own directory but is conceptually a runtime output channel — same scope as the
// audio bus that feeds it.
export * from '../recording/gameplay-recorder.ts';

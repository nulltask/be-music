import {
  applyHighSpeedControlAction,
  resolveHighSpeedControlActionFromLaneChannels,
  type HighSpeedControlAction,
} from './high-speed-control.ts';
import { resolveJudgeWindowsMs } from './judge-window.ts';
import {
  type JudgeWindowSetUs,
  type LongNoteStyle,
  type PlaylogRulesetId,
  type RulesetWindowTables,
  type WindowPairUs,
} from '../ruleset/index.ts';
import { preparePlaybackChart, preparePlaybackChartData, type PreparedPlaybackChartData } from './bootstrap.ts';
import { type PlayerSummary } from './engine-types.ts';

/**
 * The playback engine's public surface (`@be-music/player` and `@be-music/player/core/engine`).
 *
 * The engine is split into a deterministic judge core and the drivers around it:
 *
 * - `judge-core.ts` / `auto-judge-core.ts` — pure judge state machines (`step(state, input) → effects`);
 * - `manual-play.ts` / `auto-play.ts` — the drivers: clock, input, audio, UI and logging around the cores;
 * - `engine-effects.ts` — maps core effects onto the host's audio session, UI buses, play log and trace;
 * - `engine-preparation.ts`, `engine-audio.ts`, `engine-clock.ts`, `engine-trace.ts`, `engine-types.ts` — the
 *   driver-side services and the public types.
 */
export * from './engine-types.ts';
export { autoPlay } from './auto-play.ts';
export { manualPlay } from './manual-play.ts';
export {
  formatRandomPatternSummary,
  resolveBmsControlFlowForPlayback,
  resolveChartRulesetFacts,
  resolvePlayChart,
} from './engine-preparation.ts';
export { resolveBgmHeadroomGain, shouldUseAutoMixBgmHeadroomControl } from './engine-audio.ts';

export type { JudgeWindowSetUs, LongNoteStyle, PlaylogRulesetId, RulesetWindowTables, WindowPairUs };

export { applyHighSpeedControlAction, resolveHighSpeedControlActionFromLaneChannels, type HighSpeedControlAction };

export { resolveJudgeWindowsMs };

export { preparePlaybackChart, preparePlaybackChartData, type PreparedPlaybackChartData };

export function applyFastSlowForJudge(
  summary: Pick<PlayerSummary, 'fast' | 'slow'>,
  judge: 'PERFECT' | 'GREAT' | 'GOOD',
  signedDeltaMs: number,
): void {
  if (judge === 'GREAT' || judge === 'GOOD') {
    if (signedDeltaMs < 0) {
      summary.fast += 1;
    } else if (signedDeltaMs > 0) {
      summary.slow += 1;
    }
  }
}

export {
  extractInvisiblePlayableNotes,
  extractLandmineNotes,
  extractPlayableNotes,
  extractTimedNotes,
} from '../playable-notes.ts';

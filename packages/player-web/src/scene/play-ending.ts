import type { TimingResolver } from '@be-music/audio-renderer/triggers';
import type { PlayerSummary } from '@be-music/player/core/engine';
import { chartToElapsedSeconds } from '../runtime/play-tempo.ts';
import { resolvePostChartResultDelayMs } from './core/gameplay-result-delay.ts';

/**
 * How a play ends, shared by both gameplay families (the LR2 / built-in view and the beatoraja view), so the two time
 * their outro the same way:
 *
 * - A play that reaches its end holds the scene for a lead-out after the last note (`resolvePostChartResultDelayMs`,
 *   in chart time), then runs the theme / skin fade-out, then shows the result.
 * - A play cut short by its gauge emptying (a course stage, a HARD gauge ending on failure) has no lead-out: its sound
 *   and picture fade out together, for at least {@link FAILED_FADE_OUT_MS}, then the result shows. A gauge that emptied
 *   but played on to the end ends normally.
 */

/** How long a failed play's sound and picture fade out at least, before its result shows. */
export const FAILED_FADE_OUT_MS = 1500;

/** A note's span, as the lead-out reads it. */
export type PlayEndingNote = { beat: number; endBeat?: number; seconds: number; endSeconds?: number };

export interface PlayEndingInput {
  /** The engine's final summary, when the play has ended (`undefined` while a held play is still open). */
  summary: Pick<PlayerSummary, 'gauge'> | undefined;
  /** The chart's judged notes. */
  notes: ReadonlyArray<PlayEndingNote>;
  timing: Pick<TimingResolver, 'beatToSeconds'> | undefined;
  /** Where the play is, in chart seconds. */
  currentSeconds: number;
  /** The play tempo: the lead-out is chart time, so at another tempo it takes 1 / tempo as long. */
  tempo: number;
  /** The theme's / skin's own fade-out, in ms (0 when it has none). */
  themeFadeOutMs: number;
}

export interface PlayEnding {
  /** The play was cut short by its gauge emptying, with notes still to come. */
  failed: boolean;
  /** Wall-clock ms to hold the scene before the fade-out starts. */
  leadOutMs: number;
  /** Wall-clock ms the fade-out runs. */
  fadeOutMs: number;
  /** Whether the sound fades with the picture (a normal end lets the last keysounds ring). */
  fadeAudio: boolean;
}

export function resolvePlayEnding(input: PlayEndingInput): PlayEnding {
  const { notes, currentSeconds } = input;
  const failed = input.summary?.gauge?.failedMidPlay === true && notes.some((note) => note.seconds > currentSeconds);
  if (failed) {
    return {
      failed,
      leadOutMs: 0,
      fadeOutMs: Math.max(input.themeFadeOutMs, FAILED_FADE_OUT_MS),
      fadeAudio: true,
    };
  }
  return {
    failed,
    leadOutMs: chartToElapsedSeconds(resolvePostChartResultDelayMs(notes, input.timing, currentSeconds), input.tempo),
    fadeOutMs: Math.max(0, input.themeFadeOutMs),
    fadeAudio: false,
  };
}

/** The picture's alpha `elapsedMs` into a fade-out of `fadeOutMs`: 1 → 0, and 1 when there is no fade. */
export function playEndingFadeAlpha(elapsedMs: number, fadeOutMs: number): number {
  if (!(fadeOutMs > 0)) return 1;
  return Math.max(0, Math.min(1, 1 - elapsedMs / fadeOutMs));
}

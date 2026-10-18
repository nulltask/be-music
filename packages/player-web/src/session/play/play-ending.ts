/**
 * The ending of a play (`PlaySession`): how it ends ({@link resolvePlayEnding}), the theme's exit timeline (fade-out,
 * then close) before the host takes over, and the result the play hands the host.
 *
 * The exit timeline and the result read and write the scene's state through {@link PlayEndingContext}; the play
 * session passes itself.
 */

import type { TimingResolver } from '@be-music/audio-renderer/triggers';
import type { PlayerSummary } from '@be-music/player/core/engine';
import type { BeMusicPlaylog } from '@be-music/player/playlog';
import type { ScoreSummary } from '@be-music/player/ruleset';
import type { PlayerGaugeSummary } from '@be-music/player/core/ui-signal-bus';
import { gaugePercent, playResultFromPlayState, type PlayResult, type PlayState } from '@be-music/scene-model';
import type { BrowserSongEntry } from '../../collection/types.ts';
import type { AudioBusHandle } from '../../runtime/audio-bus.ts';
import { chartToElapsedSeconds } from '../../runtime/play-tempo.ts';
import type { PlaySessionTheme } from './play-session-theme.ts';
import { resolvePostChartResultDelayMs } from './result-delay.ts';

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

/** The scene's members the ending reads and writes: the play session's members of these names. */
export interface PlayEndingContext {
  readonly theme: PlaySessionTheme;
  readonly disposed: boolean;
  exiting: boolean;
  exitFadeOutMs: number;
  exitFadeStartedAt: number | undefined;
  exitFadeOutHandle: number | undefined;
  exitCloseHandle: number | undefined;
  readonly audioBus: AudioBusHandle | undefined;
  readonly song: BrowserSongEntry | undefined;
  readonly score: ScoreSummary;
  /** The engine's gauge as of its last frame: its clear border and the TOTAL it runs on. */
  readonly gaugeState: PlayerGaugeSummary;
  playState: PlayState;
  readonly fastCount: number;
  readonly slowCount: number;
  readonly playlog: BeMusicPlaylog | undefined;
  playClock(): number;
  currentSeconds(): number;
  resolveSongDurationSeconds(): number;
  resolveJudgeRuleset(): string;
  /** Whether `score.poor` folds the empty POORs in (LR2). */
  resolveEmptyPoorCountsInPoorDisplay(): boolean;
}

/**
 * Drives the theme's scene-exit timeline (fade-out → close; LR2 `#FADEOUT` → `#CLOSE`) before handing control back
 * to the host. Raises `exit-fade-out` at call time so theme chrome gated on it (the LR2 family's timer 2, typically a
 * full-screen alpha overlay) plays its authored fade-out; once the fade has elapsed it raises `exit-close` so
 * close-gated chrome (the LR2 default 7-keys STAGE FAILED / CLEARED plate on timer 3) plays before the actual
 * transition fires.
 *
 * Idempotent — re-entry while a fade is in flight is a no-op, so a frantic second ESC press doesn't double-fire the
 * host callback. Themes with no fade-out / close timing collapse to immediate dispatch (the skinless behaviour).
 */
export function beginExitSequence(
  ctx: PlayEndingContext,
  callback: () => void,
  options: { fadeAudio?: boolean; minFadeOutMs?: number } = {},
): void {
  if (ctx.exiting || ctx.disposed) {
    callback();
    return;
  }
  ctx.exiting = true;
  const closeMs = ctx.theme.timing().closeMs;
  // A failed play fades out even on a theme without a fade-out of its own (`minFadeOutMs`).
  const fadeOutMs = Math.max(ctx.theme.timing().fadeOutMs, options.minFadeOutMs ?? 0);
  ctx.exitFadeOutMs = fadeOutMs;
  if (fadeOutMs <= 0 && closeMs <= 0) {
    callback();
    return;
  }
  const fadeStartedAt = ctx.playClock();
  ctx.exitFadeStartedAt = fadeStartedAt;
  ctx.theme.moment({ kind: 'exit-fade-out', at: fadeStartedAt });
  // Drive the audio bus's post-tap fade in lock-step with `applyExitFadeAlpha`'s screen-alpha animation. The fade
  // node sits AFTER the recording tap, so a recording in flight keeps capturing the unattenuated mix; only the
  // speakers go quiet. Skipped when the theme has no fade-out (the screen also stays at full alpha in that path), so
  // a skinless demo gets the historical immediate-cut behavior.
  if (fadeOutMs > 0 && options.fadeAudio !== false) {
    ctx.audioBus?.fadeOutAudibleTo(0, fadeOutMs);
  }
  const fireClose = (): void => {
    ctx.theme.moment({ kind: 'exit-close', at: ctx.playClock() });
    ctx.exitCloseHandle = window.setTimeout(() => {
      ctx.exitCloseHandle = undefined;
      if (ctx.disposed) return;
      callback();
    }, closeMs);
  };
  if (fadeOutMs <= 0) {
    fireClose();
    return;
  }
  ctx.exitFadeOutHandle = window.setTimeout(() => {
    ctx.exitFadeOutHandle = undefined;
    if (ctx.disposed) return;
    if (closeMs <= 0) {
      callback();
      return;
    }
    fireClose();
  }, fadeOutMs);
}

/**
 * The play as a result (`PlaySession.getResultData`): read off the play state (`playResultFromPlayState`), with the
 * graphs ending at the playhead so they reach the right edge even when the last judgment came well before the chart's
 * end, the clear lamp by the one clear-lamp rule, and the scores as the readouts show them (under LR2 with the POOR
 * judgments alone beside them, `judgedPoor`, so a record's BP counts each empty POOR once); with the gauge's clear
 * border (in percent) and TOTAL, which a beatoraja result skin shows.
 */
export function getResultData(ctx: PlayEndingContext): PlayResult | undefined {
  if (!ctx.song) {
    return undefined;
  }
  const gauge = ctx.gaugeState;
  const result = playResultFromPlayState(ctx.playState, {
    song: ctx.song,
    score: ctx.score,
    seconds: ctx.currentSeconds(),
    judgeRuleset: ctx.resolveJudgeRuleset(),
    fast: ctx.fastCount,
    slow: ctx.slowCount,
    ...(ctx.playlog !== undefined ? { playlog: ctx.playlog } : {}),
  });
  return {
    ...result,
    // Folded, `score.poor` is the engine's `poor + emptyPoor` (`resolveDisplayedPoor`).
    ...(ctx.resolveEmptyPoorCountsInPoorDisplay() ? { judgedPoor: ctx.score.poor - ctx.score.emptyPoor } : {}),
    ...(gauge.max > 0 ? { gaugeBorder: gaugePercent({ current: gauge.clearThreshold, max: gauge.max }) } : {}),
    // The TOTAL the engine reports; the placeholder gauge before its first frame has none.
    ...(gauge.effectiveTotal > 0 ? { gaugeTotal: gauge.effectiveTotal } : {}),
  };
}

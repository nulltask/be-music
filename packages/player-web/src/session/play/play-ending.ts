/**
 * The ending of a play (`PlaySession`): how it ends ({@link resolvePlayEnding}), the theme's exit timeline (the fade-out
 * of a normal exit, or the stop of a failed play) before the host takes over, and the result the play hands the host.
 *
 * The exit timeline and the result read and write the scene's state through {@link PlayEndingContext}; the play
 * session passes itself.
 */

import type { TimingResolver } from '@be-music/chart';
import type { PlayerSummary } from '@be-music/player';
import type { BeMusicPlaylog } from '@be-music/player/playlog';
import type { ScoreSummary } from '@be-music/player/ruleset';
import type { PlayerGaugeSummary } from '@be-music/player/signals';
import {
  gaugePercent,
  playResultFromPlayState,
  type LibraryChart,
  type PlayResult,
  type PlayState,
} from '@be-music/scene-model';
import type { AudioBusHandle } from '../../runtime/audio-bus.ts';
import { chartToElapsedSeconds } from '../../runtime/play-tempo.ts';
import type { PlaySessionTheme } from './play-session-theme.ts';
import { resolvePostChartResultDelayMs } from './result-delay.ts';

/**
 * How a play ends, shared by every gameplay family (built-in, LR2 and beatoraja), so they time their outro the same way:
 *
 * - A play that reaches its end holds the scene for a lead-out after the last note (`resolvePostChartResultDelayMs`,
 *   in chart time), then runs the theme / skin fade-out (LR2 timer 2, beatoraja `TIMER_FADEOUT`), then shows the
 *   result. Escape and F5 run the same fade-out.
 * - A play cut short by its gauge emptying (a course stage, a HARD gauge ending on failure) stops at once, as LR2 and
 *   beatoraja do: no lead-out and no fade-out timer; the failure moment (LR2 timer 3, beatoraja `TIMER_FAILED`) starts,
 *   the sound is cut, and the result shows after the skin's close time (LR2 `#CLOSE`, beatoraja `close`). A theme
 *   without a close time (the built-in skins) holds for {@link FAILED_CLOSE_MS} instead, fading its picture. A gauge
 *   that emptied but played on to the end ends normally.
 */

/**
 * How long a failed play holds before its result shows on a theme with no close time of its own (be-music's choice:
 * LR2 and beatoraja wait for the skin's close time, 1500 ms on beatoraja's default skins).
 */
export const FAILED_CLOSE_MS = 1500;

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
}

export interface PlayEnding {
  /** The play was cut short by its gauge emptying, with notes still to come: it stops instead of fading out. */
  failed: boolean;
  /** Wall-clock ms to hold the scene before the exit starts. */
  leadOutMs: number;
}

export function resolvePlayEnding(input: PlayEndingInput): PlayEnding {
  const { notes, currentSeconds } = input;
  const failed = input.summary?.gauge?.failedMidPlay === true && notes.some((note) => note.seconds > currentSeconds);
  if (failed) return { failed, leadOutMs: 0 };
  return {
    failed,
    leadOutMs: chartToElapsedSeconds(resolvePostChartResultDelayMs(notes, input.timing, currentSeconds), input.tempo),
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
  readonly song: LibraryChart | undefined;
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

export interface ExitSequenceOptions {
  /** The play failed: it stops ({@link beginExitSequence}) instead of fading out. */
  failed?: boolean;
  /** Whether a normal exit's sound fades with the picture (default `true`; the chart's end lets its keysounds ring). */
  fadeAudio?: boolean;
}

/**
 * Drives the theme's scene-exit timeline before handing control back to the host. Idempotent: re-entry while one is in
 * flight calls `callback` at once (a frantic second ESC press does not double-fire the host callback twice over).
 *
 * - **A normal exit** (the chart's end, Escape, F5) raises `exit-fade-out` (LR2 timer 2, beatoraja `TIMER_FADEOUT`)
 *   and fades the picture (and, unless `fadeAudio` is `false`, the sound) over the theme's fade-out (LR2 `#FADEOUT`,
 *   beatoraja `fadeout`), then calls
 *   `callback`. It never starts the failure timer: LR2 starts timer 3 only on a failure (OpenLR2 `LR2f.cpp`
 *   L12686-L12697, L12915-L12925; the chart's end and ESC start timer 2 alone, L12976-L12978, L7732-L7741). A theme
 *   with no fade-out calls `callback` at once.
 * - **A failed play** (`failed`) stops at once, as LR2 (`procPhase = 3`) and beatoraja (`STATE_FAILED`) do: it raises
 *   `exit-close` (LR2 timer 3, beatoraja `TIMER_FAILED`), cuts the sound at once (the speakers, after the recording
 *   tap), and calls `callback` after the theme's close time (LR2 `#CLOSE`, beatoraja `close`; OpenLR2 L7748-L7752,
 *   beatoraja `BMSPlayer` L693-L742) with no fade-out timer. A theme with no close time holds for
 *   {@link FAILED_CLOSE_MS}, fading its picture over it.
 */
export function beginExitSequence(
  ctx: PlayEndingContext,
  callback: () => void,
  options: ExitSequenceOptions = {},
): void {
  if (ctx.exiting || ctx.disposed) {
    callback();
    return;
  }
  ctx.exiting = true;
  const at = ctx.playClock();
  if (options.failed === true) {
    const closeMs = ctx.theme.timing().closeMs;
    const holdMs = closeMs > 0 ? closeMs : FAILED_CLOSE_MS;
    ctx.theme.moment({ kind: 'exit-close', at });
    // LR2 stops every keysound and beatoraja every sound at once; the post-tap gain keeps a recording's mix whole.
    ctx.audioBus?.fadeOutAudibleTo(0, 0);
    if (closeMs <= 0) {
      // No close time of its own: the picture fades over the hold (the built-in skins' look).
      ctx.exitFadeOutMs = holdMs;
      ctx.exitFadeStartedAt = at;
    } else {
      ctx.exitFadeOutMs = 0;
      ctx.exitFadeStartedAt = undefined;
    }
    ctx.exitCloseHandle = window.setTimeout(() => {
      ctx.exitCloseHandle = undefined;
      if (ctx.disposed) return;
      callback();
    }, holdMs);
    return;
  }
  const fadeOutMs = ctx.theme.timing().fadeOutMs;
  ctx.exitFadeOutMs = fadeOutMs;
  if (fadeOutMs <= 0) {
    callback();
    return;
  }
  ctx.exitFadeStartedAt = at;
  ctx.theme.moment({ kind: 'exit-fade-out', at });
  // Drive the audio bus's post-tap fade in lock-step with `applyExitFadeAlpha`'s screen-alpha animation. The fade
  // node sits AFTER the recording tap, so a recording in flight keeps capturing the unattenuated mix; only the
  // speakers go quiet.
  if (options.fadeAudio !== false) ctx.audioBus?.fadeOutAudibleTo(0, fadeOutMs);
  ctx.exitFadeOutHandle = window.setTimeout(() => {
    ctx.exitFadeOutHandle = undefined;
    if (ctx.disposed) return;
    callback();
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

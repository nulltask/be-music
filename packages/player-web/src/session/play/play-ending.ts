/**
 * The ending of a play on the built-in and LR2 gameplay scenes (`CoreGameplayView`): the theme's exit timeline (fade-out,
 * then close) before the host takes over, and the result the play hands the host.
 *
 * The functions read and write the scene's state through {@link PlayEndingContext}; the scene passes itself.
 */

import type { BeMusicPlaylog } from '@be-music/player/playlog';
import type { ScoreSummary } from '@be-music/player/ruleset';
import { playResultFromPlayState, type PlayState } from '@be-music/scene-model';
import type { BrowserSongEntry } from '../../collection/types.ts';
import type { AudioBusHandle } from '../../runtime/audio-bus.ts';
import type { GameplayThemeHooks } from '../../scene/core/gameplay-theme.ts';
import type { PixiGameplayResultData } from '../../scene/core/result-data.ts';

/** The scene's members the ending reads and writes: `CoreGameplayView`'s members of these names. */
export interface PlayEndingContext {
  readonly theme: GameplayThemeHooks;
  readonly disposed: boolean;
  exiting: boolean;
  exitFadeOutMs: number;
  exitFadeStartedAt: number | undefined;
  exitFadeOutHandle: number | undefined;
  exitCloseHandle: number | undefined;
  readonly audioBus: AudioBusHandle | undefined;
  readonly song: BrowserSongEntry | undefined;
  readonly score: ScoreSummary;
  playState: PlayState;
  readonly fastCount: number;
  readonly slowCount: number;
  readonly playlog: BeMusicPlaylog | undefined;
  playClock(): number;
  currentSeconds(): number;
  resolveSongDurationSeconds(): number;
  resolveJudgeRuleset(): string;
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
  const closeMs = ctx.theme.themeTiming().closeMs;
  // A failed play fades out even on a theme without a fade-out of its own (`minFadeOutMs`).
  const fadeOutMs = Math.max(ctx.theme.themeTiming().fadeOutMs, options.minFadeOutMs ?? 0);
  ctx.exitFadeOutMs = fadeOutMs;
  if (fadeOutMs <= 0 && closeMs <= 0) {
    callback();
    return;
  }
  const fadeStartedAt = ctx.playClock();
  ctx.exitFadeStartedAt = fadeStartedAt;
  ctx.theme.onThemeEvent({ kind: 'exit-fade-out', at: fadeStartedAt });
  // Drive the audio bus's post-tap fade in lock-step with `applyExitFadeAlpha`'s screen-alpha animation. The fade
  // node sits AFTER the recording tap, so a recording in flight keeps capturing the unattenuated mix; only the
  // speakers go quiet. Skipped when the theme has no fade-out (the screen also stays at full alpha in that path), so
  // a skinless demo gets the historical immediate-cut behavior.
  if (fadeOutMs > 0 && options.fadeAudio !== false) {
    ctx.audioBus?.fadeOutAudibleTo(0, fadeOutMs);
  }
  const fireClose = (): void => {
    ctx.theme.onThemeEvent({ kind: 'exit-close', at: ctx.playClock() });
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
 * The play as a result (`CoreGameplayView.getResultData`): read off the play state (`playResultFromPlayState`), with the
 * graphs ending at the playhead so they reach the right edge even when the last judgment came well before the chart's
 * end, the clear lamp by the one clear-lamp rule, and the scores as the readouts show them.
 */
export function getResultData(ctx: PlayEndingContext): PixiGameplayResultData | undefined {
  if (!ctx.song) {
    return undefined;
  }
  return playResultFromPlayState(ctx.playState, {
    song: ctx.song,
    score: ctx.score,
    seconds: ctx.currentSeconds(),
    judgeRuleset: ctx.resolveJudgeRuleset(),
    fast: ctx.fastCount,
    slow: ctx.slowCount,
    ...(ctx.playlog !== undefined ? { playlog: ctx.playlog } : {}),
  });
}

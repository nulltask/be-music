/**
 * The ending of a play on the built-in and LR2 gameplay scenes (`CoreGameplayView`): the theme's exit timeline (fade-out,
 * then close) before the host takes over, and the result the play hands the host.
 *
 * The functions read and write the scene's state through {@link PlayEndingContext}; the scene passes itself.
 */

import type { BeMusicPlaylog } from '@be-music/player/playlog';
import type { PlayerGaugeSummary } from '@be-music/player/core/ui-signal-bus';
import { resolveClearLamp, type ScoreSummary } from '@be-music/player/ruleset';
import type { BrowserSongEntry } from '../../collection/types.ts';
import type { AudioBusHandle } from '../../runtime/audio-bus.ts';
import type { GameplayThemeHooks } from '../../scene/core/gameplay-theme.ts';
import type { JudgeTimingLog } from '../../scene/core/judge-timing-log.ts';
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
  readonly maxCombo: number;
  readonly gaugeState: PlayerGaugeSummary;
  readonly gaugeHistory: Array<{ progress: number; value: number }>;
  readonly scoreHistory: Array<{ progress: number; exScore: number }>;
  readonly fastCount: number;
  readonly slowCount: number;
  readonly judgeTimings: JudgeTimingLog;
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
  this: PlayEndingContext,
  callback: () => void,
  options: { fadeAudio?: boolean; minFadeOutMs?: number } = {},
): void {
  if (this.exiting || this.disposed) {
    callback();
    return;
  }
  this.exiting = true;
  const closeMs = this.theme.themeTiming().closeMs;
  // A failed play fades out even on a theme without a fade-out of its own (`minFadeOutMs`).
  const fadeOutMs = Math.max(this.theme.themeTiming().fadeOutMs, options.minFadeOutMs ?? 0);
  this.exitFadeOutMs = fadeOutMs;
  if (fadeOutMs <= 0 && closeMs <= 0) {
    callback();
    return;
  }
  const fadeStartedAt = this.playClock();
  this.exitFadeStartedAt = fadeStartedAt;
  this.theme.onThemeEvent({ kind: 'exit-fade-out', at: fadeStartedAt });
  // Drive the audio bus's post-tap fade in lock-step with `applyExitFadeAlpha`'s screen-alpha animation. The fade
  // node sits AFTER the recording tap, so a recording in flight keeps capturing the unattenuated mix; only the
  // speakers go quiet. Skipped when the theme has no fade-out (the screen also stays at full alpha in that path), so
  // a skinless demo gets the historical immediate-cut behavior.
  if (fadeOutMs > 0 && options.fadeAudio !== false) {
    this.audioBus?.fadeOutAudibleTo(0, fadeOutMs);
  }
  const fireClose = (): void => {
    this.theme.onThemeEvent({ kind: 'exit-close', at: this.playClock() });
    this.exitCloseHandle = window.setTimeout(() => {
      this.exitCloseHandle = undefined;
      if (this.disposed) return;
      callback();
    }, closeMs);
  };
  if (fadeOutMs <= 0) {
    fireClose();
    return;
  }
  this.exitFadeOutHandle = window.setTimeout(() => {
    this.exitFadeOutHandle = undefined;
    if (this.disposed) return;
    if (closeMs <= 0) {
      callback();
      return;
    }
    fireClose();
  }, fadeOutMs);
}

/** The play as a result snapshot: `CoreGameplayView.getResultData` (see there). */
export function getResultData(this: PlayEndingContext): PixiGameplayResultData | undefined {
  if (!this.song) {
    return undefined;
  }
  // Append a final "current values @ now" sample so the polyline reaches the right edge of the chart area even when
  // the last judge fired well before the chart's natural end (e.g. AUTO PERFECTs the final note 5 s before the audio
  // tail clears).
  const totalSeconds = this.resolveSongDurationSeconds();
  const finalProgress = totalSeconds > 0 ? Math.max(0, Math.min(1, this.currentSeconds() / totalSeconds)) : 1;
  const gaugeHistory = [...this.gaugeHistory, { progress: finalProgress, value: this.gaugeState.current }];
  const scoreHistory = [...this.scoreHistory, { progress: finalProgress, exScore: this.score.exScore }];
  return {
    // Shallow-clone the score so a downstream consumer mutating their copy doesn't accidentally rewrite our live
    // state.
    score: { ...this.score },
    maxCombo: this.maxCombo,
    gauge: this.gaugeState.current,
    // The clear rule belongs to the ruleset — a threshold comparison for GROOVE/EASY, "never bottomed out" for
    // the survival gauges — so take the engine's verdict rather than re-deriving it from the percentage.
    cleared: this.gaugeState.cleared,
    playSeconds: this.currentSeconds(),
    song: this.song,
    gaugeHistory,
    scoreHistory,
    ...(this.playlog !== undefined ? { playlog: this.playlog } : {}),
    lamp: resolveClearLamp({
      cleared: this.gaugeState.cleared,
      score: this.score,
      ...(this.gaugeState.type !== undefined ? { gauge: this.gaugeState.type } : {}),
      ruleset: this.resolveJudgeRuleset(),
    }),
    gaugeType: this.gaugeState.type,
    judgeRuleset: this.resolveJudgeRuleset(),
    fast: this.fastCount,
    slow: this.slowCount,
    // `clear` swaps in a fresh list for the next play, so the result can keep this one.
    judgeTimings: this.judgeTimings.all,
  };
}

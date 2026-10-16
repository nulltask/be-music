/**
 * The result screen's behaviour, whatever family draws it. The session plays the result's jingle, steps the screen on
 * as the player presses (LR2's result timers) and says where it leads:
 *
 * - Input opens after the view's input delay (LR2's `#STARTINPUT`), and the result's graphs start drawing then.
 * - The graphs finish drawing by themselves {@link RESULT_GRAPH_DRAW_MS} later. Enter, Space or a click before that
 *   skips them; the next press shows the record update, and the one after that continues. A skin without those steps
 *   (`ResultViewTiming.skipsResultSteps`, beatoraja's) continues on the first press.
 * - Escape continues at any time, or once input is open when the skin holds every key back until then (beatoraja's).
 * - R plays the chart again once input is open, when the run offers a quick retry (`ResultPresentation.quickRetry`) and
 *   the host can retry it.
 *
 * The jingle is the theme's clear, fail or generic result jingle (`resolveResultJingles`), the course ones for a course
 * run. It plays through the audio service as the screen enters and stops as it leaves the stage.
 */

import type { BeMusicJson } from '@be-music/json';
import {
  playResultRun,
  resolveResultJingle,
  resolveResultJingles,
  resolveResultPresentation,
  type PlayResult,
  type PlayRunKind,
  type ResultPresentation,
  type SystemSound,
  type SystemSoundSet,
} from '@be-music/scene-model';
import type { AudioService } from '../../runtime/audio-service.ts';
import type { ResultFrame, ResultIntent, ResultViewTiming, SceneLeaving } from '../../view/types.ts';
import type { SceneSession, SessionKeyEvent } from '../session-scene.ts';
import { isResultRetryKey } from './result-keys.ts';

/** How long the result's graphs take to draw once input opens (LR2's default result skin draws for about 3 s). */
export const RESULT_GRAPH_DRAW_MS = 3000;

/** The part of the audio service the result screen uses. */
export type ResultAudio = Pick<AudioService, 'playJingle' | 'stopOwned'>;

/** Where the result screen leads. */
export interface ResultSessionEvents {
  /** The player is done with the result. Fired once per entry. */
  continue(): void;
  /** The player asked to play the chart again; without it the screen offers no quick retry. Fired once per entry. */
  retry?(): void;
}

export interface ResultSessionOptions {
  readonly result: PlayResult;
  /** The chart as the play played it, for the skin's chart graphs; the frame carries it. */
  readonly playChart?: BeMusicJson;
  /** Which play the result is of; the result's own `run` without one. Decides the jingles and the quick retry. */
  readonly run?: PlayRunKind;
  /** The theme's sounds: the result jingles are read from them. */
  readonly sounds: SystemSoundSet;
  readonly audio: ResultAudio;
  /** When the screen takes input and how it leaves, as the view's skin authors it. */
  readonly timing: ResultViewTiming;
  readonly on: ResultSessionEvents;
}

/** Where a leaving result screen goes. */
type ResultLeavingTo = 'continue' | 'retry';

/** The result screen's session. See the module comment. */
export class ResultSession implements SceneSession<ResultFrame, ResultIntent> {
  public readonly kind = 'result' as const;
  /** How the run is presented: the course jingles and the quick retry. */
  public readonly presentation: ResultPresentation;
  private readonly options: ResultSessionOptions;
  private entered = false;
  private disposed = false;
  private enteredAtMs = 0;
  private nowMs = 0;
  private graphShownAtMs: number | undefined;
  private updateShownAtMs: number | undefined;
  private leaving: SceneLeaving<ResultLeavingTo> | undefined;
  /** The leaving screen told the host where it goes; nothing more happens until the next entry. */
  private completed = false;

  public constructor(options: ResultSessionOptions) {
    this.options = options;
    this.presentation = resolveResultPresentation(options.run ?? playResultRun(options.result));
  }

  /** Whether R plays the chart again: the run offers a quick retry and the host can retry it. */
  public get retryOffered(): boolean {
    return this.presentation.quickRetry && this.options.on.retry !== undefined;
  }

  /**
   * The jingle this result plays, if the theme has one for it: the clear or the fail one by its verdict, else the
   * generic one (`resolveResultJingle`).
   */
  public get jingle(): SystemSound | undefined {
    const jingles = resolveResultJingles([this.options.sounds], this.presentation.courseJingles);
    return resolveResultJingle(jingles, this.options.result.cleared);
  }

  /** On the clock, when input opens and the graphs start drawing. */
  private get inputOpenAtMs(): number {
    return this.enteredAtMs + Math.max(0, this.options.timing.inputDelayMs);
  }

  /** Starts the screen from `nowMs` and plays the result's jingle. */
  public enter(nowMs: number): void {
    if (this.disposed) return;
    this.entered = true;
    this.enteredAtMs = nowMs;
    this.nowMs = nowMs;
    this.graphShownAtMs = undefined;
    this.updateShownAtMs = undefined;
    this.leaving = undefined;
    this.completed = false;
    const jingle = this.jingle;
    if (jingle !== undefined) void this.options.audio.playJingle(jingle, { owner: this });
  }

  /** Stops the screen and its jingle. */
  public exit(): void {
    if (!this.entered) return;
    this.entered = false;
    this.options.audio.stopOwned(this);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.exit();
    this.disposed = true;
  }

  public handleKey(event: SessionKeyEvent): boolean {
    if (!this.entered || event.type !== 'down') return false;
    if (this.retryOffered && isResultRetryKey(event)) {
      this.retry(event.timeStamp);
      return true;
    }
    if (event.key === 'Escape') {
      this.escape(event.timeStamp);
      return true;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      this.step(event.timeStamp);
      return true;
    }
    return false;
  }

  public dispatch(intent: ResultIntent): void {
    if (!this.entered) return;
    if (intent.type === 'retry') {
      if (this.retryOffered) this.retry(this.nowMs);
      return;
    }
    this.step(this.nowMs);
  }

  public frame(nowMs: number): ResultFrame {
    if (this.entered) {
      this.advanceTo(nowMs);
      this.completeLeaving(this.nowMs);
    }
    return {
      clock: { nowMs, enteredAtMs: this.enteredAtMs },
      result: this.options.result,
      ...(this.options.playChart !== undefined ? { playChart: this.options.playChart } : {}),
      presentation: this.presentation,
      inputOpenAtMs: this.inputOpenAtMs,
      ...(this.graphShownAtMs !== undefined ? { graphShownAtMs: this.graphShownAtMs } : {}),
      ...(this.updateShownAtMs !== undefined ? { updateShownAtMs: this.updateShownAtMs } : {}),
      ...(this.leaving !== undefined ? { leaving: this.leaving } : {}),
    };
  }

  /** Moves the clock on to `atMs`: the graphs finish drawing by themselves once their time is up. */
  private advanceTo(atMs: number): void {
    this.nowMs = Math.max(this.nowMs, atMs);
    const drawnAtMs = this.inputOpenAtMs + RESULT_GRAPH_DRAW_MS;
    if (this.graphShownAtMs === undefined && this.nowMs >= drawnAtMs) this.graphShownAtMs = drawnAtMs;
  }

  /**
   * One press on, at `atMs`: skip the graphs, then show the record update, then continue (at once without those steps).
   * Waits for input to open.
   */
  private step(atMs: number): void {
    if (this.leaving !== undefined) return;
    this.advanceTo(atMs);
    if (this.nowMs < this.inputOpenAtMs) return;
    if (this.options.timing.skipsResultSteps === true) {
      this.leave('continue', this.nowMs);
      return;
    }
    if (this.graphShownAtMs === undefined) {
      this.graphShownAtMs = this.nowMs;
      return;
    }
    if (this.updateShownAtMs === undefined) {
      this.updateShownAtMs = this.nowMs;
      return;
    }
    this.leave('continue', this.nowMs);
  }

  /** Continues on Escape, at once, or once input is open when the skin holds every key back until then. */
  private escape(atMs: number): void {
    if (this.leaving !== undefined) return;
    this.advanceTo(atMs);
    if (this.options.timing.escapeWaitsForInput === true && this.nowMs < this.inputOpenAtMs) return;
    this.leave('continue', this.nowMs);
  }

  /** Plays the chart again, once input is open. */
  private retry(atMs: number): void {
    if (this.leaving !== undefined) return;
    this.advanceTo(atMs);
    if (this.nowMs < this.inputOpenAtMs) return;
    this.leave('retry', this.nowMs);
  }

  private leave(to: ResultLeavingTo, atMs: number): void {
    this.advanceTo(atMs);
    this.leaving = { to, atMs: this.nowMs };
    this.completeLeaving(this.nowMs);
  }

  /** Tells the host where the screen goes once its fade-out has run. */
  private completeLeaving(nowMs: number): void {
    const leaving = this.leaving;
    if (leaving === undefined || this.completed) return;
    if (nowMs - leaving.atMs < Math.max(0, this.options.timing.fadeOutMs)) return;
    this.completed = true;
    if (leaving.to === 'retry') this.options.on.retry?.();
    else this.options.on.continue();
  }
}

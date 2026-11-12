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
 * - Keys 1-4 (and a beatoraja skin's replay buttons) save the play into replay slot 1-4 once input is open and until the
 *   screen starts to leave, as beatoraja's result does, when the host keeps replay slots (`on.saveReplay`).
 *
 * The jingle is the theme's clear, fail or generic result jingle (`resolveResultJingles`), the course ones for a course
 * run. It plays through the audio service as the screen enters and stops as it leaves the stage. When the theme has a
 * close sound (beatoraja's `resultclose`, or `course_close` for a course run), the screen stops the jingle and plays it
 * as its fade-out starts, as beatoraja's `MusicResult` / `CourseResult` do.
 */

import type { BeMusicJSON } from '@be-music/chart-source';
import {
  playResultRun,
  resolveResultJingle,
  resolveResultJingles,
  resolveResultPresentation,
  type GaugeHistorySample,
  type PlayResult,
  type PlayRunKind,
  type ReplaySlotState,
  type ResultPresentation,
  type SystemSound,
  type SystemSoundSet,
} from '@be-music/player-scene-model';
import type { AudioService } from '../../runtime/audio-service.ts';
import type { ResultFrame, ResultIntent, ResultViewTiming, SceneLeaving } from '../../view/types.ts';
import type { SceneSession, SessionKeyEvent } from '../session-scene.ts';
import { resolveResultKeyAction } from './result-keys.ts';
import { DEFAULT_CONTROL_ACTIONS, type ControlActionMap } from '../controls/control-actions.ts';
import { controlButtonsOfKey, DEFAULT_CONTROL_BUTTONS, type ControlButton } from '../controls/control-buttons.ts';
import { createControlButtonTracker } from '../controls/button-tracker.ts';

/** How long the result's graphs take to draw once input opens (LR2's default result skin draws for about 3 s). */
export const RESULT_GRAPH_DRAW_MS = 3000;

/** The part of the audio service the result screen uses. */
export type ResultAudio = Pick<AudioService, 'playJingle' | 'stopOwned'>;

/** Where the result screen leads. */
/** How long the leave key is held through the screen's leaving for a quick retry (That-Which-Must-Not-Be-Named PC's). */
export const QUICK_RETRY_HOLD_MS = 500;

export interface ResultSessionEvents {
  /** The player is done with the result. Fired once per entry. */
  continue(): void;
  /**
   * The player asked to play the chart again; without it the screen offers no quick retry. Fired once per entry.
   * `sameArrangement` asks for the note arrangement the play just had (beatoraja's REPLAY_SAME); the host falls back
   * to a new one where the same cannot be played again.
   */
  retry?(options?: { readonly sameArrangement?: boolean }): void;
  /**
   * The player asked to save the play into replay slot `slot` (0-3). The host decides whether the play can be saved and
   * shows the outcome through `replaySlots`. Without it the screen saves nothing.
   */
  saveReplay?(slot: number): void;
}

export interface ResultSessionOptions {
  readonly result: PlayResult;
  /** The chart as the play played it, for the skin's chart graphs; the frame carries it. */
  readonly playChart?: BeMusicJSON;
  /** Which play the result is of; the result's own `run` without one. Decides the jingles and the quick retry. */
  readonly run?: PlayRunKind;
  /** The theme's sounds: the result jingles are read from them. */
  readonly sounds: SystemSoundSet;
  readonly audio: ResultAudio;
  /** When the screen takes input and how it leaves, as the view's skin authors it. */
  readonly timing: ResultViewTiming;
  /** Each replay slot's state for the frame, read every frame (the host saves asynchronously). */
  readonly replaySlots?: () => readonly ReplaySlotState[];
  /** The player's keys for the screen's operations. Defaults to the default keys. */
  readonly actions?: ControlActionMap;
  /**
   * The gauge graphs the screen steps through (beatoraja's CHANGE_GRAPH): the play's gauge history under each gauge
   * of its ruleset, in the ruleset's order. Asked once, at the first step. Without it, or with none, the graph stays.
   */
  readonly gaugeGraphs?: () => readonly ResultGaugeGraph[];
  readonly on: ResultSessionEvents;
}

/** One gauge's graph of a play: the ruleset's gauge id and its history over the chart. */
export interface ResultGaugeGraph {
  readonly type: string;
  readonly history: readonly GaugeHistorySample[];
}

/**
 * The gauge graph after one step from the one shown: the next of `graphs`, wrapping, starting after the played gauge
 * (`playedType`) when the played graph is the one shown (`shownType` undefined). `undefined` when there is none to
 * step to. Stepping onto the played gauge shows the play's own graph again.
 */
export function stepResultGaugeGraph(
  graphs: readonly ResultGaugeGraph[],
  playedType: string | undefined,
  shownType: string | undefined,
): ResultGaugeGraph | undefined {
  if (graphs.length === 0) return undefined;
  const at = graphs.findIndex((graph) => graph.type === (shownType ?? playedType));
  return graphs[(at + 1) % graphs.length];
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
  /** The control buttons held, for a retry asked by keys held as the screen leaves. */
  private readonly buttons = createControlButtonTracker();
  /** When the leave key (Escape) went down, while it is down. */
  private leaveKeyDownAtMs: number | undefined;

  private get actions(): ControlActionMap {
    return this.options.actions ?? DEFAULT_CONTROL_ACTIONS.lr2;
  }
  private disposed = false;
  private enteredAtMs = 0;
  private nowMs = 0;
  private graphShownAtMs: number | undefined;
  private updateShownAtMs: number | undefined;
  private leaving: SceneLeaving<ResultLeavingTo> | undefined;
  /** The leaving screen told the host where it goes; nothing more happens until the next entry. */
  private completed = false;
  /** A retry asked for the same note arrangement (the retry-same key, or beatoraja's key 7 held). */
  private retrySame = false;
  /** The gauge graphs the host has for the play, once asked for. */
  private gaugeGraphs: readonly ResultGaugeGraph[] | undefined;
  /** The result as the frame shows it: the play's own, or with another gauge's graph in place of its own. */
  private shownResult: PlayResult;

  public constructor(options: ResultSessionOptions) {
    this.options = options;
    this.shownResult = options.result;
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

  /** The sound this result closes with, if the theme has one (`ResultJingles.close`). */
  public get closeSound(): SystemSound | undefined {
    return resolveResultJingles([this.options.sounds], this.presentation.courseJingles).close;
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
    this.buttons.reset();
    this.leaveKeyDownAtMs = undefined;
    this.options.audio.stopOwned(this);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.exit();
    this.disposed = true;
  }

  public handleKey(event: SessionKeyEvent): boolean {
    if (!this.entered) return false;
    const buttons = event.buttons ?? controlButtonsOfKey(event, DEFAULT_CONTROL_BUTTONS);
    this.buttons.handle({ ...event, buttons });
    if (this.actions.is('result.leave', event) && !event.repeat) {
      this.leaveKeyDownAtMs = event.type === 'down' ? event.timeStamp : undefined;
    }
    if (event.type !== 'down') return false;
    const action = resolveResultKeyAction({ ...event, buttons }, this.retryOffered, this.actions);
    switch (action?.type) {
      case 'retry':
        this.retry(event.timeStamp, action.sameArrangement === true);
        return true;
      case 'change-graph':
        return this.changeGaugeGraph();
      case 'leave':
        this.escape(event.timeStamp);
        return true;
      case 'continue':
        this.step(event.timeStamp);
        return true;
      case 'save-replay':
        if (this.options.on.saveReplay === undefined) return false;
        this.saveReplay(action.slot, event.timeStamp);
        return true;
      default:
        return false;
    }
  }

  public dispatch(intent: ResultIntent): void {
    if (!this.entered) return;
    if (intent.type === 'retry') {
      if (this.retryOffered) this.retry(this.nowMs);
      return;
    }
    if (intent.type === 'saveReplay') {
      this.saveReplay(intent.slot, this.nowMs);
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
      result: this.shownResult,
      ...(this.options.playChart !== undefined ? { playChart: this.options.playChart } : {}),
      presentation: this.presentation,
      inputOpenAtMs: this.inputOpenAtMs,
      ...(this.graphShownAtMs !== undefined ? { graphShownAtMs: this.graphShownAtMs } : {}),
      ...(this.updateShownAtMs !== undefined ? { updateShownAtMs: this.updateShownAtMs } : {}),
      ...(this.options.replaySlots !== undefined ? { replaySlots: this.options.replaySlots() } : {}),
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

  /** Plays the chart again, once input is open: on a new arrangement, or on the one the play just had. */
  private retry(atMs: number, sameArrangement = false): void {
    if (this.leaving !== undefined) return;
    this.advanceTo(atMs);
    if (this.nowMs < this.inputOpenAtMs) return;
    this.retrySame = sameArrangement;
    this.leave('retry', this.nowMs);
  }

  /**
   * Steps the gauge graph to the next gauge of the ruleset, as beatoraja's CHANGE_GRAPH does; the lamp, the gauge value
   * and every count stay the play's own. Whether there was a graph to step to.
   */
  private changeGaugeGraph(): boolean {
    this.gaugeGraphs ??= this.options.gaugeGraphs?.() ?? [];
    const played = this.options.result;
    const next = stepResultGaugeGraph(this.gaugeGraphs, played.gaugeType, this.shownResult.gaugeGraphType);
    if (next === undefined) return false;
    this.shownResult =
      next.type === played.gaugeType
        ? played
        : { ...played, gaugeHistory: [...next.history], gaugeGraphType: next.type };
    return true;
  }

  /** Saves the play into replay slot `slot`, once input is open and before the screen starts to leave. */
  private saveReplay(slot: number, atMs: number): void {
    if (this.leaving !== undefined || !Number.isInteger(slot) || slot < 0 || slot > 3) return;
    this.advanceTo(atMs);
    if (this.nowMs < this.inputOpenAtMs) return;
    this.options.on.saveReplay?.(slot);
  }

  private leave(to: ResultLeavingTo, atMs: number): void {
    this.advanceTo(atMs);
    this.leaving = { to, atMs: this.nowMs };
    const close = this.closeSound;
    if (close !== undefined) {
      // beatoraja stops the clear / fail jingle and plays the close sound as the fade-out starts; it stops with the screen.
      this.options.audio.stopOwned(this);
      void this.options.audio.playJingle(close, { owner: this });
    }
    this.completeLeaving(this.nowMs);
  }

  /** Tells the host where the screen goes once its fade-out has run. */
  private completeLeaving(nowMs: number): void {
    const leaving = this.leaving;
    if (leaving === undefined || this.completed) return;
    if (nowMs - leaving.atMs < Math.max(0, this.options.timing.fadeOutMs)) return;
    this.completed = true;
    if (leaving.to === 'retry') {
      this.options.on.retry?.(this.retrySame ? { sameArrangement: true } : undefined);
      return;
    }
    const held = this.retryOffered ? this.retryHeld(nowMs) : undefined;
    if (held === undefined) this.options.on.continue();
    else this.options.on.retry?.(held === 'same' ? { sameArrangement: true } : undefined);
  }

  /**
   * The retry the keys still held as the screen finishes leaving ask for, if any: LR2's white and black key held
   * together, beatoraja's key 5 (a new arrangement, REPLAY_DIFFERENT) or key 7 (the same one, REPLAY_SAME; key 5 wins
   * when both are held, as beatoraja reads them in key order), or That-Which-Must-Not-Be-Named PC's leave key (Escape)
   * held through.
   */
  private retryHeld(nowMs: number): 'new' | 'same' | undefined {
    const leaveKey = this.leaveKeyDownAtMs;
    if (leaveKey !== undefined && nowMs - leaveKey > QUICK_RETRY_HOLD_MS) return 'new';
    const down = (keys: readonly number[]) => keys.some((key) => this.buttons.isDown(`1P-key${key}` as ControlButton));
    if (this.actions.scheme === 'beatoraja') return down([5]) ? 'new' : down([7]) ? 'same' : undefined;
    return down([1, 3, 5, 7]) && down([2, 4, 6]) ? 'new' : undefined;
  }
}

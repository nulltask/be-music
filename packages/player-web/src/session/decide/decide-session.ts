/**
 * The decide screen's behaviour, whatever family draws it: the short screen between picking a chart and its play. The
 * session times the screen from its view's skin timing (`DecideView.timing`): input opens after the input delay, the
 * screen moves on to the play by itself after the auto advance, and a leaving screen fades out before the host hears
 * where it goes. Enter, Space or a click continue to the play once input is open; Escape backs out to select at any
 * time. The decide jingle plays through the audio service and stops when the screen leaves the stage.
 *
 * The session draws the chart's `#RANDOM` / `#SWITCH` branches once, when it is made ({@link DecideSession.resolved}):
 * the screen's graphs show those branches, and the host hands the same chart and draws to the play, so the play plays
 * what the screen showed.
 */

import { resolvePlayChart, type ResolvedPlayChart } from '@be-music/player/core/engine';
import {
  DEFAULT_PLAY_OPTIONS,
  type CourseView,
  type LibraryChart,
  type PlayOptions,
  type SystemSoundSet,
} from '@be-music/scene-model';
import type { AudioService } from '../../runtime/audio-service.ts';
import type { DecideFrame, DecideIntent, SceneLeaving, SceneViewTiming } from '../../view/types.ts';
import type { SceneSession, SessionKeyEvent } from '../session-scene.ts';

/** What a key press does on the decide screen. */
export type DecideKeyAction = 'continue' | 'cancel';

/**
 * Maps a key press to its decide-screen action: Enter / Space continue to the play, Escape goes back to select.
 * Auto-repeats are ignored, so the Enter still held from picking the chart doesn't skip the screen.
 */
export function resolveDecideKeyAction(event: { key: string; repeat: boolean }): DecideKeyAction | undefined {
  if (event.repeat) return undefined;
  if (event.key === 'Escape') return 'cancel';
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') return 'continue';
  return undefined;
}

/** The part of the audio service the decide screen uses. */
export type DecideAudio = Pick<AudioService, 'playJingle' | 'stopOwned'>;

/** Where the decide screen leads. */
export interface DecideSessionEvents {
  /** The screen is done (its time is up, or the player went on): start the play. Fired once per entry. */
  continue(): void;
  /** The player backed out: go back to select. Fired once per entry. */
  cancel(): void;
}

export interface DecideSessionOptions {
  /** The chart about to be played. */
  readonly chart: LibraryChart;
  /** The course and the stage about to be played, for a course stage. */
  readonly course?: CourseView;
  /** The options the play will run with. Defaults to `DEFAULT_PLAY_OPTIONS`. */
  readonly playOptions?: PlayOptions;
  /** The theme's sounds: the decide jingle is `decideBgm`, none without it. */
  readonly sounds: SystemSoundSet;
  readonly audio: DecideAudio;
  /** When the screen takes input and how it leaves, as the view's skin authors it. */
  readonly timing: SceneViewTiming;
  /** How far the play behind the screen has loaded, 0..1, read every frame; `undefined` while nothing loads. */
  readonly progress?: () => number | undefined;
  /** The random source the chart's `#RANDOM` / `#SWITCH` branches are drawn with, in `[0, 1)`. Defaults to `Math.random`. */
  readonly random?: () => number;
  readonly on: DecideSessionEvents;
}

/** Where a leaving decide screen goes. */
type DecideLeavingTo = 'play' | 'select';

function clampProgress(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

/** The decide screen's session. See the module comment. */
export class DecideSession implements SceneSession<DecideFrame, DecideIntent> {
  public readonly kind = 'decide' as const;
  /**
   * The chart as the play will play it: its `#RANDOM` / `#SWITCH` branches drawn once, when the session was made, with
   * the draws (`resolvePlayChart`). The host hands it to the play (`preResolved`).
   */
  public readonly resolved: ResolvedPlayChart;
  private readonly options: DecideSessionOptions;
  private readonly playOptions: PlayOptions;
  private entered = false;
  private disposed = false;
  private enteredAtMs = 0;
  private nowMs = 0;
  private leaving: SceneLeaving<DecideLeavingTo> | undefined;
  /** The leaving screen told the host where it goes; nothing more happens until the next entry. */
  private completed = false;

  public constructor(options: DecideSessionOptions) {
    this.options = options;
    this.playOptions = options.playOptions ?? DEFAULT_PLAY_OPTIONS;
    this.resolved = resolvePlayChart(
      options.chart.chart,
      options.random !== undefined ? { random: options.random } : {},
    );
  }

  /** On the clock, when input opens. */
  private get inputOpenAtMs(): number {
    return this.enteredAtMs + Math.max(0, this.options.timing.inputDelayMs);
  }

  /** Starts the screen's time from `nowMs` and plays the decide jingle. */
  public enter(nowMs: number): void {
    if (this.disposed) return;
    this.entered = true;
    this.enteredAtMs = nowMs;
    this.nowMs = nowMs;
    this.leaving = undefined;
    this.completed = false;
    const jingle = this.options.sounds.decideBgm;
    if (jingle !== undefined) void this.options.audio.playJingle(jingle, { owner: this });
  }

  /** Stops the screen's time and the jingle. */
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
    const action = resolveDecideKeyAction(event);
    if (action === undefined) return false;
    this.request(action, event.timeStamp);
    return true;
  }

  public dispatch(intent: DecideIntent): void {
    if (!this.entered) return;
    this.request(intent.type, this.nowMs);
  }

  public frame(nowMs: number): DecideFrame {
    if (this.entered) {
      this.nowMs = Math.max(this.nowMs, nowMs);
      const autoAdvanceMs = this.options.timing.autoAdvanceMs;
      if (this.leaving === undefined && autoAdvanceMs !== undefined && nowMs - this.enteredAtMs >= autoAdvanceMs) {
        this.leave('play', nowMs);
      }
      this.completeLeaving(nowMs);
    }
    const progress = clampProgress(this.options.progress?.());
    return {
      clock: { nowMs, enteredAtMs: this.enteredAtMs },
      chart: this.options.chart,
      playChart: this.resolved.chart,
      ...(this.options.course !== undefined ? { course: this.options.course } : {}),
      playOptions: this.playOptions,
      ...(progress !== undefined ? { progress } : {}),
      inputOpenAtMs: this.inputOpenAtMs,
      ...(this.leaving !== undefined ? { leaving: this.leaving } : {}),
    };
  }

  /**
   * The player asked to continue or back out at `atMs`: continuing waits for input to open, backing out does not (LR2
   * lets Escape leave its decide screen before `#STARTINPUT`).
   */
  private request(action: DecideKeyAction, atMs: number): void {
    if (action === 'continue') {
      if (Math.max(atMs, this.nowMs) < this.inputOpenAtMs) return;
      this.leave('play', atMs);
    } else {
      this.leave('select', atMs);
    }
    this.completeLeaving(Math.max(atMs, this.nowMs));
  }

  /** Starts leaving for `to`, unless the screen is already on its way out. */
  private leave(to: DecideLeavingTo, atMs: number): void {
    if (this.leaving !== undefined) return;
    this.leaving = { to, atMs };
  }

  /** Tells the host where the screen goes once its fade-out has run. */
  private completeLeaving(nowMs: number): void {
    const leaving = this.leaving;
    if (leaving === undefined || this.completed) return;
    if (nowMs - leaving.atMs < Math.max(0, this.options.timing.fadeOutMs)) return;
    this.completed = true;
    if (leaving.to === 'play') this.options.on.continue();
    else this.options.on.cancel();
  }
}

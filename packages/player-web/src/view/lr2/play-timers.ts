/**
 * The LR2 timers of the play screen, as the LR2 play view keeps them: each timer an LR2 skin's `#DST_*` and `#SRC_*`
 * entries count from, with when it started on the play clock (`PlayfieldRuntime.playClock`). The view starts and stops
 * them from the play's moments (`PlayFrame.events`, through `resolveLR2PlayTimers`), and retires the one-shot ones once
 * their skin animation has played out. The key-on bank (100-119) is the play's own key beams: the session keeps them
 * by channel (`PlayfieldRuntime.keyBeamStartedAt`), and the timers map each lit channel onto its key-on timer
 * (`resolveLR2LaneTimer('key-on', …)`).
 *
 * The LR2 timer ids and the lane index stay here and in the LR2 view: the session and the shared playfield go by
 * channel.
 */

import type { LR2Skin } from '@be-music/lr2-skin';
import { LR2_LANE_TIMER_BANK_SIZE, LR2_TIMER } from '@be-music/lr2-skin/ids';
import {
  resolveLR2LaneTimer,
  resolveLR2PlayTimers,
  type LR2Lane,
  type LR2LaneTimerBank,
  type LR2TimerUpdate,
} from '@be-music/lr2-skin/state';
import { resolveSideRelativeLaneIndex } from '@be-music/player/lanes';
import type { ChartPlayVariant } from '@be-music/chart';
import { KEY_ON_FADE_OUT_MS } from '../../stage/design.ts';
import type { PlayViewEvent } from '../types.ts';
import {
  computeBombDurationsMs,
  computeFullComboDurationMs,
  computeGaugeTimerDurationsMs,
  computeKeyOnFadeDurationsMs,
  computeLNHoldDurationsMs,
} from './play-hud.ts';

/**
 * How long a bomb (timers 50-69) lasts on a lane the skin draws no bomb animation for: the 150 ms of the LR2 default
 * 7-keys skin's bomb cycle. A skin's own span is the longest keyframe time of its elements on that timer.
 */
export const LR2_BOMB_FALLBACK_MS = 150;

/** How long the gauge-rise flash (timer 42) lasts when the skin draws nothing on it: a comfortable sparkle window. */
export const LR2_GAUGE_RISE_FALLBACK_MS = 300;

/** How long the full-combo animation (timers 48 / 49) lasts when the skin draws nothing on it. */
const FULL_COMBO_FALLBACK_MS = 3000;

/** What the timers read of the running play (`PlayfieldRuntime`'s members of these names). */
export interface LR2PlayTimerSource {
  readonly song: unknown;
  readonly chartPlayVariant: ChartPlayVariant;
  readonly disposed: boolean;
  /**
   * The key beams the session keeps by channel, and the fades it started: the key-on bank (100-119) read through each
   * channel's key-on timer. The timers retire them as they draw.
   */
  readonly keyBeamStartedAt: Map<string, number>;
  readonly keyBeamFadeStartedAt: Map<string, number>;
  readonly pressedChannels: ReadonlySet<string>;
  playClock(): number;
  isIntroPlaying(): boolean;
  currentSeconds(): number;
  currentBeat(seconds: number): number;
}

type TimerHandle = ReturnType<typeof setTimeout>;

/** The LR2 play screen's timers. See the module comment. */
export class LR2PlayTimers {
  private readonly play: LR2PlayTimerSource;
  /** The timers the view started, by id, with their start on the play clock. */
  private readonly started = new Map<number, number>();
  /** When the scene started (timer 0), on the play clock; the judge timers count from it before the first judgment. */
  private sceneStartAt = 0;
  /** The skin's spans per timer: the longest keyframe time of its elements on that timer. */
  private readonly keyOnFadeSpans = new Map<number, number>();
  private readonly bombSpans = new Map<number, number>();
  private readonly lnHoldSpans = new Map<number, number>();
  private readonly gaugeSpans = new Map<number, number>();
  private fullComboSpan = FULL_COMBO_FALLBACK_MS;
  /** When each long-note hold timer (70-89) began fading after its release, on the play clock. */
  private readonly lnHoldFadeOutStart = new Map<number, number>();
  private gaugeRiseTimeout: TimerHandle | undefined;
  private startInputTimeout: TimerHandle | undefined;
  private readonly lnHoldTimeouts = new Set<TimerHandle>();
  private disposed = false;

  public constructor(play: LR2PlayTimerSource) {
    this.play = play;
  }

  /** Takes the skin's timer spans: the key-beam, bomb, long-note hold, gauge and full-combo animation lengths. */
  public setSpans(skin: LR2Skin): void {
    this.fullComboSpan = computeFullComboDurationMs(skin);
    replace(this.keyOnFadeSpans, computeKeyOnFadeDurationsMs(skin));
    replace(this.bombSpans, computeBombDurationsMs(skin));
    replace(this.lnHoldSpans, computeLNHoldDurationsMs(skin));
    replace(this.gaugeSpans, computeGaugeTimerDurationsMs(skin));
  }

  /** `channel`'s lane as LR2's lane timer banks address it: its index on its side and the play variant. */
  public lane(channel: string): LR2Lane {
    const playVariant = this.play.chartPlayVariant;
    return { channel, laneIndex: resolveSideRelativeLaneIndex(channel, playVariant), playVariant };
  }

  /** The LR2 timer of `channel`'s lane in a timer bank (`resolveLR2LaneTimer`). */
  public laneTimer(bank: LR2LaneTimerBank, channel: string): number | undefined {
    return resolveLR2LaneTimer(bank, this.lane(channel));
  }

  /** Starts and stops the timers a moment of the play changes. */
  public apply(update: LR2TimerUpdate): void {
    for (const timer of update.stop) this.started.delete(timer);
    for (const [timer, at] of update.start) this.started.set(timer, at);
  }

  /**
   * Starts and stops the timers `event` changes. `startInputMs` is the skin's `#STARTINPUT`: timer 1 starts that long
   * after the scene does (at once without one).
   */
  public handle(event: PlayViewEvent, startInputMs: number | undefined): void {
    switch (event.kind) {
      case 'scene-start':
        // Timer 0 at once and timer 1 after `#STARTINPUT`; timers 40 (READY) and 41 (play start) follow with their own
        // moments. Timer 2 (FADEOUT) starts only as the play ends normally, and timer 3 (FAILED) only as it fails, so the
        // LR2 default 7-keys shutters and FAILED plate (timer 3) paint on a failure alone.
        this.sceneStartAt = event.atMs;
        this.apply(resolveLR2PlayTimers({ kind: 'scene-start', at: event.atMs }));
        this.seedStartInput(event.atMs, startInputMs);
        return;
      case 'load-end':
      case 'play-start':
      case 'exit-fade-out':
      case 'exit-close':
      case 'full-combo':
        this.apply(resolveLR2PlayTimers({ kind: event.kind, at: event.atMs }));
        return;
      case 'judge':
        // Timer 46 (1P) / 47 (2P) restarts on every judgement on its side, so the `#DST_NOWJUDGE` / `#DST_NOWCOMBO`
        // chains animate from time 0 per hit.
        this.apply(resolveLR2PlayTimers({ kind: 'judge', side: event.side, at: event.atMs }));
        return;
      case 'gauge':
        this.gaugeMoved(event.previous, event.next, event.atMs);
        return;
      case 'bomb':
        this.apply(
          resolveLR2PlayTimers({ kind: 'lane', bank: 'bomb', lane: this.lane(event.channel), at: event.atMs }),
        );
        return;
      case 'lane':
        if (event.action === 'release') this.releaseLNHold(event.channel);
        return;
      case 'lane-hold':
        this.startLNHold(event.channel);
        return;
      default:
        return;
    }
  }

  /** `channel`'s bomb went out: its bomb timer stops with it. */
  public bombRetired(channel: string): void {
    const timer = this.laneTimer('bomb', channel);
    if (timer !== undefined) this.started.delete(timer);
  }

  /** How long `channel`'s bomb lasts: the skin's span on its bomb timer, else LR2's default. */
  public bombDurationMs(channel: string): number {
    const timer = this.laneTimer('bomb', channel);
    return (timer === undefined ? undefined : this.bombSpans.get(timer)) ?? LR2_BOMB_FALLBACK_MS;
  }

  /** How long the key beam of key-on timer `timer` fades: the skin's span on it, else the default fade. */
  public keyOnFadeMsOfTimer(timer: number): number {
    return this.keyOnFadeSpans.get(timer) ?? KEY_ON_FADE_OUT_MS;
  }

  /** How long `channel`'s key beam fades once its key is up: its key-on timer's span. */
  public keyOnFadeMs(channel: string): number {
    const timer = this.laneTimer('key-on', channel);
    return timer === undefined ? KEY_ON_FADE_OUT_MS : this.keyOnFadeMsOfTimer(timer);
  }

  /** When `timer` started, on the play clock: one the view started, else the key beam on its key-on timer. */
  public startedAt(timer: number): number | undefined {
    return this.started.get(timer) ?? this.keyBeamOn(this.play.keyBeamStartedAt, timer)?.[1];
  }

  /**
   * Whether `timer` runs now. A `#DST_*` shows only while its timer counts: a started timer, the judge timers 46 / 47
   * (whose drawing the judge's own window gates), and the rhythm timer 140 once the chart plays (not through the
   * LOADING intro, so the lane-bottom aura does not pulse over the empty playfield).
   */
  public isActive(timer: number): boolean {
    if (this.startedAt(timer) !== undefined) return true;
    if (timer === LR2_TIMER.JUDGE_1P || timer === LR2_TIMER.JUDGE_2P) return true;
    if (timer === LR2_TIMER.RHYTHM) return this.play.song !== undefined && !this.play.isIntroPlaying();
    return false;
  }

  /**
   * Milliseconds since `timer` started, for the `cycle` of a `#SRC_*` and the keyframes of a `#DST_*`; 0 for one not
   * started. The judge timers count from the scene start until the first judgment on their side; the rhythm timer 140
   * treats one beat as 1000 ms ("this timer treats one beat as 1000"), so the stock skin's lane-bottom aura stays
   * beat-locked under BPM changes, STOPs and hi-speed changes.
   */
  public elapsed(timer: number): number {
    if (timer === LR2_TIMER.JUDGE_1P || timer === LR2_TIMER.JUDGE_2P) {
      const judgedAt = this.startedAt(timer);
      const now = this.play.playClock();
      return Math.max(0, now - (judgedAt ?? this.sceneStartAt));
    }
    if (timer === LR2_TIMER.RHYTHM) {
      if (this.play.song === undefined) return 0;
      const beat = this.play.currentBeat(this.play.currentSeconds());
      if (!Number.isFinite(beat) || beat < 0) return 0;
      return (beat - Math.floor(beat)) * 1000;
    }
    // No fallback for timers 40 / 41 before they start: the title plate and loading ring on timer 40 would otherwise
    // tick from the scene start and jump back once READY fires.
    const started = this.startedAt(timer);
    return started === undefined ? 0 : Math.max(0, this.play.playClock() - started);
  }

  /**
   * The alpha a sprite on `timer` fades to while its key beam (key-on timers 100-119) or long-note hold (70-89) fades
   * out after release, or `undefined` while it does not fade. Past the fade it retires the timer here, rather than
   * waiting for the deferred cleanup a throttled `setTimeout` may never run, so the beam is gone once its fade has
   * elapsed; a key still held keeps its key-on timer.
   */
  public releaseFadeAlpha(timer: number): number | undefined {
    let alpha: number | undefined;
    const keyOnFade = this.keyBeamOn(this.play.keyBeamFadeStartedAt, timer);
    if (keyOnFade !== undefined) {
      // Overrides the keyframe's alpha: the LR2 default skin's key-on keyframe 0 is the fade-in origin (alpha 0).
      const [channel, keyOnFadeStart] = keyOnFade;
      const elapsed = this.play.playClock() - keyOnFadeStart;
      const fadeMs = this.keyOnFadeMsOfTimer(timer);
      if (elapsed >= fadeMs) {
        alpha = 0;
        this.play.keyBeamFadeStartedAt.delete(channel);
        if (!this.play.pressedChannels.has(channel)) this.play.keyBeamStartedAt.delete(channel);
      } else {
        alpha = Math.max(0, 1 - elapsed / fadeMs);
      }
    }
    const lnHoldFadeStart = this.lnHoldFadeOutStart.get(timer);
    if (lnHoldFadeStart !== undefined) {
      const elapsed = this.play.playClock() - lnHoldFadeStart;
      const fadeMs = this.lnHoldSpans.get(timer) ?? KEY_ON_FADE_OUT_MS;
      if (elapsed >= fadeMs) {
        alpha = 0;
        this.lnHoldFadeOutStart.delete(timer);
      } else {
        alpha = Math.max(0, 1 - elapsed / fadeMs);
      }
    }
    return alpha;
  }

  /**
   * Retires timers 48 / 49 once the full-combo animation has played out, so the skin's "play once and clamp" FC
   * graphic does not stay on its last frame for the rest of the play.
   */
  public retireFullCombo(): void {
    const startedAt = this.started.get(LR2_TIMER.FULL_COMBO_1P);
    if (startedAt === undefined) return;
    if (this.play.playClock() - startedAt < this.fullComboSpan) return;
    this.started.delete(LR2_TIMER.FULL_COMBO_1P);
    this.started.delete(LR2_TIMER.FULL_COMBO_2P);
  }

  /** Cancels the timers' deferred work; the play is gone. */
  public dispose(): void {
    this.disposed = true;
    if (this.gaugeRiseTimeout !== undefined) clearTimeout(this.gaugeRiseTimeout);
    this.gaugeRiseTimeout = undefined;
    if (this.startInputTimeout !== undefined) clearTimeout(this.startInputTimeout);
    this.startInputTimeout = undefined;
    for (const timeout of this.lnHoldTimeouts) clearTimeout(timeout);
    this.lnHoldTimeouts.clear();
    this.started.clear();
    this.lnHoldFadeOutStart.clear();
  }

  /**
   * Timer 1 (`#STARTINPUT`) `startInputMs` after the scene start at `at`: at once without a delay, else once it has
   * passed (stamped then, on the play clock).
   */
  private seedStartInput(at: number, startInputMs: number | undefined): void {
    const offset = startInputMs === undefined ? 0 : Math.max(0, startInputMs);
    if (offset <= 0) {
      this.started.set(LR2_TIMER.START_INPUT, at);
      return;
    }
    if (this.startInputTimeout !== undefined) clearTimeout(this.startInputTimeout);
    this.startInputTimeout = this.after(offset - (this.play.playClock() - at), () => {
      this.startInputTimeout = undefined;
      this.started.set(LR2_TIMER.START_INPUT, this.play.playClock());
    });
  }

  /**
   * The gauge moved from `previous` to `next` at `at`: timer 42 starts on a rise and stops once the skin's rise flash
   * has played out; timer 44 runs from reaching 100 % until the gauge drops below it.
   */
  private gaugeMoved(previous: number, next: number, at: number): void {
    this.apply(resolveLR2PlayTimers({ kind: 'gauge', previous, next, at }));
    if (next <= previous) return;
    if (this.gaugeRiseTimeout !== undefined) clearTimeout(this.gaugeRiseTimeout);
    const fadeMs = this.gaugeSpans.get(LR2_TIMER.GAUGE_UP_1P) ?? LR2_GAUGE_RISE_FALLBACK_MS;
    this.gaugeRiseTimeout = this.after(fadeMs - (this.play.playClock() - at), () => {
      this.gaugeRiseTimeout = undefined;
      this.started.delete(LR2_TIMER.GAUGE_UP_1P);
    });
  }

  /** A long note's hold began on `channel`: its hold timer (70-89) starts, fully on. */
  private startLNHold(channel: string): void {
    const timer = this.laneTimer('ln-hold', channel);
    if (timer === undefined) return;
    this.started.set(timer, this.play.playClock());
    this.lnHoldFadeOutStart.delete(timer);
  }

  /**
   * `channel` was released: its hold timer fades out over the skin's span (`releaseFadeAlpha`), then stops. The fade
   * starts even when the timer has already gone, so a sprite still showing tapers to nothing.
   */
  private releaseLNHold(channel: string): void {
    const timer = this.laneTimer('ln-hold', channel);
    if (timer === undefined) return;
    this.lnHoldFadeOutStart.set(timer, this.play.playClock());
    if (!this.started.has(timer)) return;
    const fadeMs = this.lnHoldSpans.get(timer) ?? KEY_ON_FADE_OUT_MS;
    const timeout = this.after(fadeMs, () => {
      this.lnHoldTimeouts.delete(timeout);
      this.started.delete(timer);
      this.lnHoldFadeOutStart.delete(timer);
    });
    this.lnHoldTimeouts.add(timeout);
  }

  /**
   * The channel and time of the key beam in `beams` (the session's, by channel) that key-on timer `timer` (100-119)
   * shows, or `undefined` for another timer or with no such beam. Few beams are lit at once, so it looks them over.
   */
  private keyBeamOn(beams: ReadonlyMap<string, number>, timer: number): [channel: string, atMs: number] | undefined {
    if (beams.size === 0 || timer < LR2_TIMER.KEY_ON_1P || timer >= LR2_TIMER.KEY_ON_2P + LR2_LANE_TIMER_BANK_SIZE) {
      return undefined;
    }
    for (const [channel, atMs] of beams) {
      if (this.laneTimer('key-on', channel) === timer) return [channel, atMs];
    }
    return undefined;
  }

  /** Runs `callback` after `delayMs` (at least 0) unless the timers or the play are gone by then. */
  private after(delayMs: number, callback: () => void): TimerHandle {
    return setTimeout(
      () => {
        if (this.disposed || this.play.disposed) return;
        callback();
      },
      Math.max(0, delayMs),
    );
  }
}

function replace(target: Map<number, number>, source: ReadonlyMap<number, number>): void {
  target.clear();
  for (const [timer, span] of source) target.set(timer, span);
}

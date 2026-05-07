// Translates engine-side UI signals into a `BeatorajaRenderContext` for `BeatorajaPlaySkinView.update()`.
//
// The adapter keeps three pieces of state:
//
//   - `activeOps: Set<number>` — option ops (from `skin_config`) merged with runtime ops the engine has
//     toggled this frame. Skin elements gated on `if[]` / `op[]` consult this set.
//   - `timerStartedAt: Map<number, number>` — `(timerId → scene-relative ms)`. The skin's keyframe sampler
//     reads this to advance per-element animations relative to when the matching event fired.
//   - `frame: PlayerUiFramePayload | null` — latched current chart frame; used by `resolveTextContent` /
//     `resolveRefValue` to surface combo / score / judge counts as text and image-ref state.
//
// The lifecycle is owned by `PixiBeatorajaGameplayView`:
//
//     1. `new BeatorajaRuntimeAdapter({ baseOps, getNowMs, chart })`
//     2. `adapter.markStartInput()` once the engine input runtime is wired
//     3. `adapter.markPlay()` once the engine begins audible playback
//     4. Per-frame:
//        - `adapter.applyFrame(uiSignals.getFrame())`
//        - drain commands → `adapter.applyCommand(cmd)`
//        - drain judge-combo states → `adapter.applyJudgeCombo(state)`
//        - `view.update(adapter.getRenderContext())`

import type { BeMusicJson } from '@be-music/json';
import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { resolveSideKeySlot } from '@be-music/player/core/lane-layout';
import type { PlayerJudgeComboSignalState } from '@be-music/player/state-signals';
import type { PlayerUiCommand, PlayerUiFramePayload } from '@be-music/player/core/ui-signal-bus';
import type { BeatorajaRenderContext } from './beatoraja-render.ts';
import {
  BEATORAJA_OP,
  BEATORAJA_TEXT,
  bombTimerId,
  judgeOpForKind,
  judgeTimerId,
  keyOffTimerId,
  keyOnTimerId,
  lnHoldTimerId,
  TIMER_FADEOUT,
  TIMER_PLAY,
  TIMER_READY,
  TIMER_SCENE_START,
  TIMER_STARTINPUT,
  type BeatorajaSide,
} from '@be-music/beatoraja-skin';

export interface BeatorajaRuntimeAdapterOptions {
  /** Chart variant (matches `ChartPlayVariant` from `@be-music/player`). Used to resolve channel → lane index. */
  chartPlayVariant: ChartPlayVariant;
  /** Static ops from the user's confirmed skin-config picks. Merged into `activeOps` and never removed. */
  baseOps: ReadonlySet<number>;
  /**
   * Returns the scene-relative milliseconds clock the skin view samples against. The adapter doesn't keep
   * its own clock — the host (`PixiBeatorajaGameplayView`) owns the rAF / Pixi-ticker that drives this.
   */
  getNowMs: () => number;
  /** `true` when the engine was started in autoplay mode. Surfaces the `AUTOPLAY_ON` op. */
  autoPlay?: boolean;
  /**
   * Optional parsed chart — surfaces title / artist / genre via the `text[].ref` resolver. Without it the
   * text-resolver leaves chart-info nodes empty (matches the preview path).
   */
  chart?: BeMusicJson;
}

interface SideJudgeState {
  lastJudgeOp: number | undefined;
  lastFastSlowOp: number | undefined;
}

export class BeatorajaRuntimeAdapter {
  /**
   * Live op set — option ops (from `baseOps`) plus runtime ops the engine has toggled. Exposed via
   * {@link getRenderContext} so the skin view can gate visibility per frame. The same `Set` instance is
   * reused every frame to avoid allocations on the hot path.
   */
  private readonly activeOps: Set<number>;
  private readonly baseOps: ReadonlySet<number>;
  private readonly timerStartedAt = new Map<number, number>();
  private readonly chartPlayVariant: ChartPlayVariant;
  private readonly getNowMs: () => number;
  private readonly chart: BeMusicJson | undefined;
  private frame: PlayerUiFramePayload | null = null;
  private readonly judgeState: Record<BeatorajaSide, SideJudgeState> = {
    1: { lastJudgeOp: undefined, lastFastSlowOp: undefined },
    2: { lastJudgeOp: undefined, lastFastSlowOp: undefined },
  };
  private poorBgaActive = false;

  constructor(options: BeatorajaRuntimeAdapterOptions) {
    this.chartPlayVariant = options.chartPlayVariant;
    this.baseOps = options.baseOps;
    this.activeOps = new Set(options.baseOps);
    this.getNowMs = options.getNowMs;
    this.chart = options.chart;
    // Autoplay flag — prop.lua `autoplayon = 33` / `autoplayoff = 32`. We surface BOTH so a skin gated on
    // either side picks up the correct state. (Some skins author the panel as `if[33]`, others as
    // `if[-32]`; both are valid in beatoraja's spec.)
    if (options.autoPlay) {
      this.activeOps.add(BEATORAJA_OP.AUTOPLAY_ON);
    } else {
      this.activeOps.add(BEATORAJA_OP.AUTOPLAY_OFF);
    }
    // Until the engine signals 'loaded', the loading op is active. We don't actually have a separate
    // 'loaded' transition wire from the engine yet — `markPlay` flips this when audible playback starts,
    // so by the time the user sees notes the loaded gate is open.
    this.activeOps.add(BEATORAJA_OP.NOW_LOADING);
    // Scene-start timer is always running — many skin elements default `timer = 0` and read it as the
    // global clock. Other built-in timers fire later via `markTimer`.
    this.timerStartedAt.set(TIMER_SCENE_START, 0);
  }

  /** Stamp a built-in / per-event timer at the current `getNowMs()`. Idempotent — re-marks override. */
  markTimer(timerId: number): void {
    this.timerStartedAt.set(timerId, this.getNowMs());
  }

  /** Stamp the `startinput` timer (prop.lua `startinput = 1`). Fires when the engine input bus is ready. */
  markStartInput(): void {
    this.markTimer(TIMER_STARTINPUT);
  }

  /** Stamp the `ready` timer (prop.lua `ready = 40`). Fires shortly before audible playback. */
  markReady(): void {
    this.markTimer(TIMER_READY);
  }

  /**
   * Stamp the `play` timer (prop.lua `play = 41`) and flip the loading gates so chrome gated on
   * `loaded` (op 81) becomes visible. Called when the engine emits `onStart`.
   */
  markPlay(): void {
    this.markTimer(TIMER_PLAY);
    this.activeOps.delete(BEATORAJA_OP.NOW_LOADING);
    this.activeOps.add(BEATORAJA_OP.LOADED);
  }

  /** Stamp the `fadeout` timer (prop.lua `fadeout = 2`). Fires at chart end / interrupt. */
  markFadeout(): void {
    this.markTimer(TIMER_FADEOUT);
  }

  /** Latch the current engine frame snapshot — drives text / ref content resolution. */
  applyFrame(frame: PlayerUiFramePayload): void {
    this.frame = frame;
  }

  /**
   * Fold a single engine UI command into the timer / op state. The command set is documented on
   * {@link PlayerUiCommand}. Unknown command kinds (forward-compat) are ignored.
   */
  applyCommand(command: PlayerUiCommand): void {
    switch (command.kind) {
      case 'press-lane':
        this.startLaneKeyOnTimer(command.channel);
        break;
      case 'release-lane':
        this.startLaneKeyOffTimer(command.channel);
        break;
      case 'flash-lane':
        // `flash-lane` fires when a note resolves with a non-MISS verdict. The skin's bomb sprite is
        // gated on the lane's bomb timer.
        this.startLaneBombTimer(command.channel);
        break;
      case 'hold-lane-until-beat':
        this.startLaneLnHoldTimer(command.channel);
        break;
      case 'trigger-poor-bga':
        this.poorBgaActive = true;
        break;
      case 'clear-poor-bga':
        this.poorBgaActive = false;
        break;
    }
  }

  /**
   * Fold one engine judge-combo publish into the side-relative judge timer + last-judge op gate.
   * Per-side: only one of `_*p_perfect` / `_*p_great` / etc. is active at a time, so a new judge clears
   * the previous one. FAST / SLOW are surfaced separately via the `_*p_early` / `_*p_late` ops.
   */
  applyJudgeCombo(state: PlayerJudgeComboSignalState): void {
    const side: BeatorajaSide = state.channel?.startsWith('2') ? 2 : 1;
    const op = judgeOpForKind(side, state.judge);
    const sideState = this.judgeState[side];
    if (sideState.lastJudgeOp !== undefined && sideState.lastJudgeOp !== op) {
      this.activeOps.delete(sideState.lastJudgeOp);
    }
    if (op !== undefined) {
      this.activeOps.add(op);
      sideState.lastJudgeOp = op;
    }
    this.markTimer(judgeTimerId(side));
  }

  /** Read-only handle the skin view consumes per frame. The same object identity persists across calls. */
  getRenderContext(): BeatorajaRenderContext {
    return {
      activeOps: this.activeOps,
      getTimerStart: (id) => this.timerStartedAt.get(id),
      nowMs: this.getNowMs(),
    };
  }

  /**
   * Resolve a `text[].ref` op-code into the string the skin should render. Maps prop.lua's `text` block
   * onto the parsed chart (when supplied) — title / artist / genre / subtitle / fulltitle / etc. Codes
   * the adapter doesn't surface return `undefined` and the corresponding text node renders empty.
   */
  resolveTextContent(refOp: number): string | undefined {
    const chart = this.chart;
    if (chart === undefined) return undefined;
    const meta = chart.metadata;
    // bmson sub-artist list is an array of `"role:name"` strings — for the dynamic readout we just join
    // them with `" "` so the skin sees something readable. Hosts that need structured access can
    // post-process via `parseBmsonSubartist`.
    const subartist = chart.bmson?.info?.subartists?.join(' ') ?? '';
    switch (refOp) {
      case BEATORAJA_TEXT.TITLE:
        return meta.title ?? '';
      case BEATORAJA_TEXT.SUBTITLE:
        return meta.subtitle ?? '';
      case BEATORAJA_TEXT.FULLTITLE:
        return joinNonEmpty(meta.title, meta.subtitle);
      case BEATORAJA_TEXT.GENRE:
        return meta.genre ?? '';
      case BEATORAJA_TEXT.ARTIST:
        return meta.artist ?? '';
      case BEATORAJA_TEXT.SUBARTIST:
        return subartist;
      case BEATORAJA_TEXT.FULLARTIST:
        return joinNonEmpty(meta.artist, subartist);
      default:
        return undefined;
    }
  }

  /**
   * Resolve an `image[].ref` op-code into the frame index the skin should pick from the cell strip. The
   * default `0` keeps lamp / clear-state icons on their initial frame; once gauge / lamp / FC state is
   * wired through state signals, this fans out to the matching cell.
   */
  resolveRefValue(_refOp: number): number {
    return 0;
  }

  /** Update the autoplay op (mostly for symmetry with the engine driver — mode rarely changes mid-chart). */
  setAutoPlay(active: boolean): void {
    if (active) {
      this.activeOps.delete(BEATORAJA_OP.AUTOPLAY_OFF);
      this.activeOps.add(BEATORAJA_OP.AUTOPLAY_ON);
    } else {
      this.activeOps.delete(BEATORAJA_OP.AUTOPLAY_ON);
      this.activeOps.add(BEATORAJA_OP.AUTOPLAY_OFF);
    }
  }

  /** Test-only / diagnostic accessor — returns whether `op` is currently in the active set. */
  hasOp(op: number): boolean {
    return this.activeOps.has(op);
  }

  /** Test-only / diagnostic accessor — returns the start ms for `timerId`, or `undefined` if not set. */
  getTimerStart(timerId: number): number | undefined {
    return this.timerStartedAt.get(timerId);
  }

  /** `true` between `trigger-poor-bga` and `clear-poor-bga` engine commands. */
  isPoorBgaActive(): boolean {
    return this.poorBgaActive;
  }

  /**
   * Reset adapter state to the construction defaults. Used on chart restart so per-chart timers don't
   * bleed into the next run. The autoplay op latched at construction is preserved (the host re-creates
   * the adapter on a mode change rather than mutating one in flight).
   */
  reset(): void {
    const wasAutoplay = this.activeOps.has(BEATORAJA_OP.AUTOPLAY_ON);
    this.activeOps.clear();
    for (const op of this.baseOps) this.activeOps.add(op);
    this.activeOps.add(wasAutoplay ? BEATORAJA_OP.AUTOPLAY_ON : BEATORAJA_OP.AUTOPLAY_OFF);
    this.activeOps.add(BEATORAJA_OP.NOW_LOADING);
    this.timerStartedAt.clear();
    this.timerStartedAt.set(TIMER_SCENE_START, 0);
    this.judgeState[1].lastJudgeOp = undefined;
    this.judgeState[1].lastFastSlowOp = undefined;
    this.judgeState[2].lastJudgeOp = undefined;
    this.judgeState[2].lastFastSlowOp = undefined;
    this.poorBgaActive = false;
    this.frame = null;
  }

  // ─── Internals ────────────────────────────────────────────────────────────────────────────────

  private resolveSide(channel: string): BeatorajaSide {
    return channel.startsWith('2') ? 2 : 1;
  }

  /**
   * Map an engine channel to a beatoraja per-side lane index. Per prop.lua the convention is:
   *   - lane 0 = scratch (`bomb_*p_scratch = 50/60`, `keyon_*p_scratch = 100/110`, …)
   *   - lane 1..9 = keys 1..9 (`bomb_*p_key1 = 51`, etc.)
   * `resolveSideKeySlot` already returns 0 for scratch and 1..N for keys, so we pass the slot through
   * verbatim. (Earlier the adapter mapped scratch onto lane 8, which generated a `keyon_1p_key8` timer
   * for every scratch press — the corresponding skin chrome never lit up.)
   */
  private resolveLane(channel: string): number | undefined {
    const slot = resolveSideKeySlot(channel, this.chartPlayVariant);
    if (slot < 0) return undefined;
    return slot;
  }

  private startLaneTimer(channel: string, resolver: (side: BeatorajaSide, lane: number) => number | undefined): void {
    const side = this.resolveSide(channel);
    const lane = this.resolveLane(channel);
    if (lane === undefined) return;
    const id = resolver(side, lane);
    if (id === undefined) return;
    this.markTimer(id);
  }

  private startLaneKeyOnTimer(channel: string): void {
    this.startLaneTimer(channel, keyOnTimerId);
  }

  private startLaneKeyOffTimer(channel: string): void {
    this.startLaneTimer(channel, keyOffTimerId);
  }

  private startLaneBombTimer(channel: string): void {
    this.startLaneTimer(channel, bombTimerId);
  }

  private startLaneLnHoldTimer(channel: string): void {
    this.startLaneTimer(channel, lnHoldTimerId);
  }
}

function joinNonEmpty(...parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}

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
//     1. `new BeatorajaRuntimeAdapter({ baseOps, getNowMs })`
//     2. `adapter.markTimer(TIMER_LOAD_END)` once chart resources finish decoding
//     3. `adapter.markTimer(TIMER_PLAY_START)` once the engine begins audible playback
//     4. Per-frame:
//        - `adapter.applyFrame(uiSignals.getFrame())`
//        - drain commands → `adapter.applyCommand(cmd)`
//        - drain judge-combo states → `adapter.applyJudgeCombo(state)`
//        - `view.update(adapter.getRenderContext())`

import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { resolveSideKeySlot } from '@be-music/player/core/lane-layout';
import type { PlayerJudgeComboSignalState } from '@be-music/player/state-signals';
import type { PlayerUiCommand, PlayerUiFramePayload } from '@be-music/player/core/ui-signal-bus';
import type { BeatorajaRenderContext } from './beatoraja-render.ts';
import {
  BEATORAJA_OP,
  bombTimerId,
  judgeOpForKind,
  judgeTimerId,
  keyOffTimerId,
  keyOnTimerId,
  lnHoldTimerId,
  TIMER_FADEOUT_START,
  TIMER_LOAD_END,
  TIMER_LOAD_START,
  TIMER_PLAY_START,
  TIMER_SCENE_START,
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
  /** `true` when the engine was started in autoplay mode. Surfaces the `AUTO_PLAY_ON` op. */
  autoPlay?: boolean;
}

/**
 * Per-side state the adapter tracks for the "last judgement" gate. `lastJudgeOp` is the op-code the
 * adapter last added to `activeOps`; the adapter clears it when a new judgement of a different kind comes
 * in so only one of the `P{1,2}_JUDGE_*` group is active at a time.
 */
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
  private frame: PlayerUiFramePayload | null = null;
  private readonly judgeState: Record<BeatorajaSide, SideJudgeState> = {
    1: { lastJudgeOp: undefined, lastFastSlowOp: undefined },
    2: { lastJudgeOp: undefined, lastFastSlowOp: undefined },
  };
  /**
   * `true` between `trigger-poor-bga` and `clear-poor-bga` engine commands. The BGA layer reads this to
   * pick from the chart's POOR cue list; without it, the base / layer cues drive the BGA.
   */
  private poorBgaActive = false;

  constructor(options: BeatorajaRuntimeAdapterOptions) {
    this.chartPlayVariant = options.chartPlayVariant;
    this.baseOps = options.baseOps;
    this.activeOps = new Set(options.baseOps);
    this.getNowMs = options.getNowMs;
    if (options.autoPlay) this.activeOps.add(BEATORAJA_OP.AUTO_PLAY_ON);
    this.activeOps.add(this.playModeOp());
    // Scene-start timer is always running — many skin elements default `timer = 0` and read it as the
    // global clock. Other built-in timers fire later via `markTimer`.
    this.timerStartedAt.set(TIMER_SCENE_START, 0);
  }

  /** Stamp a built-in / per-event timer at the current `getNowMs()`. Idempotent — re-marks override. */
  markTimer(timerId: number): void {
    this.timerStartedAt.set(timerId, this.getNowMs());
  }

  /**
   * Convenience wrapper: stamp `TIMER_LOAD_START` and add the `LOADING_IN_PROGRESS` op. Called by the
   * host the moment chart resources begin decoding.
   */
  markLoadingStart(): void {
    this.markTimer(TIMER_LOAD_START);
    this.activeOps.add(BEATORAJA_OP.LOADING_IN_PROGRESS);
  }

  /**
   * Convenience wrapper: stamp `TIMER_LOAD_END` and clear `LOADING_IN_PROGRESS`. Called by the host once
   * `Promise.all` for all chart resources resolves.
   */
  markLoadingEnd(): void {
    this.markTimer(TIMER_LOAD_END);
    this.activeOps.delete(BEATORAJA_OP.LOADING_IN_PROGRESS);
  }

  /** Stamp `TIMER_PLAY_START` — fires when the engine emits `onStart`. */
  markPlayStart(): void {
    this.markTimer(TIMER_PLAY_START);
  }

  /** Stamp `TIMER_FADEOUT_START` — fires at chart end (engine `onStop`). */
  markFadeoutStart(): void {
    this.markTimer(TIMER_FADEOUT_START);
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
        // gated on the lane's bomb timer — so we stamp it here. `applyJudgeCombo` separately handles
        // the judge plate (NOWJUDGE).
        this.startLaneBombTimer(command.channel);
        break;
      case 'hold-lane-until-beat':
        // Long-note start: mark the LN-hold timer for this lane. `release-lane` clears it.
        this.startLaneLnHoldTimer(command.channel);
        break;
      case 'trigger-poor-bga':
        // POOR-BGA window started. Surfaced via `isPoorBgaActive()` so the BGA layer can swap to the
        // chart's POOR cue list. The skin's POOR overlay (gated on the per-side last-judge POOR op) is
        // handled separately by `applyJudgeCombo`.
        this.poorBgaActive = true;
        break;
      case 'clear-poor-bga':
        this.poorBgaActive = false;
        break;
    }
  }

  /**
   * Fold one engine judge-combo publish into the side-relative judge timer + last-judge op gate. Called
   * by the host once per `drainPendingJudgeCombos()` entry.
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
   * Resolve a `text[].ref` op-code into the string the skin should render. Returns `undefined` for codes
   * the adapter doesn't currently surface — the skin view leaves the text empty in that case (matching
   * the preview path's behavior).
   *
   * Only frame-derived strings are wired here for now (combo / score / judge counts). Chart metadata
   * (title / artist / genre) lands in a follow-up patch alongside the chart-info plumbing — those need
   * the host to thread the parsed `BeMusicJson` through, and stay outside this adapter's scope.
   */
  resolveTextContent(_refOp: number): string | undefined {
    if (this.frame === null) return undefined;
    // Placeholder — wired in Phase 4 once the per-op code map is verified against beatoraja's
    // `SkinPropertyMapper`. Returning undefined keeps text destinations empty rather than blasting the
    // wrong content into them.
    return undefined;
  }

  /**
   * Resolve an `image[].ref` op-code into the frame index the skin should pick from the cell strip. The
   * default `0` keeps lamp / clear-state icons on their initial frame; once the engine surfaces gauge /
   * lamp state through stateSignals (Phase 5), this fans out to the matching cell.
   */
  resolveRefValue(_refOp: number): number {
    return 0;
  }

  /**
   * Re-set the auto-play op based on the current mode (mostly for symmetry with the engine driver — the
   * mode doesn't change mid-chart in practice, but it's cheap to support).
   */
  setAutoPlay(active: boolean): void {
    if (active) {
      this.activeOps.add(BEATORAJA_OP.AUTO_PLAY_ON);
    } else {
      this.activeOps.delete(BEATORAJA_OP.AUTO_PLAY_ON);
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
   * Reset adapter state to the construction defaults. The host calls this on chart restart so per-chart
   * timers (judge / key-on / bomb) don't bleed into the new run while the static skin chrome continues
   * paging through scene-start animations.
   */
  reset(): void {
    this.activeOps.clear();
    for (const op of this.baseOps) this.activeOps.add(op);
    this.activeOps.add(this.playModeOp());
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

  private playModeOp(): number {
    // `BeatorajaPlayVariant` doesn't carry a battle-play flag (that's a separate engine option not
    // surfaced by the variant string), so DOUBLE / SINGLE is the only distinction we set here. `'10'` /
    // `'14'` are double-play variants; the rest collapse onto SINGLE.
    return this.chartPlayVariant === '10' || this.chartPlayVariant === '14'
      ? BEATORAJA_OP.PLAY_MODE_DOUBLE
      : BEATORAJA_OP.PLAY_MODE_SINGLE;
  }

  private resolveSide(channel: string): BeatorajaSide {
    return channel.startsWith('2') ? 2 : 1;
  }

  private resolveLane(channel: string): number | undefined {
    const slot = resolveSideKeySlot(channel, this.chartPlayVariant);
    if (slot < 0) return undefined;
    // `resolveSideKeySlot` returns 0 for scratch and 1..7 for keys (or 1..9 for 9-key). beatoraja's
    // per-lane timer base is `100 + lane` where lane = 0 for scratch — but the LR2 / beatoraja
    // convention is to use lane index as-is for both scratch and keys. Map slot 0 (scratch) to lane 8
    // for the 1P side / 9 for 2P, matching beatoraja's `timer_key_on(8) = 108` for 1P scratch.
    //
    // Actually, beatoraja's convention (verified in play24main.lua's `keybeam_order`) treats scratch
    // distinctly with named lane index 25 / 26 (`su` / `sd`). For 7-key / 5-key scratch on 1P, the
    // engine's channel `16` maps onto beatoraja-side lane 8 (a slot that's not occupied by physical
    // keys 1..7) — that's how the LR2 default 7keys skin authors `#DST_NOTE,7` for scratch.
    if (slot === 0) {
      // Scratch — use the LR2 convention `8` (1P) / `8` (2P side base 110 + 8 = 118).
      return 8;
    }
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

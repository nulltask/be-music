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
  BEATORAJA_NUM,
  BEATORAJA_OP,
  BEATORAJA_TEXT,
  bombTimerId,
  computeGenericRankOp,
  computeJudgeExistOps,
  computeRankOp,
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
  private baseOps: ReadonlySet<number>;
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
  private lastHiSpeed = 1;
  /** Running combo, latched from the engine's `judge-combo` publishes. Reset on combo-break verdicts. */
  private runningCombo = 0;
  /** Maximum combo seen this run. */
  private maxCombo = 0;
  /**
   * Last rank op classification — one each for the side-prefixed and generic rank-op blocks.
   * `applyFrame` reads these to know which op to clear when the rank classification crosses a
   * threshold. Without this we'd leave stale rank ops in `activeOps` (every threshold the run
   * crossed would still gate chrome on).
   */
  private readonly lastRankOps: { side?: number; generic?: number } = {};
  /**
   * Adapter-instance boot wallclock — surfaces prop.lua `operating_time_*` (run uptime). Beatoraja's
   * native semantics is "since beatoraja launched"; in our world the closest equivalent is "since
   * this gameplay scene mounted". Stored in `Date.now()` ms so subtraction yields wallclock seconds.
   */
  private readonly bootMs = Date.now();
  /**
   * Ring buffer of recent `getNowMs()` timestamps, captured by `applyFrame`. Used to derive the
   * smoothed `current_fps` readout (prop.lua `current_fps = 20`). Sized for ~1 s of frames at 120
   * Hz, which is more than enough to dampen single-frame jitter.
   */
  private readonly fpsRingMs = new Float64Array(120);
  private fpsRingHead = 0;
  private fpsRingFilled = 0;
  /**
   * Per-ref "we already logged that this isn't wired" set. Keeps `resolveNumberValue` quiet on the hot
   * path while still surfacing each missing prop.lua num exactly once per session.
   */
  private readonly unresolvedNumberRefs = new Set<number>();
  /** Mirror of {@link unresolvedNumberRefs} for `text[].ref`. */
  private readonly unresolvedTextRefs = new Set<number>();

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
    const now = this.getNowMs();
    this.timerStartedAt.set(timerId, now);
    // eslint-disable-next-line no-console
    console.log('[beatoraja-adapter] mark timer', JSON.stringify({ timer: timerId, atMs: now }));
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
    // Record the frame's clock arrival in the FPS ring so `current_fps` (`BEATORAJA_NUM.CURRENT_FPS`)
    // can derive a smoothed rate. Using `getNowMs()` (the same scene clock the timer/keyframe sampler
    // uses) keeps the FPS readout consistent with on-screen timing — if the host throttles the
    // ticker, `current_fps` reflects the throttle, not the wallclock.
    this.fpsRingMs[this.fpsRingHead] = this.getNowMs();
    this.fpsRingHead = (this.fpsRingHead + 1) % this.fpsRingMs.length;
    if (this.fpsRingFilled < this.fpsRingMs.length) this.fpsRingFilled += 1;
    this.refreshDerivedOps(frame.summary);
  }

  /**
   * Recompute summary-derived op gates and toggle them in `activeOps`. Called once per frame from
   * `applyFrame` because the rank classification can shift mid-chart (a single PERFECT can push
   * the EX-score across an AAA threshold). Tracking which ops we last set lets us cleanly remove
   * the previous ones — naively `add`-ing without a corresponding `delete` would leave AA, AAA,
   * etc. all active simultaneously after a rank-up.
   */
  private refreshDerivedOps(summary: PlayerUiFramePayload['summary']): void {
    // ─── Rank ops (P1_RANK_* + generic RANK_*) ──────────────────────────────────────────────
    const maxExScore = summary.total * 2;
    const sideRank = computeRankOp(summary.exScore, maxExScore, 1);
    const genericRank = computeGenericRankOp(summary.exScore, maxExScore);
    if (this.lastRankOps.side !== sideRank) {
      if (this.lastRankOps.side !== undefined) this.activeOps.delete(this.lastRankOps.side);
      this.activeOps.add(sideRank);
      this.lastRankOps.side = sideRank;
    }
    if (this.lastRankOps.generic !== genericRank) {
      if (this.lastRankOps.generic !== undefined) this.activeOps.delete(this.lastRankOps.generic);
      this.activeOps.add(genericRank);
      this.lastRankOps.generic = genericRank;
    }

    // ─── *_EXIST ops ────────────────────────────────────────────────────────────────────────
    // These are sticky once set — a single observation latches the op for the rest of the run.
    // No need to delete; only add as new judge counters cross 0.
    for (const op of computeJudgeExistOps(summary)) this.activeOps.add(op);
  }

  /**
   * Fold a single engine UI command into the timer / op state. The command set is documented on
   * {@link PlayerUiCommand}. Unknown command kinds (forward-compat) are ignored.
   */
  applyCommand(command: PlayerUiCommand): void {
    // eslint-disable-next-line no-console
    console.log('[beatoraja-adapter] apply command', JSON.stringify(command));
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

    // Latch the running combo for `prop.lua num.combo = 104` resolution. The engine emits the
    // post-judge combo value on every publish — for combo-break verdicts (BAD / POOR) it's `0`,
    // otherwise it's the new running combo. `maxCombo` tracks the highest value seen this run for
    // `num.maxcombo2 = 105`.
    this.runningCombo = state.combo;
    if (state.combo > this.maxCombo) this.maxCombo = state.combo;

    // eslint-disable-next-line no-console
    console.log(
      '[beatoraja-adapter] apply judge',
      JSON.stringify({
        side,
        kind: state.judge,
        op,
        combo: state.combo,
        maxCombo: this.maxCombo,
        channel: state.channel,
      }),
    );
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
    const value = this.resolveTextContentInner(refOp, chart);
    if (value === undefined && !this.unresolvedTextRefs.has(refOp)) {
      this.unresolvedTextRefs.add(refOp);
      // eslint-disable-next-line no-console
      console.log(
        '[beatoraja-adapter] resolveTextContent: ref not wired (returns empty)',
        JSON.stringify({ ref: refOp }),
      );
    }
    return value;
  }

  private resolveTextContentInner(refOp: number, chart: BeMusicJson): string | undefined {
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

  /**
   * Resolve a `value[].ref` (prop.lua `num` table key) into the current numeric value to display.
   * Score / combo / judge counts come from the latest engine `frame`; other surfaces (chart BPM,
   * options, system info) come from the chart metadata. Codes the adapter doesn't surface yet return
   * `undefined` and the corresponding digit cells render as `0` (matches reference behavior — the
   * skin author can't tell whether the engine is waiting on data vs the value is genuinely zero).
   */
  resolveNumberValue(refOp: number): number | undefined {
    const summary = this.frame?.summary;
    const value = this.resolveNumberValueInner(refOp, summary);
    if (value === undefined && !this.unresolvedNumberRefs.has(refOp)) {
      // Log each unresolved ref ONCE per session (Set-gated). Helps identify which prop.lua num codes
      // the loaded skin uses but the adapter doesn't yet wire.
      this.unresolvedNumberRefs.add(refOp);
      // eslint-disable-next-line no-console
      console.log('[beatoraja-adapter] resolveNumberValue: ref not wired (returns 0)', JSON.stringify({ ref: refOp }));
    }
    return value;
  }

  /**
   * Resolve a `graph[].type` code into a fill ratio in `[0, 1]`. The skin view scales the graph's
   * source-rect along its `angle` axis by the returned value. Returns `undefined` for codes the
   * adapter doesn't surface (the renderer hides the bar).
   *
   * The supported codes mirror beatoraja's reference theme conventions:
   *
   *   - `1` (gauge 1P) / `6` (gauge 2P): groove gauge percent
   *   - `2`: chart-time progress
   *   - `102`: load progress (always 1 in our pipeline — assets pre-decode before mount)
   *
   * Polyline-style codes (`110` / `113` / `115` — score history) intentionally aren't surfaced
   * here because they don't fit the bar-scaling model. Skins that author them get hidden bars
   * until a per-frame history mechanism ships.
   */
  resolveGraphValue(type: number): number | undefined {
    const frame = this.frame;
    if (frame === undefined || frame === null) return undefined;
    switch (type) {
      // Gauge bars — 1P (`1`) and 2P (`6`). Same data source for both since we're single-player.
      case 1:
      case 6: {
        const gauge = frame.summary.gauge;
        if (gauge === undefined || gauge.max <= 0) return 0;
        return gauge.current / gauge.max;
      }
      // Chart-time progress — fills as the chart plays out. Saturates at 1 when the engine
      // overruns `totalSeconds` slightly (last-note hold past the end-of-chart marker).
      case 2: {
        if (frame.totalSeconds <= 0) return 0;
        return frame.currentSeconds / frame.totalSeconds;
      }
      // Load progress — beatoraja themes show this during the asset-decode window. Our pipeline
      // pre-decodes everything before mounting the gameplay scene, so by the time this resolver
      // is reachable, loading IS complete. Surface 1 to match the "fully loaded" visual.
      case 102:
        return 1;
      default:
        return undefined;
    }
  }

  private resolveNumberValueInner(
    refOp: number,
    summary: PlayerUiFramePayload['summary'] | undefined,
  ): number | undefined {
    // Helpers — defined inside the resolver so the switch arms stay readable. All return finite
    // ints; the `Math.floor` calls in particular are deliberate (beatoraja's value displays are
    // integer-only — fractional parts get their own `_afterdot` slot).
    const exScoreMax = (summary?.total ?? 0) * 2;
    const exScoreRatePct = exScoreMax > 0 ? ((summary?.exScore ?? 0) / exScoreMax) * 100 : 0;
    const scoreRatePct = (summary?.total ?? 0) > 0 ? ((summary?.score ?? 0) / ((summary?.total ?? 0) * 1000)) * 100 : 0;
    const gaugePct = summary?.gauge && summary.gauge.max > 0 ? (summary.gauge.current / summary.gauge.max) * 100 : 0;

    switch (refOp) {
      // ─── Hispeed / lanecover slots ─────────────────────────────────────────────────────
      // Hispeed displays the multiplier ×100 (e.g. 1.5× → 150). The "afterdot" slot carries the
      // post-decimal digits ALONE so a skin can render `xxx.yy` with two separate value strips
      // (`hispeed` / `hispeed_afterdot`). LR2 `hispeed_lr2 = 10` is the legacy slot — same payload.
      case BEATORAJA_NUM.HISPEED:
      case BEATORAJA_NUM.HISPEED_LR2:
        return Math.round(this.lastHiSpeed * 100);
      case BEATORAJA_NUM.HISPEED_AFTERDOT: {
        // Two-digit fractional part of hispeed × 100 — i.e. (hispeed * 100) mod 100. For 1.50 → 50;
        // for 2.00 → 0. Matches beatoraja's value-strip convention where `divx=10` digit slots are
        // pulled from this op.
        return Math.round(this.lastHiSpeed * 100) % 100;
      }
      // Lanecover / lift / hidden / judge timing — these are skin-config knobs the host doesn't yet
      // surface. Returning 0 (not undefined) keeps the readout zero AND silences the "ref not
      // wired" log so authors aren't spammed about features that simply aren't connected.
      case BEATORAJA_NUM.JUDGETIMING:
      case BEATORAJA_NUM.LANECOVER1:
      case BEATORAJA_NUM.LIFT1:
      case BEATORAJA_NUM.HIDDEN1:
      case BEATORAJA_NUM.DURATION:
      case BEATORAJA_NUM.DURATION_GREEN:
        return 0;

      // ─── Wallclock + run uptime + FPS (17-29) ──────────────────────────────────────────
      // `time_*` reads the local wallclock — what beatoraja prints in the corner of every scene.
      // `JS Date` returns the user's local TZ which matches beatoraja's "your computer's clock"
      // semantics on Windows. `getMonth()` is 0-indexed; +1 for the human convention.
      case BEATORAJA_NUM.TIME_YEAR:
        return new Date().getFullYear();
      case BEATORAJA_NUM.TIME_MONTH:
        return new Date().getMonth() + 1;
      case BEATORAJA_NUM.TIME_DAY:
        return new Date().getDate();
      case BEATORAJA_NUM.TIME_HOUR:
        return new Date().getHours();
      case BEATORAJA_NUM.TIME_MINUTE:
        return new Date().getMinutes();
      case BEATORAJA_NUM.TIME_SECOND:
        return new Date().getSeconds();
      // `operating_time_*` is "how long has beatoraja been running" — we approximate with "how long
      // has this adapter instance lived", split into hour / minute / second. Authors typically
      // display this as a single `HH:MM:SS` row from the three slots, so all three need to agree.
      case BEATORAJA_NUM.OPERATING_TIME_HOUR:
        return Math.floor((Date.now() - this.bootMs) / 3_600_000);
      case BEATORAJA_NUM.OPERATING_TIME_MINUTE:
        return Math.floor(((Date.now() - this.bootMs) / 60_000) % 60);
      case BEATORAJA_NUM.OPERATING_TIME_SECOND:
        return Math.floor(((Date.now() - this.bootMs) / 1_000) % 60);
      // `totalplaytime_*` — accumulated play time across ALL sessions. No persistence layer yet,
      // so all three slots return 0. Mirror the adapter's existing best-record-block contract.
      case BEATORAJA_NUM.TOTALPLAYTIME_HOUR:
      case BEATORAJA_NUM.TOTALPLAYTIME_MINUTE:
      case BEATORAJA_NUM.TOTALPLAYTIME_SECOND:
        return 0;
      // `current_fps` — smoothed FPS derived from the ring of recent `applyFrame` clock stamps. A
      // single-frame measurement is too noisy (microtick jitter shows ±20 fps); the ring averages
      // over up to ~1 s of frames so the readout is stable. Empty / single-sample → 0 (we'd
      // divide by zero or by an arbitrarily-small interval otherwise).
      case BEATORAJA_NUM.CURRENT_FPS: {
        if (this.fpsRingFilled < 2) return 0;
        const newestIdx = (this.fpsRingHead - 1 + this.fpsRingMs.length) % this.fpsRingMs.length;
        const oldestIdx = (this.fpsRingHead - this.fpsRingFilled + this.fpsRingMs.length) % this.fpsRingMs.length;
        const newest = this.fpsRingMs[newestIdx]!;
        const oldest = this.fpsRingMs[oldestIdx]!;
        const spanSec = (newest - oldest) / 1000;
        if (spanSec <= 0) return 0;
        // `fpsRingFilled - 1` because N samples bracket N-1 inter-frame intervals.
        return Math.round((this.fpsRingFilled - 1) / spanSec);
      }

      // ─── Best-record block (71-84) ─────────────────────────────────────────────────────
      // These read from the per-chart score DB. We don't have a DB layer yet, so they all return
      // 0 — same contract as `totalplaytime_*` above. The exception is `totalnotes = 74`, which
      // duplicates the live engine `summary.total` (the chart is already parsed; we don't need
      // a DB lookup for it).
      case BEATORAJA_NUM.TOTALNOTES:
        return summary?.total ?? 0;
      case BEATORAJA_NUM.BEST_SCORE:
      case BEATORAJA_NUM.BEST_MAXSCORE:
      case BEATORAJA_NUM.BEST_MAXCOMBO:
      case BEATORAJA_NUM.BEST_MISSCOUNT:
      case BEATORAJA_NUM.PLAYCOUNT:
      case BEATORAJA_NUM.CLEARCOUNT:
      case BEATORAJA_NUM.FAILCOUNT:
      case BEATORAJA_NUM.BEST_PERFECT:
      case BEATORAJA_NUM.BEST_GREAT:
      case BEATORAJA_NUM.BEST_GOOD:
      case BEATORAJA_NUM.BEST_BAD:
      case BEATORAJA_NUM.BEST_POOR:
        return 0;

      // ─── Chart metadata (90-92, 96) ────────────────────────────────────────────────────
      // `num.maxbpm = 90`, `num.minbpm = 91`, `num.mainbpm = 92` — the chart's BPM range. We expose
      // `chart.metadata.bpm` (the canonical BPM); min/max would need a scan over all `bpm` events
      // we don't yet do. Returning the canonical value for all three is a reasonable approximation
      // and matches beatoraja's behavior on charts without dynamic BPM changes.
      case BEATORAJA_NUM.MAXBPM:
      case BEATORAJA_NUM.MINBPM:
      case BEATORAJA_NUM.MAINBPM:
        return Math.round(this.chart?.metadata?.bpm ?? 0);
      // `num.playlevel = 96` — chart difficulty rating from `#PLAYLEVEL`. The header is sometimes a
      // string (e.g. `"☆12"`); coerce best-effort to an int with `parseInt`.
      case BEATORAJA_NUM.PLAYLEVEL: {
        const level = this.chart?.metadata?.playLevel;
        if (typeof level === 'number') return Math.trunc(level);
        if (typeof level === 'string') {
          const parsed = Number.parseInt(level, 10);
          return Number.isFinite(parsed) ? parsed : 0;
        }
        return 0;
      }

      // ─── Live-play block (100-116, 121-128, 407, 410-427) ──────────────────────────────
      // `point = 100` is current run's score (NOT the best record); `score2 = 101` is the same
      // value under beatoraja's legacy name (some skins author against either).
      case BEATORAJA_NUM.POINT:
      case BEATORAJA_NUM.SCORE2:
        return summary?.score ?? 0;
      // `score_rate` / `_afterdot` is the EX-score percentage. EX-score's max is `total * 2`
      // (PERFECT = 2, GREAT = 1). Authors expect this to count up smoothly even when raw `score`
      // (a band-step gauge value) doesn't.
      case BEATORAJA_NUM.SCORE_RATE:
        return Math.floor(exScoreRatePct);
      case BEATORAJA_NUM.SCORE_RATE_AFTERDOT:
        return Math.floor((exScoreRatePct - Math.floor(exScoreRatePct)) * 100);
      // `total_rate = 115` / `_afterdot = 116` — score (NOT EX-score) percentage. Score in our
      // engine is already a 0..1000 per-note value, so the max is `total * 1000`. (The exact cap
      // depends on the skin author's expectation; this matches what the engine emits as
      // `summary.score`.)
      case BEATORAJA_NUM.TOTAL_RATE:
        return Math.floor(scoreRatePct);
      case BEATORAJA_NUM.TOTAL_RATE_AFTERDOT:
        return Math.floor((scoreRatePct - Math.floor(scoreRatePct)) * 100);
      case BEATORAJA_NUM.COMBO:
        return this.runningCombo;
      case BEATORAJA_NUM.MAXCOMBO_LIVE:
        return this.maxCombo;
      case BEATORAJA_NUM.TOTALNOTES_LIVE:
        return summary?.total ?? 0;
      case BEATORAJA_NUM.GROOVEGAUGE:
        return Math.floor(gaugePct);
      case BEATORAJA_NUM.GROOVEGAUGE_AFTERDOT:
        return Math.floor((gaugePct - Math.floor(gaugePct)) * 100);
      // Target / rival diff slots — no IR / DB layer, return 0 so the readout shows zero rather
      // than garbage. (Authors gate these behind `if[ir_loaded]` / similar so the zero is benign.)
      case BEATORAJA_NUM.DIFF_EXSCORE:
      case BEATORAJA_NUM.TARGET_SCORE:
      case BEATORAJA_NUM.TARGET_SCORE_RATE:
      case BEATORAJA_NUM.TARGET_SCORE_RATE_AFTERDOT:
        return 0;

      // Per-judge LIVE counts.
      case BEATORAJA_NUM.PERFECT:
        return summary?.perfect ?? 0;
      case BEATORAJA_NUM.GREAT:
        return summary?.great ?? 0;
      case BEATORAJA_NUM.GOOD:
        return summary?.good ?? 0;
      case BEATORAJA_NUM.BAD:
        return summary?.bad ?? 0;
      case BEATORAJA_NUM.POOR:
        return summary?.poor ?? 0;
      case BEATORAJA_NUM.MISS:
        // Engine treats empty-press miss as POOR. Most skins want this readout; surface POOR.
        return summary?.poor ?? 0;
      // Per-judge fast/slow split — engine doesn't track this granularity (only summary totals
      // exist), so all 12 slots return 0. The aggregated totals are surfaced via TOTALEARLY /
      // TOTALLATE below.
      case BEATORAJA_NUM.EARLY_PERFECT:
      case BEATORAJA_NUM.LATE_PERFECT:
      case BEATORAJA_NUM.EARLY_GREAT:
      case BEATORAJA_NUM.LATE_GREAT:
      case BEATORAJA_NUM.EARLY_GOOD:
      case BEATORAJA_NUM.LATE_GOOD:
      case BEATORAJA_NUM.EARLY_BAD:
      case BEATORAJA_NUM.LATE_BAD:
      case BEATORAJA_NUM.EARLY_POOR:
      case BEATORAJA_NUM.LATE_POOR:
      case BEATORAJA_NUM.EARLY_MISS:
      case BEATORAJA_NUM.LATE_MISS:
        return 0;
      case BEATORAJA_NUM.TOTALEARLY:
        return summary?.fast ?? 0;
      case BEATORAJA_NUM.TOTALLATE:
        return summary?.slow ?? 0;
      // `combobreak` and its aliases. The engine treats POOR / MISS as the same kind so all three
      // slots converge to `bad + poor` — beatoraja-side `poor_plus_miss` and the longer
      // `bad_plus_poor_plus_miss` exist for skin authors who want different visual emphasis.
      case BEATORAJA_NUM.COMBOBREAK:
      case BEATORAJA_NUM.BAD_PLUS_POOR_PLUS_MISS:
        return (summary?.bad ?? 0) + (summary?.poor ?? 0);
      case BEATORAJA_NUM.POOR_PLUS_MISS:
        return summary?.poor ?? 0;

      // ─── Time-based readouts (160-165, 1163-1164) ──────────────────────────────────────
      // `nowbpm = 160` — current BPM. Without a per-frame BPM signal we fall back to the chart's
      // canonical BPM, which matches beatoraja's behavior on charts without dynamic BPM changes.
      // Future: when the engine publishes `currentBpm`, hook it here.
      case BEATORAJA_NUM.NOWBPM:
        return Math.round(this.chart?.metadata?.bpm ?? 0);
      // `playtime_*` — minute / second elapsed since playback started. Pulled from the engine
      // frame's `currentSeconds` so it stays in lockstep with what the user hears (independent of
      // wallclock drift, which would cause clock readouts to slip from chart progress).
      case BEATORAJA_NUM.PLAYTIME_MINUTE:
        return this.frame !== null ? Math.floor(this.frame.currentSeconds / 60) : 0;
      case BEATORAJA_NUM.PLAYTIME_SECOND:
        return this.frame !== null ? Math.floor(this.frame.currentSeconds % 60) : 0;
      // `timeleft_*` — minute / second until chart end. Clamped to non-negative because the engine
      // can over-run `totalSeconds` slightly when the last note is held past the end-of-chart marker.
      case BEATORAJA_NUM.TIMELEFT_MINUTE: {
        if (this.frame === null) return 0;
        const left = Math.max(0, this.frame.totalSeconds - this.frame.currentSeconds);
        return Math.floor(left / 60);
      }
      case BEATORAJA_NUM.TIMELEFT_SECOND: {
        if (this.frame === null) return 0;
        const left = Math.max(0, this.frame.totalSeconds - this.frame.currentSeconds);
        return Math.floor(left % 60);
      }
      // `songlength_*` — total chart length, fixed for the run. `totalSeconds` includes any
      // trailing fadeout the engine appends after the last note.
      case BEATORAJA_NUM.SONGLENGTH_MINUTE:
        return this.frame !== null ? Math.floor(this.frame.totalSeconds / 60) : 0;
      case BEATORAJA_NUM.SONGLENGTH_SECOND:
        return this.frame !== null ? Math.floor(this.frame.totalSeconds % 60) : 0;
      // `loading_progress = 165` — 0..100. We don't track granular load progress, but the gameplay
      // path only mounts after assets finished decoding, so by the time this resolver is reachable
      // loading IS complete. Surface 100 to keep readouts that gate UI on "not yet 100" happy.
      case BEATORAJA_NUM.LOADING_PROGRESS:
        return 100;

      default:
        return undefined;
    }
  }

  /**
   * Latch the current high-speed multiplier. The host calls this once per frame from
   * `stateSignals.highSpeed()` so {@link resolveNumberValue} can surface it without owning a
   * subscription on the signal bus.
   */
  setHiSpeed(value: number): void {
    if (Number.isFinite(value) && value > 0) this.lastHiSpeed = value;
  }

  /**
   * Snapshot the running combo's all-time-high for this run. The result scene needs it because
   * `PlayerSummary` doesn't carry max combo (only judge counts) — combo is derived from the
   * judge-state stream, which the adapter aggregates here.
   */
  getMaxCombo(): number {
    return this.maxCombo;
  }

  /**
   * Replace the option-driven base op set with `next` while preserving runtime ops (last-judge gate,
   * autoplay flag, loaded / now-loading state, etc.). Used when the user re-picks a skin's
   * `property[]` mid-chart — the visual chrome should reflect the new option immediately without
   * tearing down the engine driver. Old ops absent from `next` are removed; new ops are added.
   */
  setBaseOps(next: ReadonlySet<number>): void {
    for (const op of this.baseOps) {
      if (!next.has(op)) this.activeOps.delete(op);
    }
    for (const op of next) this.activeOps.add(op);
    this.baseOps = next;
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
   * Diagnostic snapshot of every stamped timer. Returned as an array of `[id, atMs]` pairs sorted by
   * id so the output is stable across calls. Used by the gameplay view's periodic debug log to surface
   * which timers fired during the run.
   */
  timerSnapshot(): ReadonlyArray<readonly [number, number]> {
    return Array.from(this.timerStartedAt.entries()).sort((a, b) => a[0] - b[0]);
  }

  /** Diagnostic — current op set as a sorted array. Useful for "what's gating chrome right now" debugging. */
  activeOpSnapshot(): ReadonlyArray<number> {
    return Array.from(this.activeOps).sort((a, b) => a - b);
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
    this.runningCombo = 0;
    this.maxCombo = 0;
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

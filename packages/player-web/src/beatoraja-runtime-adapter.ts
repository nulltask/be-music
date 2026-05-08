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
import { computeBeatorajaNoteBreakdown } from './beatoraja-chart-note-counts.ts';
import {
  BEATORAJA_NUM,
  BEATORAJA_OP,
  BEATORAJA_TEXT,
  bombTimerId,
  comboTimerId,
  computeGenericRankOp,
  computeJudgeExistOps,
  computeRankOp,
  endOfNoteTimerId,
  judgeOpForKind,
  judgeTimerId,
  keyOffTimerId,
  keyOnTimerId,
  lnHoldTimerId,
  TIMER_FADEOUT,
  TIMER_FAILED,
  TIMER_FULLCOMBO_1P,
  TIMER_FULLCOMBO_2P,
  TIMER_GAUGE_INCREASE_1P,
  TIMER_GAUGE_INCREASE_2P,
  TIMER_GAUGE_MAX_1P,
  TIMER_PLAY,
  TIMER_READY,
  TIMER_RHYTHM,
  TIMER_SCENE_START,
  TIMER_STARTINPUT,
  type BeatorajaSide,
  type BeatorajaSkinOffsetValue,
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
  /**
   * Optional mounted skin's display name. Surfaced through `BEATORAJA_TEXT.SKIN_NAME = 50` so
   * skins that print their own name on the play scene get a real string instead of empty.
   */
  skinHeaderName?: string;
  /** Optional skin author name — surfaces `BEATORAJA_TEXT.SKIN_AUTHOR = 51`. */
  skinHeaderAuthor?: string;
  /**
   * Optional song directory label — surfaces `BEATORAJA_TEXT.DIRECTORY = 1000`. Beatoraja's
   * reference theme uses this to show the parent folder name on the play scene's status bar.
   */
  directoryLabel?: string;
  /**
   * Per-skin lane height in skin-pixel units. Used to scale `OFFSET_LIFT.y` so the lift slider's
   * full range moves the hidden-cover edge across exactly one lane height (= the visual extent
   * the cover should travel between `liftRatio = 0` and `1`).
   *
   * Hosts extract this from the skin's `slider[]` block — the `lanecover` / `lift` slider's
   * authored `range` is the canonical value. Defaults to {@link DEFAULT_LANE_HEIGHT} when the
   * caller doesn't supply it (matches the reference theme's 580; close enough for any skin
   * that doesn't author this metadata explicitly).
   */
  laneHeight?: number;
}

interface SideJudgeState {
  lastJudgeOp: number | undefined;
  lastFastSlowOp: number | undefined;
}

/**
 * Default lane height (in skin-pixel units) when the host doesn't supply a per-skin value via
 * `BeatorajaRuntimeAdapterOptions.laneHeight`. Matches `play7main.lua`'s `lanecover` slider
 * `range = 580` — the reference theme value. Used to scale `OFFSET_LIFT.y` to a full-coverage
 * shift at `liftRatio = 1`.
 */
const DEFAULT_LANE_HEIGHT = 580;

/**
 * How long `BEATORAJA_OP.LANECOVER1_CHANGING` (= 270) stays active after the player's last
 * lanecover / lift input. Reference theme uses this op to gate the percentage popup that fades
 * after each adjustment — 500ms feels right (long enough to read, short enough not to linger).
 */
const COVER_CHANGING_WINDOW_MS = 500;

/**
 * Maximum samples retained in the recent-timings ring for the timingvisualizer. 50 mirrors
 * beatoraja's reference `SkinTimingVisualizer` decay tail — long enough to read the recent
 * pattern at a glance, short enough that re-stroking the polyline every judge stays cheap.
 */
const RECENT_TIMINGS_CAPACITY = 50;

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
  private readonly skinHeaderName: string | undefined;
  private readonly skinHeaderAuthor: string | undefined;
  private readonly directoryLabel: string | undefined;
  /**
   * Skin-pixel lane height — used to scale `OFFSET_LIFT.y` so the lift slider's full extent
   * matches one lane height. See {@link BeatorajaRuntimeAdapterOptions.laneHeight}.
   */
  private readonly laneHeight: number;
  private frame: PlayerUiFramePayload | null = null;
  private readonly judgeState: Record<BeatorajaSide, SideJudgeState> = {
    1: { lastJudgeOp: undefined, lastFastSlowOp: undefined },
    2: { lastJudgeOp: undefined, lastFastSlowOp: undefined },
  };
  private poorBgaActive = false;
  private lastHiSpeed = 1;
  /**
   * Player's lanecover position in `[0, 1]`. `0` = cover off (slider at home, no obscuring),
   * `1` = cover fully extended (covers the upper portion of the lane). Drives the `slider[]`
   * `type = 4` (1P) / `type = 5` (2P) value AND the `BEATORAJA_NUM.LANECOVER_1P` (= 14) percent
   * readout. The host adjusts this through {@link adjustLanecover} / {@link setLanecover} as the
   * player drags the slider, scrolls the wheel, or presses the lanecover hotkeys.
   */
  private lanecoverRatio = 0;
  /**
   * Wallclock ms (`getNowMs`-relative) of the last lanecover or lift adjustment. Used to drive
   * `BEATORAJA_OP.LANECOVER1_CHANGING = 270` — the op stays active for {@link COVER_CHANGING_WINDOW_MS}
   * after the player's last input, so reference-theme destinations gated on the op (e.g. the
   * `lanecover-value` percentage readout that pops up while the player is tweaking the cover)
   * appear briefly and then fade out.
   */
  private coverLastChangedAtMs: number | undefined;
  /**
   * Player's lift slider position in `[0, 1]`. `0` = lift at home (hidden-cover collapsed at the
   * bottom edge), `1` = lift fully extended (cover at maximum lift, exposing the upper part of
   * the lane). Drives `OFFSET_LIFT.y` (mapped onto a skin-pixel Y-UP shift via
   * {@link LIFT_MAX_Y_OFFSET}) AND the `BEATORAJA_NUM.LIFT1 = 314` percent readout.
   */
  private liftRatio = 0;
  /**
   * User-adjustable destination offsets keyed by `OFFSET_*` id (from `SkinProperty.OFFSET_LIFT`
   * et al.). Values default to `ZERO_BEATORAJA_OFFSET` (no shift, full alpha) and stay there
   * until a host plugs in slider input via {@link setOffset}. The skin view consumes this through
   * `context.resolveOffset` — both the per-destination `offsets[]` adjustment and the hidden-
   * cover `disapearLine` lift linkage read from this map.
   */
  private readonly offsets: Map<number, BeatorajaSkinOffsetValue> = new Map();
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
  private readonly lastRankOps: { side?: number; generic?: number; now?: number; band?: number } = {};
  /**
   * Per-judge `(progress, exScore)` samples accumulated during the run. Result skins consume
   * this through `getResultHistory()` to draw score-over-time polyline graphs (`graph[].type =
   * 110` / `113` / `115` in beatoraja's reference). Pushed inside `applyJudgeCombo` because every
   * EX-score change funnels through the same judge path — sampling once per judge keeps the
   * polyline density proportional to "how much actually happened" rather than wallclock time.
   */
  private readonly scoreHistory: Array<{ progress: number; exScore: number }> = [];
  /** Per-judge `(progress, gauge%)` samples — gauge polyline source. Same lifecycle as scoreHistory. */
  private readonly gaugeHistory: Array<{ progress: number; value: number }> = [];
  /**
   * Recent judgement timing samples — circular buffer keyed by insertion order. Each entry holds
   * the signed delta (positive = late, negative = early) and the judge kind so the
   * timingvisualizer can render judgement-tier-colored marks. Capped at
   * {@link RECENT_TIMINGS_CAPACITY} — the oldest sample is dropped when capacity is reached so
   * the visualizer paints a fixed-cost decay tail without unbounded memory growth.
   */
  private readonly recentTimings: Array<{ deltaMs: number; kind: string }> = [];
  /**
   * Full timing-delta history for the entire run, kept unbounded across the chart so the result
   * scene's `timingdistributiongraph[]` can render a per-ms histogram of every judgement. Memory
   * cost is ~16 bytes per entry × note count (a 2k-note chart costs ~32KB), well within budget.
   */
  private readonly allTimings: Array<{ deltaMs: number; kind: string }> = [];
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
   * Last seen `frame.currentBeat` (latched on every `applyFrame`). Drives the `TIMER_RHYTHM`
   * (= 140) re-stamp logic — when `Math.floor(currentBeat)` advances we restart the rhythm timer
   * so any keyframe gated on it replays from t=0 on every beat boundary. `undefined` until the
   * first frame arrives so the very first beat doesn't accidentally count as a crossing.
   */
  private lastFrameBeat: number | undefined;
  /**
   * Last seen `summary.gauge.current` (latched on every `applyFrame`). Drives the `TIMER_FAILED`
   * (= 3) instant-fail detection — when the gauge transitions from a positive value to 0 we
   * stamp the timer so HARD / DEATH gauge skins replay their fail-flash animation. `undefined`
   * before the first frame so the very first 0 reading doesn't count as a transition.
   */
  private lastFrameGauge: number | undefined;
  /**
   * Whether `markFailed` (or the in-frame gauge-zero detection) already stamped the
   * `TIMER_FAILED` timer this run. Idempotent — multiple host-level calls (instant fail then
   * end-of-chart fail re-declaration) leave the original stamp in place so authored fail
   * animations don't restart and replay.
   */
  private failedTimerStamped = false;
  /**
   * Last note beat per side, computed once at construction from the chart events.
   * `undefined` for a side with no notes (e.g. SP chart has no `2x` channels). Drives the
   * `TIMER_ENDOFNOTE_1P/2P` (143 / 144) re-stamp logic — when `frame.currentBeat` crosses the
   * latched value we mark the side's endofnote timer so any "song complete" reveal animation
   * gated on it can play out.
   */
  private readonly lastNoteBeatBySide: { 1: number | undefined; 2: number | undefined } = { 1: undefined, 2: undefined };
  /** Latched once we stamp the side's endofnote timer so we don't re-stamp on subsequent frames. */
  private readonly endOfNoteStamped: { 1: boolean; 2: boolean } = { 1: false, 2: false };
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
    this.skinHeaderName = options.skinHeaderName;
    this.skinHeaderAuthor = options.skinHeaderAuthor;
    this.directoryLabel = options.directoryLabel;
    this.laneHeight =
      typeof options.laneHeight === 'number' && Number.isFinite(options.laneHeight) && options.laneHeight > 0
        ? options.laneHeight
        : DEFAULT_LANE_HEIGHT;
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
    // ─── Static chart-trait + variant op gates ──────────────────────────────────────────────
    // These are computed once at construction from chart metadata and never change. Skins gate
    // optional chrome on them (e.g. show LN-specific lane backgrounds only when HAS_LN is set,
    // or hide BPM-change indicators when NO_BPMCHANGE).
    this.applyChartVariantOps(options.chartPlayVariant);
    this.applyChartTraitOps(options.chart);
    // Pre-compute the last note beat per side so `applyFrame` can detect the chart's
    // end-of-notes moment and stamp `TIMER_ENDOFNOTE_*P` (143 / 144). This is a one-shot
    // chart-data scan — `frame.notes` is the rendering window subset, not the full chart, so
    // it can't be used as the signal source.
    if (options.chart !== undefined) {
      const last = computeLastNoteBeatBySide(options.chart);
      this.lastNoteBeatBySide[1] = last[1];
      this.lastNoteBeatBySide[2] = last[2];
    }
    // Default gauge type — beatoraja sets exactly one of `gauge_groove / hard / ex` (1P side).
    // Without a runtime gauge-mode setting we default to GROOVE; the result-scene path can
    // refine via `summary.gauge.type` once we surface it.
    this.activeOps.add(BEATORAJA_OP.GAUGE_GROOVE);
    // Scene-start timer is always running — many skin elements default `timer = 0` and read it as the
    // global clock. Other built-in timers fire later via `markTimer`.
    this.timerStartedAt.set(TIMER_SCENE_START, 0);
  }

  /** Activate the matching `OPTION_*KEYSONG` op for the chart's variant. */
  private applyChartVariantOps(variant: ChartPlayVariant): void {
    switch (variant) {
      case '7':
        this.activeOps.add(BEATORAJA_OP.KEYSONG_7K);
        break;
      case '5':
        this.activeOps.add(BEATORAJA_OP.KEYSONG_5K);
        break;
      case '14':
        this.activeOps.add(BEATORAJA_OP.KEYSONG_14K);
        break;
      case '10':
        this.activeOps.add(BEATORAJA_OP.KEYSONG_10K);
        break;
      case '9':
        this.activeOps.add(BEATORAJA_OP.KEYSONG_9K);
        break;
    }
  }

  /**
   * Activate static chart-trait gates derived from the chart payload:
   *
   *   - `HAS_LN` / `NO_LN` — does the chart contain long notes?
   *   - `HAS_BPMCHANGE` / `NO_BPMCHANGE` — does the chart change BPM mid-song?
   *   - `HAS_BPMSTOP` — does it use STOP events?
   *   - `HAS_TEXT` / `NO_TEXT` — does it carry text channels?
   *   - `HAS_STAGEFILE` / `HAS_BANNER` / `HAS_BACKBMP` — chart graphics presence
   *   - `HAS_BGA` / `NO_BGA` — does the chart use BGA channels?
   *
   * Mirrors beatoraja's static analysis at chart load. Many skins gate optional chrome (e.g. an
   * LN-specific lane indicator) on these, so the chrome doesn't appear on non-LN charts.
   */
  private applyChartTraitOps(chart: BeMusicJson | undefined): void {
    if (chart === undefined) return;
    const meta = chart.metadata;
    // `HAS_LN`: the chart uses LN channels (channels in 50-69 range for LN, 53/54 for CN, etc.).
    // The simplest signal is the presence of any event whose channel starts with '5'. This is a
    // best-effort heuristic — beatoraja inspects the parsed note data; we approximate via channel
    // prefixes since BeMusicJson doesn't expose a precomputed flag.
    let hasLn = false;
    let hasBpmChange = false;
    let hasBpmStop = false;
    let hasText = false;
    for (const event of chart.events ?? []) {
      const ch = event.channel;
      if (ch.length === 2) {
        const first = ch[0];
        if (first === '5' || first === '6') hasLn = true;
        else if (ch === '03' || ch === '08') hasBpmChange = true;
        else if (ch === '09') hasBpmStop = true;
        else if (ch === '99') hasText = true;
      }
      if (hasLn && hasBpmChange && hasBpmStop && hasText) break;
    }
    this.activeOps.add(hasLn ? BEATORAJA_OP.HAS_LN : BEATORAJA_OP.NO_LN);
    this.activeOps.add(hasBpmChange ? BEATORAJA_OP.HAS_BPMCHANGE : BEATORAJA_OP.NO_BPMCHANGE);
    if (hasBpmStop) this.activeOps.add(BEATORAJA_OP.HAS_BPMSTOP);
    this.activeOps.add(hasText ? BEATORAJA_OP.HAS_TEXT : BEATORAJA_OP.NO_TEXT);
    // BGA presence — the chart's `resources.bmp` map being non-empty is the simplest signal.
    const hasBga = Object.keys(chart.resources?.bmp ?? {}).length > 0;
    this.activeOps.add(hasBga ? BEATORAJA_OP.HAS_BGA : BEATORAJA_OP.NO_BGA);
    // Chart graphic presence flags. These are static metadata fields on `BeMusicMetadata`.
    this.activeOps.add(meta.stageFile ? BEATORAJA_OP.HAS_STAGEFILE : BEATORAJA_OP.NO_STAGEFILE);
    this.activeOps.add(meta.banner ? BEATORAJA_OP.HAS_BANNER : BEATORAJA_OP.NO_BANNER);
    this.activeOps.add(meta.backBmp ? BEATORAJA_OP.HAS_BACKBMP : BEATORAJA_OP.NO_BACKBMP);
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
    this.refreshRhythmTimer(frame.currentBeat);
    this.refreshFailedTimer(frame.summary.gauge);
    this.refreshEndOfNoteTimer(frame.currentBeat);
    this.refreshGaugeMaxTimer(frame.summary.gauge);
  }

  /**
   * Stamp `TIMER_GAUGE_MAX_1P` (= 44) once when the 1P gauge first crosses 100%. ModernChic's
   * `Play/lua/sp/info.lua` authors a "lamp_maxgauge" celebration animation gated on this timer
   * — without the stamp the lamp stays at its idle keyframe even after the gauge maxes out.
   *
   * Idempotent — once stamped, subsequent frames don't re-fire even if the gauge dips and
   * climbs again. Beatoraja's reference behaviour is "first reach wins"; the celebration runs
   * once per chart.
   */
  private refreshGaugeMaxTimer(gauge: PlayerUiFramePayload['summary']['gauge']): void {
    if (gauge === undefined) return;
    if (this.gaugeMaxStamped) return;
    if (gauge.max <= 0) return;
    if (gauge.current >= gauge.max) {
      this.markTimer(TIMER_GAUGE_MAX_1P);
      this.gaugeMaxStamped = true;
    }
  }
  private gaugeMaxStamped = false;

  /**
   * Re-stamp `TIMER_ENDOFNOTE_1P/2P` (143 / 144) when the playhead crosses the side's last
   * note. Skins use this to trigger end-of-song reveal animations (e.g. "FULL COMBO" badges
   * fading in once the chart's last note has been judged). Per-side and idempotent — once
   * stamped, subsequent frames don't re-stamp even if the engine seeks backwards then forwards
   * again.
   *
   * Skips sides with no notes (SP chart has `lastNoteBeatBySide[2] === undefined`); the side's
   * endofnote timer simply never fires for those, which matches beatoraja's behavior — the
   * authored chrome on the empty side stays in its idle state.
   */
  private refreshEndOfNoteTimer(currentBeat: number): void {
    if (!Number.isFinite(currentBeat)) return;
    for (const side of [1, 2] as const) {
      if (this.endOfNoteStamped[side]) continue;
      const lastBeat = this.lastNoteBeatBySide[side];
      if (lastBeat === undefined) continue;
      if (currentBeat >= lastBeat) {
        this.markTimer(endOfNoteTimerId(side));
        this.endOfNoteStamped[side] = true;
        // Full-combo check — at the moment the side's last note passes, if no combo break
        // has occurred (`bad === 0 && poor === 0`), stamp the FC celebration timer. ModernChic
        // / GdbG_Skin gate end-of-chart "FULL COMBO" reveal animations on this. Engine treats
        // miss-press as POOR so checking `poor` covers both empty-press and bad-timing breaks.
        const summary = this.frame?.summary;
        if (summary !== undefined && (summary.bad ?? 0) === 0 && (summary.poor ?? 0) === 0) {
          this.markTimer(side === 1 ? TIMER_FULLCOMBO_1P : TIMER_FULLCOMBO_2P);
        }
      }
    }
  }

  /**
   * Detect a mid-play instant-fail moment and stamp `TIMER_FAILED` (= 3) accordingly. HARD and
   * DEATH gauge variants drain to 0 mid-play; the moment the gauge crosses zero is the natural
   * trigger for the skin's authored fail-flash animation. GROOVE / EASY gauges don't reach 0
   * during play (they bottom out at 2 with the standard `min` floor) so this detection is a
   * no-op for them — the explicit {@link markFailed} call from the host's chart-end handler is
   * the right path for those.
   *
   * Stamps once per run (`failedTimerStamped` latch). A re-clear (gauge climbs back above 0)
   * doesn't unset the latch — once you've failed on HARD, the skin's fail visual is supposed to
   * persist, mirroring beatoraja's authored chrome.
   */
  private refreshFailedTimer(gauge: PlayerUiFramePayload['summary']['gauge']): void {
    if (gauge === undefined || this.failedTimerStamped) {
      this.lastFrameGauge = gauge?.current;
      return;
    }
    const prev = this.lastFrameGauge;
    this.lastFrameGauge = gauge.current;
    // Only stamp on a transition into 0 — a frame that arrives at 0 right after construction
    // (without a preceding positive reading) is treated as the load-state baseline rather than
    // a fail event. Without this guard a chart that mounts the gameplay scene before the
    // engine's first frame has populated the gauge would mis-fire the failed timer.
    if (prev !== undefined && prev > 0 && gauge.current <= 0) {
      this.markTimer(TIMER_FAILED);
      this.failedTimerStamped = true;
    }
  }

  /**
   * Stamp `TIMER_FAILED` (prop.lua `failed = 3`) for an end-of-chart fail outcome. Hosts call
   * this from the engine's `onComplete` handler when `summary.gauge.cleared` is `false` so the
   * result-bound fadeout plays the failed variant of authored animations.
   *
   * Idempotent — repeat calls (or a host call after a mid-play HARD-gauge instant fail already
   * stamped via {@link refreshFailedTimer}) leave the original stamp in place. The skin's fail
   * animation runs from the FIRST stamp, which matches beatoraja's behavior.
   */
  markFailed(): void {
    if (this.failedTimerStamped) return;
    this.markTimer(TIMER_FAILED);
    this.failedTimerStamped = true;
  }

  /**
   * Re-stamp the rhythm timer (prop.lua `rhythm = 140`) on every beat boundary. Skins gate
   * pulse / strobe animations on this so visual elements throb in time with the music — a
   * `dst[]` with `loop = 0` and `cycle`-equivalent timing reads `now - timerStart[140]` and
   * replays from t=0 every time we re-stamp.
   *
   * Detection is based on the integer beat advancing (`Math.floor(beat)` change) rather than
   * sub-beat interpolation: at typical BPMs (60..240) beats happen at 1..4 Hz while
   * `applyFrame` runs at ~60 Hz, so the integer-crossing heuristic catches every boundary
   * within one frame's worth of jitter (≤ 16 ms — imperceptible for a pulse animation).
   *
   * The very first frame doesn't count as a crossing (`lastFrameBeat === undefined`); it just
   * latches the baseline so subsequent crossings are detectable. Reverse beat motion (engine
   * seek backwards) re-stamps too — the timer should always reflect the most recent beat
   * boundary regardless of direction.
   */
  private refreshRhythmTimer(currentBeat: number): void {
    if (!Number.isFinite(currentBeat)) return;
    const flooredNow = Math.floor(currentBeat);
    const flooredPrev = this.lastFrameBeat !== undefined ? Math.floor(this.lastFrameBeat) : flooredNow;
    if (this.lastFrameBeat === undefined || flooredNow !== flooredPrev) {
      this.markTimer(TIMER_RHYTHM);
    }
    this.lastFrameBeat = currentBeat;
  }

  /**
   * Recompute summary-derived op gates and toggle them in `activeOps`. Called once per frame from
   * `applyFrame` because the rank classification can shift mid-chart (a single PERFECT can push
   * the EX-score across an AAA threshold). Tracking which ops we last set lets us cleanly remove
   * the previous ones — naively `add`-ing without a corresponding `delete` would leave AA, AAA,
   * etc. all active simultaneously after a rank-up.
   */
  private refreshDerivedOps(summary: PlayerUiFramePayload['summary']): void {
    // ─── Rank ops (P1_RANK_* + generic RANK_* + NOW_*_1P) ───────────────────────────────────
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
    // `NOW_*_1P` ops mirror the side rank but in the 340-347 range (separate from the 200-207
    // `_1P_*` block). Skins that author "now playing" rank chrome gate on these.
    const nowRank = mapSideRankToNowRank(sideRank);
    if (this.lastRankOps.now !== nowRank) {
      if (this.lastRankOps.now !== undefined) this.activeOps.delete(this.lastRankOps.now);
      this.activeOps.add(nowRank);
      this.lastRankOps.now = nowRank;
    }

    // ─── EX-score band ops (P1_BAND_0_9 .. P1_BAND_100, P1_BAND_BORDER_OR_MORE) ─────────────
    // The active band based on EX-score / max ratio in 10% steps. Skins typically use this for
    // an animated "you're in this band" indicator.
    const band = computeScoreBandOp(summary.exScore, maxExScore);
    if (this.lastRankOps.band !== band) {
      if (this.lastRankOps.band !== undefined) this.activeOps.delete(this.lastRankOps.band);
      this.activeOps.add(band);
      this.lastRankOps.band = band;
    }
    // `P1_BAND_BORDER_OR_MORE` — sticky bit that activates once the EX-score crosses 80%
    // (typical IIDX "border" / clear threshold). Stays on even if subsequent breaks drop below.
    if (maxExScore > 0 && summary.exScore / maxExScore >= 0.8) {
      this.activeOps.add(BEATORAJA_OP.P1_BAND_BORDER_OR_MORE);
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
        // Press: stamp KEY_ON, deactivate KEY_OFF. Beatoraja's `KeyInputProccessor` does
        // `setTimerOn(keyOn); setTimerOff(keyOff)` symmetrically — the OFF state for the
        // opposite timer is what hides any element gated on it (`SkinObject.prepareRegion`
        // skips drawing when its timer is OFF). Without the deactivate, the lane laser /
        // keybeam keyed on KEY_ON would stay visible after the player released the key
        // because the timer's start time would still be set.
        this.startLaneKeyOnTimer(command.channel);
        this.deactivateLaneKeyOffTimer(command.channel);
        break;
      case 'release-lane':
        // Release: stamp KEY_OFF, deactivate KEY_ON. Symmetric to press-lane.
        this.startLaneKeyOffTimer(command.channel);
        this.deactivateLaneKeyOnTimer(command.channel);
        break;
      case 'flash-lane':
        // `flash-lane` is the engine's "key was pressed" signal. It fires for every input
        // (manual press AND autoplay note consumption), regardless of judge severity. We
        // mirror it onto KEY_ON so autoplay's keybeams light up the same way manual play's
        // do — the bomb sprite is fired SEPARATELY in `applyJudgeCombo` for PERFECT / GREAT
        // verdicts only (see the bomb-trigger logic there). Earlier the adapter triggered
        // the bomb timer here, which lit the explosion sprite on every press including
        // empty-press POORs and BAD verdicts — bomb is supposed to be a positive-feedback
        // cue specifically for clean hits, never empty-press / low-judgement.
        this.startLaneKeyOnTimer(command.channel);
        this.deactivateLaneKeyOffTimer(command.channel);
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

    // Restart the side's combo timer (prop.lua `combo_1p = 446` / `combo_2p = 447`) on every
    // combo-keeping verdict. Skins use this to drive the combo number's pop-in / flicker
    // animation — the keyframe sampler reads `now - timerStart[combo_*p]` so re-stamping makes
    // the animation replay from t=0 on every successful hit. PERFECT / GREAT / GOOD all advance
    // the combo; BAD / POOR / MISS break it (and intentionally DON'T restart the timer —
    // beatoraja keeps the combo number's idle pose during a break, then resumes the animation
    // from the next successful hit). Using judge kind directly (not the post-publish combo value)
    // because the combo counter is shared across sides in double-play — a side-2 hit advancing
    // the combo to N+1 wouldn't differ in `state.combo` from a side-1 hit, so the only reliable
    // signal of "this side advanced" is the verdict.
    if (isComboAdvanceJudge(state.judge)) {
      this.markTimer(comboTimerId(side));
    }

    // Fire the lane bomb timer ONLY for clean hits (PERFECT / GREAT). The bomb is a positive-
    // feedback explosion sprite — beatoraja's reference themes intentionally don't fire it on
    // GOOD / BAD / POOR / MISS / empty-press, so the player gets a clear visual contrast
    // between "clean hit" and "off-timing hit". The engine's `flash-lane` command alone can't
    // gate this (it fires on every press regardless of judgement), so we drive bomb from the
    // judge-publish path here. `state.channel` carries the lane the engine matched, so the
    // bomb stamps the right per-lane timer (`bomb_*p_keyN` = 50+lane / 60+lane / 1000+lane).
    if (isCleanHitJudge(state.judge) && state.channel !== undefined) {
      this.startLaneBombTimer(state.channel);
    }

    // Re-stamp the gauge-increase timer on each clean hit. ModernChic's
    // `lamp_gaugeinclease` cycles a 2-frame sparkle at `cycle = 50ms` keyed off this stamp;
    // dirty hits (GOOD / BAD / POOR / MISS) typically don't gain gauge so we skip them.
    // Side-aware (1P / 2P) so DP charts get the right per-side feedback.
    if (isCleanHitJudge(state.judge)) {
      this.markTimer(side === 1 ? TIMER_GAUGE_INCREASE_1P : TIMER_GAUGE_INCREASE_2P);
    }

    // Latch the running combo for `prop.lua num.combo = 104` resolution. The engine emits the
    // post-judge combo value on every publish — for combo-break verdicts (BAD / POOR) it's `0`,
    // otherwise it's the new running combo. `maxCombo` tracks the highest value seen this run for
    // `num.maxcombo2 = 105`.
    this.runningCombo = state.combo;
    if (state.combo > this.maxCombo) this.maxCombo = state.combo;

    // Capture the signed timing delta when the engine supplied one. Two sinks:
    //   1. `recentTimings` — bounded ring drives the live `timingvisualizer[]` decay tail.
    //   2. `allTimings` — unbounded full-run history feeds the result scene's
    //      `timingdistributiongraph[]` histogram. Both sample only the same valid-delta events
    //      (READY / AUTO PLAY / mine BAD all leave deltaMs undefined and skip both sinks).
    if (typeof state.deltaMs === 'number' && Number.isFinite(state.deltaMs)) {
      const sample = { deltaMs: state.deltaMs, kind: state.judge };
      this.recentTimings.push(sample);
      if (this.recentTimings.length > RECENT_TIMINGS_CAPACITY) this.recentTimings.shift();
      this.allTimings.push(sample);
    }

    // Append a polyline sample. Mirrors what `PixiGameplayView.publishJudge` does on the LR2
    // path — a `(progress, exScore)` / `(progress, gauge%)` pair captured at every judge so the
    // result polyline reflects the chart's structure (dense in busy stretches, sparse in calm
    // ones) rather than wallclock-uniform sampling.
    const frame = this.frame;
    if (frame !== null) {
      const progress = frame.totalSeconds > 0 ? Math.max(0, Math.min(1, frame.currentSeconds / frame.totalSeconds)) : 0;
      this.scoreHistory.push({ progress, exScore: frame.summary.exScore });
      const gauge = frame.summary.gauge;
      const gaugePct = gauge !== undefined && gauge.max > 0 ? (gauge.current / gauge.max) * 100 : 0;
      this.gaugeHistory.push({ progress, value: gaugePct });
    }

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

  /**
   * Snapshot the polyline histories accumulated this run. Returns frozen copies so consumers
   * can't mutate adapter state. Used by gameplay's `onComplete` hand-off to seed the result
   * scene's polyline-graph renderer.
   */
  getResultHistory(): {
    scoreHistory: ReadonlyArray<{ progress: number; exScore: number }>;
    gaugeHistory: ReadonlyArray<{ progress: number; value: number }>;
    timingHistory: ReadonlyArray<{ deltaMs: number; kind: string }>;
  } {
    return {
      scoreHistory: this.scoreHistory.slice(),
      gaugeHistory: this.gaugeHistory.slice(),
      timingHistory: this.allTimings.slice(),
    };
  }

  /**
   * Read-only handle the skin view consumes per frame. The same `activeOps` Set instance
   * persists across calls (no per-frame allocation), but membership is mutated as derived ops
   * (lanecover / lift cover toggles, cover-changing window) come and go.
   */
  getRenderContext(): BeatorajaRenderContext {
    this.refreshCoverOps();
    return {
      activeOps: this.activeOps,
      getTimerStart: (id) => this.timerStartedAt.get(id),
      nowMs: this.getNowMs(),
      resolveOffset: (id) => this.resolveOffset(id),
    };
  }

  /**
   * Toggle `BEATORAJA_OP.LANECOVER1_ON` / `LIFT1_ON` based on whichever ratio is non-zero, and
   * keep `LANECOVER1_CHANGING` lit for {@link COVER_CHANGING_WINDOW_MS} after the player's last
   * adjustment. Authors gate per-cover percentage popups on `op = {270}` (the changing op) so the
   * popup briefly appears whenever the player nudges the cover and fades out otherwise.
   */
  private refreshCoverOps(): void {
    if (this.lanecoverRatio > 0) this.activeOps.add(BEATORAJA_OP.LANECOVER1_ON);
    else this.activeOps.delete(BEATORAJA_OP.LANECOVER1_ON);
    if (this.liftRatio > 0) this.activeOps.add(BEATORAJA_OP.LIFT1_ON);
    else this.activeOps.delete(BEATORAJA_OP.LIFT1_ON);
    const changing =
      this.coverLastChangedAtMs !== undefined && this.getNowMs() - this.coverLastChangedAtMs < COVER_CHANGING_WINDOW_MS;
    if (changing) this.activeOps.add(BEATORAJA_OP.LANECOVER1_CHANGING);
    else this.activeOps.delete(BEATORAJA_OP.LANECOVER1_CHANGING);
  }

  /**
   * Resolve a `SkinProperty.OFFSET_*` id into the player's current shift for that slot.
   *
   * `OFFSET_LIFT` (id `3`) is computed from the live {@link liftRatio} so that dragging the lift
   * slider immediately propagates to the hidden-cover `disapearLine` linkage and any
   * `destination[].offsets = {3}` author-shift. Other slots fall back to whatever was pushed via
   * {@link setOffset}; if nothing was, returns `undefined` (the destination renderer treats this
   * as `ZERO_BEATORAJA_OFFSET`).
   */
  resolveOffset(offsetId: number): Readonly<BeatorajaSkinOffsetValue> | undefined {
    if (offsetId === 3) {
      // OFFSET_LIFT — derived live from `liftRatio`, scaled by the skin's lane height so
      // `liftRatio = 1` shifts the cover edge by exactly one lane. We let the manual
      // `setOffset(3, ...)` path override only when no live ratio is set (= 0); once the player
      // nudges the lift slider, this branch always wins. Other axes default to 0 / 255.
      if (this.liftRatio !== 0) {
        return { x: 0, y: this.liftRatio * -this.laneHeight, w: 0, h: 0, r: 0, a: 255 };
      }
    }
    return this.offsets.get(offsetId);
  }

  /**
   * Push a value for a `SkinProperty.OFFSET_*` id. Called by the host whenever the player drags
   * the matching slider (lift / lanecover / hidden-cover). Passing a partial object merges with
   * the previous value — fields the caller doesn't touch stay at their last known value, which
   * matches beatoraja's behavior of letting authors enable specific axes via the offset's
   * authored `(x, y, w, h, r, a)` mask.
   */
  setOffset(offsetId: number, value: Readonly<Partial<BeatorajaSkinOffsetValue>>): void {
    const previous = this.offsets.get(offsetId);
    const merged: BeatorajaSkinOffsetValue = {
      x: value.x ?? previous?.x ?? 0,
      y: value.y ?? previous?.y ?? 0,
      w: value.w ?? previous?.w ?? 0,
      h: value.h ?? previous?.h ?? 0,
      r: value.r ?? previous?.r ?? 0,
      a: value.a ?? previous?.a ?? 255,
    };
    this.offsets.set(offsetId, merged);
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
      // Skin metadata + directory don't live on the chart — the host provides them via the
      // `skinHeader` / `directoryLabel` adapter options. Returning empty when those weren't
      // wired keeps the chrome neutral instead of leaking `undefined` through the resolver.
      case BEATORAJA_TEXT.SKIN_NAME:
        return this.skinHeaderName ?? '';
      case BEATORAJA_TEXT.SKIN_AUTHOR:
        return this.skinHeaderAuthor ?? '';
      case BEATORAJA_TEXT.DIRECTORY:
        return this.directoryLabel ?? '';
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
   * Resolve the live gauge percent in `[0, 100]` for the `gauge` element renderer. The result
   * scene typically exposes a frozen value, the gameplay path an updating one — both go through
   * this single resolver. Returns 0 when the engine hasn't published a frame yet (gauge starts
   * at the GROOVE init value once the first frame lands).
   */
  resolveGaugePercent(): number {
    const gauge = this.frame?.summary.gauge;
    if (gauge === undefined || gauge.max <= 0) return 0;
    return (gauge.current / gauge.max) * 100;
  }

  /**
   * Resolve a `slider[].type` code into a translation ratio in `[0, 1]`. The skin view translates
   * the slider sprite by `value * range` skin-pixels along its angle axis. Most slider types map
   * to user-config values that aren't yet plumbed through the adapter (lanecover %, lift %, etc.);
   * returning `undefined` from the default branch hides those sliders cleanly.
   *
   * Wired types:
   *   - `4` (1P lanecover) / `5` (2P lanecover) → {@link lanecoverRatio}, the player's current
   *     lanecover slider position. `0` = home (no cover); `1` = fully extended.
   *   - `6` (hispeed indicator) → `lastHiSpeed` clamped to a typical 0..10 range, normalized
   *
   * Future: lift / hidden-mode sliders (separate from lanecover) when those user options surface.
   */
  resolveSliderValue(type: number): number | undefined {
    switch (type) {
      case 4:
      case 5:
        return this.lanecoverRatio;
      case 6: {
        // Hispeed indicator. Hispeed values typically fall in [0.5, 5]; clamp to [0, 10] and
        // normalize so the slider's full range corresponds to that span. Authors typically draw
        // the indicator's track at a length matching the upper end.
        const clamped = Math.max(0, Math.min(10, this.lastHiSpeed));
        return clamped / 10;
      }
      default:
        return undefined;
    }
  }

  /**
   * Resolve a `judgegraph[].type` code into the per-bar values for histogram rendering. Beatoraja's
   * convention:
   *
   *   - `0` (note distribution) → `[normal, ln, scratch, bss]` from the chart's static breakdown.
   *     Computed once per chart (lazy on first call) and cached for subsequent frames. ModernChic
   *     authors a `type=0` judgegraph for the chart-summary panel — without this resolver the
   *     graph stays hidden during play.
   *   - `1` (judgement spread) → `[perfect, great, good, bad, poor]` from the live summary
   *   - `2` (early/late spread) → `[fast, slow]` from the live summary
   *
   * Returns `undefined` when no data is available yet (chart missing for type=0, or no live
   * summary for types 1/2). The renderer hides the graph in that case.
   */
  resolveJudgeGraphBars(type: number): ReadonlyArray<number> | undefined {
    if (type === 0) {
      if (this.chart === undefined) return undefined;
      if (this.cachedNoteBreakdownBars === undefined) {
        const breakdown = computeBeatorajaNoteBreakdown(this.chart);
        this.cachedNoteBreakdownBars = [breakdown.normal, breakdown.ln, breakdown.scratch, breakdown.bss];
      }
      return this.cachedNoteBreakdownBars;
    }
    const summary = this.frame?.summary;
    if (summary === undefined) return undefined;
    switch (type) {
      case 1:
        return [summary.perfect, summary.great, summary.good, summary.bad, summary.poor];
      case 2:
        return [summary.fast, summary.slow];
      default:
        return undefined;
    }
  }
  private cachedNoteBreakdownBars: ReadonlyArray<number> | undefined;

  /**
   * Resolve recent judgement timings for `timingvisualizer[]` rendering. Returns oldest-first
   * samples (`samples[0]` = oldest in buffer; `samples[length - 1]` = most recent), each with
   * the signed delta and the judge kind. Empty array when no timed judgement has fired yet — the
   * renderer hides the visualizer until the player makes their first judged input.
   *
   * Sign convention matches the engine: positive `deltaMs` = late, negative = early.
   */
  resolveTimingSamples(): ReadonlyArray<{ deltaMs: number; kind: string }> {
    return this.recentTimings;
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
      // 1P lanecover / lift percentage — the player's slider position rendered as `0..100`.
      // Both fields update through {@link adjustLanecover} / {@link setLanecover} (resp.
      // {@link adjustLift} / {@link setLift}) and read back the shared state.
      case BEATORAJA_NUM.LANECOVER1:
        return Math.round(this.lanecoverRatio * 100);
      case BEATORAJA_NUM.LIFT1:
        return Math.round(this.liftRatio * 100);
      // Other skin-config knobs the host doesn't surface yet. Returning 0 (not undefined) keeps
      // the readout zero AND silences the "ref not wired" log so authors aren't spammed about
      // features that simply aren't connected.
      case BEATORAJA_NUM.JUDGETIMING:
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
      // Time elapsed (ms) since the last 1P judgement. Read from the JUDGE_1P timer's stamp;
      // returns 0 before the first judgement (`getTimerStart` undefined). Skins use this to
      // fade out the judge popup ("PERFECT" / "GREAT" badge) — `1 - duration/fadeMs` style.
      case BEATORAJA_NUM.JUDGE_1P_DURATION: {
        const stamp = this.timerStartedAt.get(judgeTimerId(1));
        if (stamp === undefined) return 0;
        return Math.max(0, Math.floor(this.getNowMs() - stamp));
      }
      // BMS `#TOTAL` header value (gauge total). Same code (368) as the select scene's
      // chart-summary readout — ModernChic / GdbG_Skin author it on play too. Returns 0 when
      // the chart didn't author the directive (legacy / minimal BMS).
      case BEATORAJA_NUM.BMS_TOTAL: {
        const total = this.chart?.metadata?.total;
        return typeof total === 'number' && Number.isFinite(total) ? Math.floor(total) : 0;
      }
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
   * Set the player's lanecover ratio directly. Clamped to `[0, 1]`. Drives the `slider[].type =
   * 4|5` value (the visible lanecover sprite) and the `BEATORAJA_NUM.LANECOVER1 = 14` percent
   * readout via the same shared field. Hosts call this when wiring a UI slider to an absolute
   * value; for incremental key / scroll input use {@link adjustLanecover}.
   */
  setLanecover(value: number): void {
    if (!Number.isFinite(value)) return;
    this.lanecoverRatio = Math.max(0, Math.min(1, value));
    this.coverLastChangedAtMs = this.getNowMs();
  }

  /**
   * Nudge the lanecover ratio by `delta` (positive grows the cover, negative shrinks). Clamped
   * to `[0, 1]`. Typical key / scroll bindings step `±0.01` per event for fine control,
   * `±0.05` for a coarser feel.
   */
  adjustLanecover(delta: number): void {
    if (!Number.isFinite(delta)) return;
    this.setLanecover(this.lanecoverRatio + delta);
  }

  /** Read-only handle on the lanecover ratio. Mostly for tests / host-side state mirroring. */
  getLanecover(): number {
    return this.lanecoverRatio;
  }

  /**
   * Set the player's lift ratio directly. Clamped to `[0, 1]`. Drives `OFFSET_LIFT.y` (mapped
   * onto a Y-UP shift via {@link LIFT_MAX_Y_OFFSET}) AND the `BEATORAJA_NUM.LIFT1 = 314` percent
   * readout. Hidden-cover sprites with `isDisapearLineLinkLift = true` re-clip on the next frame.
   */
  setLift(value: number): void {
    if (!Number.isFinite(value)) return;
    this.liftRatio = Math.max(0, Math.min(1, value));
    this.coverLastChangedAtMs = this.getNowMs();
  }

  /**
   * Nudge the lift ratio by `delta` (positive raises the cover edge, negative lowers it).
   * Clamped to `[0, 1]`. Same step conventions as {@link adjustLanecover} — `±0.01` per fine
   * tap, `±0.05` for coarse.
   */
  adjustLift(delta: number): void {
    if (!Number.isFinite(delta)) return;
    this.setLift(this.liftRatio + delta);
  }

  /** Read-only handle on the lift ratio. Mostly for tests / host-side state mirroring. */
  getLift(): number {
    return this.liftRatio;
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
    this.lastFrameBeat = undefined;
    this.lastFrameGauge = undefined;
    this.failedTimerStamped = false;
    this.endOfNoteStamped[1] = false;
    this.endOfNoteStamped[2] = false;
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

  /**
   * Deactivate (= "turn off" in beatoraja's `TimerManager`) a per-lane timer so any
   * destination gated on it stops drawing. We deactivate by deleting the entry from
   * `timerStartedAt` — the destination renderer reads `getTimerStart(id)` and treats
   * `undefined` as "timer not active", which mirrors beatoraja's `isOff` check inside
   * `SkinObject.prepareRegion`.
   *
   * Used for the press → release symmetry (KEY_ON deactivates on release, KEY_OFF
   * deactivates on press) so the lane laser doesn't get stuck visible after a key release.
   */
  private deactivateLaneTimer(channel: string, resolver: (side: BeatorajaSide, lane: number) => number | undefined): void {
    const side = this.resolveSide(channel);
    const lane = this.resolveLane(channel);
    if (lane === undefined) return;
    const id = resolver(side, lane);
    if (id === undefined) return;
    this.timerStartedAt.delete(id);
  }

  private deactivateLaneKeyOnTimer(channel: string): void {
    this.deactivateLaneTimer(channel, keyOnTimerId);
  }

  private deactivateLaneKeyOffTimer(channel: string): void {
    this.deactivateLaneTimer(channel, keyOffTimerId);
  }
}

function joinNonEmpty(...parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}

/**
 * Whether a judge verdict represents a combo-advance (PERFECT / GREAT / GOOD) versus a combo-
 * break (BAD / POOR / MISS). Drives the per-side `combo_*p` timer restart in
 * {@link BeatorajaRuntimeAdapter.applyJudgeCombo}. Case-insensitive — the engine emits upper-
 * case strings but the comparison stays defensive.
 */
function isComboAdvanceJudge(kind: string): boolean {
  const upper = kind.toUpperCase();
  return upper === 'PERFECT' || upper === 'GREAT' || upper === 'GOOD';
}

/**
 * Whether a judge verdict is a "clean hit" that warrants firing the lane bomb explosion.
 * Beatoraja's reference themes only show the bomb sprite for PERFECT and GREAT — GOOD is
 * close-but-imprecise (it advances combo but is visibly distinct from a clean hit), and
 * BAD / POOR / MISS / empty-press obviously shouldn't trigger a positive-feedback effect.
 */
function isCleanHitJudge(kind: string): boolean {
  const upper = kind.toUpperCase();
  return upper === 'PERFECT' || upper === 'GREAT';
}

/**
 * Beats per measure used for the chart-time → beat conversion. BMS measures default to one full
 * 4/4 bar, with `chart.measures[].length` scaling that 4-beat baseline. The same approximation
 * used by `computeBeatorajaBpmCurve` and `computeBeatorajaChartMarkers`; refinable when we
 * surface a richer beat-per-measure model.
 */
const BEATS_PER_STANDARD_MEASURE = 4;

/**
 * Compute the per-side beat position of the last "real" note in the chart. Used by the
 * adapter to know when to stamp `TIMER_ENDOFNOTE_*P` so authored end-of-song animations fire
 * at the right moment.
 *
 * Side classification (matches the engine's channel convention):
 *   - 1P: channels starting with `1` (e.g. `11`-`19` visible), `5` (LN 1P), or `D` (mine 1P).
 *   - 2P: channels starting with `2`, `6` (LN 2P), or `E` (mine 2P).
 *   - Skipped: BGM (`01`), BPM (`03`/`08`), STOP (`09`), other non-note channels.
 *
 * Mines + invisible channels (`3*` / `4*`) intentionally NOT counted — endofnote should reflect
 * the last *playable* note, not chrome / hazards. Likewise mines (`D*`/`E*`) are excluded
 * because beatoraja's authored "you've finished the song" reveals shouldn't gate on a mine
 * being the last hazard.
 *
 * Returns `{ 1: undefined, 2: undefined }` for charts with no detectable notes (e.g. empty
 * chart fixtures); `undefined` per side means "this side never fires endofnote".
 */
function computeLastNoteBeatBySide(chart: BeMusicJson): { 1: number | undefined; 2: number | undefined } {
  const measureBaseBeat = computeMeasureBaseBeat(chart);
  let last1: number | undefined;
  let last2: number | undefined;
  for (const event of chart.events ?? []) {
    if (event.value === '00' || event.value === '') continue;
    const ch = event.channel;
    if (ch.length < 2) continue;
    // Side from the leading character. Visible (1*/2*), LN (5*/6*) — mines intentionally not
    // included (see function-level comment).
    const head = ch[0]!;
    let side: 1 | 2 | undefined;
    if (head === '1' || head === '5') side = 1;
    else if (head === '2' || head === '6') side = 2;
    else continue;
    // BGM is `01`; visible-note channels start with `1` but the second char distinguishes
    // them from BGM. Skip the explicit `01` literal.
    if (ch === '01') continue;
    const beat = computeEventBeat(event, measureBaseBeat);
    if (beat === undefined) continue;
    if (side === 1) {
      if (last1 === undefined || beat > last1) last1 = beat;
    } else {
      if (last2 === undefined || beat > last2) last2 = beat;
    }
  }
  return { 1: last1, 2: last2 };
}

function computeMeasureBaseBeat(chart: BeMusicJson): number[] {
  const lengths = new Map<number, number>();
  let maxMeasure = 0;
  for (const event of chart.events ?? []) {
    if (event.measure > maxMeasure) maxMeasure = event.measure;
  }
  for (const measure of chart.measures ?? []) {
    const idx = Math.max(0, Math.floor(measure.index));
    if (idx > maxMeasure) maxMeasure = idx;
    if (Number.isFinite(measure.length) && measure.length > 0) {
      lengths.set(idx, measure.length);
    }
  }
  const out: number[] = [];
  let beat = 0;
  for (let m = 0; m <= maxMeasure; m += 1) {
    out.push(beat);
    const length = lengths.get(m) ?? 1;
    beat += length * BEATS_PER_STANDARD_MEASURE;
  }
  return out;
}

function computeEventBeat(
  event: { measure: number; position: readonly [number, number] },
  measureBaseBeat: ReadonlyArray<number>,
): number | undefined {
  const base = measureBaseBeat[event.measure];
  if (base === undefined) return undefined;
  const [num, denom] = event.position;
  if (!Number.isFinite(num) || !Number.isFinite(denom) || denom <= 0) return base;
  return base + (num / denom) * BEATS_PER_STANDARD_MEASURE;
}

/**
 * Map a side-rank op (200-207, `_1P_*`) to its `NOW_*_1P` counterpart (340-347). Beatoraja
 * maintains both blocks for live play — `_1P_*` is the "during play" rank gate, `NOW_*_1P` is
 * the "now playing" indicator some skins author separately. We mirror them in lockstep.
 */
function mapSideRankToNowRank(sideRank: number): number {
  // 200..207 (1P_AAA..1P_F) → 340..347 (NOW_AAA_1P..NOW_F_1P)
  if (sideRank >= 200 && sideRank <= 207) return sideRank + 140;
  // For 2P or unknown, leave at NOW_F_1P. The op block doesn't have a 2P variant in this range.
  return BEATORAJA_OP.NOW_F_1P;
}

/**
 * Pick the active EX-score band op (`P1_BAND_0_9` .. `P1_BAND_100`). The band partition is in
 * 10-percent steps of the EX-score / max ratio, snapping to 100 at exactly the max.
 */
function computeScoreBandOp(exScore: number, maxExScore: number): number {
  if (maxExScore <= 0) return BEATORAJA_OP.P1_BAND_0_9;
  const ratio = exScore / maxExScore;
  if (ratio >= 1) return BEATORAJA_OP.P1_BAND_100;
  if (ratio >= 0.9) return BEATORAJA_OP.P1_BAND_90_99;
  if (ratio >= 0.8) return BEATORAJA_OP.P1_BAND_80_89;
  if (ratio >= 0.7) return BEATORAJA_OP.P1_BAND_70_79;
  if (ratio >= 0.6) return BEATORAJA_OP.P1_BAND_60_69;
  if (ratio >= 0.5) return BEATORAJA_OP.P1_BAND_50_59;
  if (ratio >= 0.4) return BEATORAJA_OP.P1_BAND_40_49;
  if (ratio >= 0.3) return BEATORAJA_OP.P1_BAND_30_39;
  if (ratio >= 0.2) return BEATORAJA_OP.P1_BAND_20_29;
  if (ratio >= 0.1) return BEATORAJA_OP.P1_BAND_10_19;
  return BEATORAJA_OP.P1_BAND_0_9;
}

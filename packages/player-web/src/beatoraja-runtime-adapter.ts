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
import type { JudgeWindowsMs } from '@be-music/player/core/judge-window';
import { resolveJudgeWindowsMs } from '@be-music/player/core/judge-window';
import type { PlayerJudgeComboSignalState } from '@be-music/player/state-signals';
import type { PlayerUiCommand, PlayerUiFramePayload } from '@be-music/player/core/ui-signal-bus';
import type { BeatorajaRenderContext } from './beatoraja-render.ts';
import { extractChartSubartist } from './beatoraja-chart-meta.ts';
import { computeBeatorajaNoteBreakdown } from './beatoraja-chart-note-counts.ts';
import { computeBeatorajaChartNoteDistribution } from './beatoraja-chart-note-distribution.ts';
import {
  beatorajaGaugeModeFromString,
  BEATORAJA_NUM,
  BEATORAJA_OP,
  BEATORAJA_TEXT,
  bombTimerId,
  comboTimerId,
  computeGenericRankOp,
  computeJudgeExistOps,
  computeRankOp,
  endOfNoteTimerId,
  JUDGE_LANE_REF_1P_BASE,
  JUDGE_LANE_REF_2P_BASE,
  JUDGE_LANE_REF_RANGE,
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
  TIMER_PREVIEW,
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
  /**
   * Per-side combo-digit metrics extracted from the skin's `judge[].numbers[0]` declaration.
   * Used by the synthetic `SYNTHETIC_OFFSET_JUDGE_WORD_SHIFT_*P` offset to compute the
   * dynamic word-shift amount.
   *
   * Mirrors upstream `SkinJudge.java:108-109`:
   *
   *     nowCount.prepare(time, state, combo, nowJudge.region.x, nowJudge.region.y);
   *     nowJudge.region.x += shift ? -nowCount.getLength() / 2 : 0;
   *
   * Where `nowCount.getLength() = (region.width + space) * (currentImages.length - shiftbase)`
   * — i.e., per-digit cell width PLUS inter-digit space, multiplied by the visible digit count.
   * Both `width` and `space` come from the matching `value[]` declaration referenced by
   * `judge[].numbers[0].id`.
   *
   * Default `width = 40, space = 0` matches default skin's `play5.json` / `play7main.lua`.
   * Community skins with custom metrics pass their authored values.
   */
  judgeComboMetrics?: { 1?: { width?: number; space?: number }; 2?: { width?: number; space?: number } };
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

/**
 * How long after a verdict the per-lane keybeam / bomb imageset stays on its judge-flavored
 * frame. Beatoraja's reference theme uses a brief flash — 250ms feels right (the player keeps
 * holding the key after the hit; the highlight needs to read as a "yes you scored" pulse, not
 * a persistent state). Outside the window the imageset reverts to its neutral frame even if
 * the key is still held; subsequent verdicts re-stamp so a held key during a stream stays
 * highlighted continuously.
 *
 * Naming kept as `_PERFECT_` for legacy reasons — the gate now covers any judge tier (PG / GR
 * / GD / BD / PR / MS), not just PERFECT. See {@link BeatorajaRuntimeAdapter.lastJudgeOnLane}.
 */
const KEYBEAM_PERFECT_WINDOW_MS = 250;

/**
 * How long after a `flash-lane` autoplay press the lane laser stays lit before the
 * auto-release fires KEY_OFF. Matches LR2 path's `KEY_ON_FLASH_HOLD_MS = 60` so visual
 * feedback for autoplay reads as a deliberate flash rather than staying stuck on for the
 * rest of the chart. Skipped when the lane is actively held (real keypress / LN sustain
 * arrived during the window).
 */
const FLASH_LANE_HOLD_MS = 60;

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
  /**
   * Per-side combo-digit metrics — `(width, space)` pair from the matching `value[]`
   * declaration referenced by `judge[].numbers[0].id`. Used by the judge-word-shift
   * synthetic offset to compute `(width + space) * digitCount / 2` per upstream
   * `SkinJudge.java:108-109`'s `nowJudge.region.x += -nowCount.getLength() / 2` formula.
   * Defaults `(40, 0)` cover default skin's `play5.json` / `play7main.lua`.
   */
  private readonly judgeComboMetrics: { 1: { width: number; space: number }; 2: { width: number; space: number } };
  private frame: PlayerUiFramePayload | null = null;
  private readonly judgeState: Record<BeatorajaSide, SideJudgeState> = {
    1: { lastJudgeOp: undefined, lastFastSlowOp: undefined },
    2: { lastJudgeOp: undefined, lastFastSlowOp: undefined },
  };
  /**
   * Per-(side, lane) most-recent-judge ring. Sized to `JUDGE_LANE_REF_RANGE` (10 lanes per side
   * ⇒ keys 0..9 with 0 = scratch). Each slot holds the latest verdict's `(judgeIndex, atMs)`,
   * driving the keybeam / bomb imagesets via the `JUDGE_LANE_REF_*P_BASE + lane` ref:
   *
   *   resolveRefValue(refOp) returns judgeIndex+1 within KEYBEAM_PERFECT_WINDOW_MS, else 0.
   *
   * Beatoraja's renderer clamps the resolved value to `images.length - 1`, so the ref encoding
   * lets a single resolver feed imagesets of varying granularity:
   *
   *   - Default 7K's 2-frame `{ keybeam-w, keybeam-w-pg }`: any judge collapses to frame 1
   *     (= "you scored a hit, here's a flash" — the bright variant fires on every clean
   *     judgement, not just PERFECT).
   *   - Default 9K's 4-frame `{ keybeam-w, keybeam-w-pg, keybeam-w-gr, keybeam-w-gr }`: PG and
   *     GR get distinct color variants (frames 1 / 2), GD/BD/PR/MS clamp to frame 3 (= last GR
   *     entry, which is intentionally the same image as frame 2).
   *   - Default 7K's 4-entry bomb `{ bomb1, bomb2, bomb1, bomb3 }`: PG → bomb2, GR → bomb1
   *     (same as no-judge — GR doesn't get its own bomb), GD → bomb3 (unreachable in practice
   *     since bomb timer only fires on clean hits).
   *
   * `kind` uses `-1` to mean "no judge yet OR the latest judge has aged out"; the resolver maps
   * `-1` to ref `0`. `at` is `getNowMs()`-relative.
   */
  private readonly lastJudgeOnLane: Record<BeatorajaSide, Array<{ kind: number; at: number }>> = {
    1: createEmptyLaneJudgeRing(),
    2: createEmptyLaneJudgeRing(),
  };
  private poorBgaActive = false;
  /**
   * Per-lane "is the player currently holding this LN?" set, keyed by engine `channel` string
   * (e.g. `'11'`, `'26'`). Populated on `hold-lane-until-beat`, cleared on `release-lane`. The
   * note layer reads this via {@link isLaneLnHeld} every frame to swap between the held / unheld
   * LN body sprite slots that beatoraja's modern-mode `lnbody` + `lnbodyActive` pair
   * declares. Distinct from the `lnHoldTimerId` per-lane timer which is "this LN started" —
   * the timer keeps its stamp through release for taper-fade chrome, but this set tracks the
   * live press state.
   */
  private readonly lnHoldHeldByChannel = new Set<string>();
  /**
   * Live "is the player currently holding this lane via a real keypress?" set. Populated on
   * `press-lane`, cleared on `release-lane`. The auto-release path scheduled by
   * `flash-lane` reads this so a real keypress during the brief flash window doesn't get
   * stomped by the timed auto-release. Mirrors the LR2 path's `pressedChannels`.
   */
  private readonly pressedChannels = new Set<string>();
  /**
   * Active `setTimeout` handles for `flash-lane` auto-release. Cleared on dispose so a
   * scene tear-down mid-flash doesn't fire the callback against a disposed adapter.
   */
  private readonly flashReleaseHandles = new Set<ReturnType<typeof setTimeout>>();
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
   * Hidden-cover state. Beatoraja's `LaneRenderer` maintains this on `OFFSET_HIDDEN_COVER`
   * (id `5`). When the user has hidden enabled, the cover paints visibly and `y` shifts
   * proportionally to `hiddenRatio × laneHeight` (with the lift-active variant applying
   * `(1 - lift) × ratio × laneHeight`). When disabled, `a = -255` (additive delta) clamps
   * the cover's keyframe alpha down to 0 — invisible. Default: disabled / 0 ratio so the
   * hidden cover stays out of view until the player opts in.
   *
   * Mirrors `LaneRenderer.java:282-296`. Together with {@link liftRatio} this drives the
   * three lane-cover offset slots (LIFT, LANECOVER, HIDDEN_COVER) that the reference theme
   * and most community skins author.
   */
  private hiddenRatio = 0;
  private hiddenEnabled = false;
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
   * Per-verdict early / late counters. Updated incrementally on every timed
   * `applyJudgeCombo` so the resolver can return the per-judge breakdown
   * (`prop.lua early_perfect = 410` etc.) in O(1). Engine's `summary` only carries the
   * aggregate `fast` / `slow` totals — these per-kind splits are derived locally.
   */
  private readonly earlyLateCounts: Record<'PERFECT' | 'GREAT' | 'GOOD' | 'BAD' | 'POOR' | 'MISS', { early: number; late: number }> = {
    PERFECT: { early: 0, late: 0 },
    GREAT: { early: 0, late: 0 },
    GOOD: { early: 0, late: 0 },
    BAD: { early: 0, late: 0 },
    POOR: { early: 0, late: 0 },
    MISS: { early: 0, late: 0 },
  };
  /**
   * Per-second judge-state buckets for `judgegraph[]` `type=1` (TYPE_JUDGE) — mirrors
   * upstream `SkinNoteDistributionGraph.data[][]` with `DATA_LENGTH[1] = 6`. Each row is
   * `[unjudged, PG, GR, GD, BD, PR]`, indexed by chart-second. Initialized at chart load
   * with every judgeable note (NORMAL + LN-end on key/scratch lanes; LN bodies and mines
   * excluded per upstream's `case TYPE_JUDGE` filter at `SkinNoteDistributionGraph.java:304`).
   * Each `applyJudgeCombo` decrements the bucket's unjudged slot and increments the verdict's
   * slot — by the end of the chart, slot 0 should be 0 and slots 1..5 sum to the chart's
   * total judgeable note count.
   *
   * Approximation note: upstream walks all notes every 750 ms and reads each note's live
   * `getState()` directly (the BMSModel mutates note state on judge). We don't have per-note
   * state plumbed through, so we approximate the note's chart-time-second from
   * `currentChartTimeMs - deltaMs` and update the matching bucket. For the typical case
   * (deltaMs ≤ 100 ms, 1-second buckets) the approximation lands in the right bucket; only
   * edge cases (notes within 100 ms of a second-boundary, judged early) might float to a
   * neighbour. Visual difference is imperceptible.
   */
  private judgeStateBuckets: number[][] = [];
  /**
   * Y-axis max for `judgeStateBuckets` — `max(20, ceil(densest_total / 10) * 10)` capped at
   * 100 per upstream `SkinNoteDistributionGraph.updateData()` line 272-274. Stable for the
   * chart's lifetime since the bucket totals don't change (only their distribution across
   * the 6 states does).
   */
  private judgeStateMaxNotesPerBucket = 0;
  /**
   * Total chart length in ms (from `BeatorajaChartNoteDistribution.totalMs`). Surfaces the
   * x-axis span the renderer needs to position the playhead cursor.
   */
  private judgeStateTotalMs = 0;
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
   * Per-side latch — `true` once `TIMER_FULLCOMBO_*P` has been stamped this run. Mirrors
   * `endOfNoteStamped` but for the FC celebration. A re-judge (engine seeks backwards then
   * forwards) doesn't re-stamp; the FC animation runs once from the moment FC was first
   * achieved, matching beatoraja's reference behaviour.
   */
  private readonly fullComboStamped: { 1: boolean; 2: boolean } = { 1: false, 2: false };
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
    this.judgeComboMetrics = {
      1: resolveJudgeComboMetric(options.judgeComboMetrics?.[1]),
      2: resolveJudgeComboMetric(options.judgeComboMetrics?.[2]),
    };
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
      this.initJudgeStateBuckets(options.chart);
    }
    // Default gauge type — beatoraja sets exactly one of `gauge_groove / hard / ex` (1P side).
    // Without a runtime gauge-mode setting we default to GROOVE; the result-scene path can
    // refine via `summary.gauge.type` once we surface it.
    this.activeOps.add(BEATORAJA_OP.GAUGE_GROOVE);
    // Scene-start timer is always running — many skin elements default `timer = 0` and read it as the
    // global clock. Other built-in timers fire later via `markTimer`.
    this.timerStartedAt.set(TIMER_SCENE_START, 0);
    // Preview timer — beatoraja's runtime stamps it during the brief "chart loaded but not yet
    // playing" window; we don't have that phase exposed separately, so we pin it to scene-start
    // (= 0). ModernChic's `Play/lua/sp/lane.lua` gates the lane chrome reveal on `timer:preview`,
    // so without this the playfield never fades in.
    this.timerStartedAt.set(TIMER_PREVIEW, 0);
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
        // FC stamping moved to `applyJudgeCombo` (combo === total). The previous trigger here
        // fired up to a late-judge window early — a beat-passes-without-final-judge frame would
        // see `bad === 0 && poor === 0` even though a still-pending late-press could break the
        // combo a few frames later. The combo-equals-total path is unambiguous.
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
        this.pressedChannels.add(command.channel);
        this.startLaneKeyOnTimer(command.channel);
        this.deactivateLaneKeyOffTimer(command.channel);
        break;
      case 'release-lane':
        // Release: stamp KEY_OFF, deactivate KEY_ON. Symmetric to press-lane.
        this.pressedChannels.delete(command.channel);
        this.startLaneKeyOffTimer(command.channel);
        this.deactivateLaneKeyOnTimer(command.channel);
        // Clear the LN-hold flag for this lane so the body sprite flips back to the unheld
        // variant (drives `lnBodyHeld` ↔ `lnBodyUnheld` switching at draw time). Note we DON'T
        // deactivate the LN-hold timer here — beatoraja's `TIMER_LN_HOLD_*P_BASE` is supposed
        // to keep its `started_at` for the duration of the LN even after release (skins
        // anchor a "hold ribbon" sprite onto it that taper-fades). The held flag is the live
        // "is the player currently pressing" signal; the timer is the "this LN is in flight"
        // signal. They diverge when the player releases mid-LN.
        this.lnHoldHeldByChannel.delete(command.channel);
        break;
      case 'flash-lane': {
        // `flash-lane` is the engine's "key was pressed" signal. It fires for every input
        // (manual press AND autoplay note consumption), regardless of judge severity. We
        // mirror it onto KEY_ON so autoplay's keybeams light up the same way manual play's
        // do — the bomb sprite is fired SEPARATELY in `applyJudgeCombo` for PERFECT / GREAT
        // verdicts only.
        //
        // Schedule an auto-release after `FLASH_LANE_HOLD_MS` so the laser fades like a
        // real keystroke. Without this, autoplay would leave the laser stuck on after the
        // first note since the engine never emits a matching `release-lane` for autoplay.
        // Skips the auto-release if the lane gets a real `press-lane` (manual takeover) or
        // `hold-lane-until-beat` (LN sustain) within the window — those have their own
        // release lifecycles and clobbering them mid-hold would break visuals.
        const channel = command.channel;
        this.startLaneKeyOnTimer(channel);
        this.deactivateLaneKeyOffTimer(channel);
        const handle = setTimeout(() => {
          this.flashReleaseHandles.delete(handle);
          if (this.pressedChannels.has(channel) || this.lnHoldHeldByChannel.has(channel)) return;
          this.startLaneKeyOffTimer(channel);
          this.deactivateLaneKeyOnTimer(channel);
        }, FLASH_LANE_HOLD_MS);
        this.flashReleaseHandles.add(handle);
        break;
      }
      case 'hold-lane-until-beat':
        this.startLaneLnHoldTimer(command.channel);
        // Mark the lane as actively held so the LN body sprite swaps to the held variant
        // (`note.lnBodyHeld` / `note.hcnBodyHeld`) for the duration. Cleared on
        // `release-lane`.
        this.lnHoldHeldByChannel.add(command.channel);
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
    // FAST / SLOW gate (`_*p_early = 1242 / 1262`, `_*p_late = 1243 / 1263`) — beatoraja's
    // default play skin gates a "FAST" / "SLOW" badge on these ops so the player sees which
    // side of the judge window their hit landed on. Mirrors the `lastJudgeOp` pattern: only
    // one of EARLY / LATE per side stays active at a time; the next judge with a delta swaps
    // them. Hits without a `deltaMs` (READY publish, AUTO PLAY confirmation, mine BAD) leave
    // the previous gate untouched — beatoraja keeps the badge until the NEXT judged hit.
    //
    // Sign convention matches our engine: `deltaMs > 0` = late (player pressed AFTER the
    // note's exact time → SLOW); `deltaMs < 0` = early (BEFORE → FAST). A `deltaMs === 0`
    // perfect-on-time hit clears any prior gate without setting a new one.
    if (typeof state.deltaMs === 'number' && Number.isFinite(state.deltaMs)) {
      const fastSlowOp =
        state.deltaMs < 0
          ? side === 1
            ? BEATORAJA_OP.P1_JUDGE_EARLY
            : BEATORAJA_OP.P2_JUDGE_EARLY
          : state.deltaMs > 0
            ? side === 1
              ? BEATORAJA_OP.P1_JUDGE_LATE
              : BEATORAJA_OP.P2_JUDGE_LATE
            : undefined;
      if (sideState.lastFastSlowOp !== undefined && sideState.lastFastSlowOp !== fastSlowOp) {
        this.activeOps.delete(sideState.lastFastSlowOp);
      }
      if (fastSlowOp !== undefined) {
        this.activeOps.add(fastSlowOp);
      }
      sideState.lastFastSlowOp = fastSlowOp;
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

    // Update the per-(side, lane) most-recent-judge ring. Drives the keybeam imageset (`ref =
    // JUDGE_LANE_REF_*P_BASE + lane`) and the default skin's 4-entry bomb imageset (`{ bomb1,
    // bomb2, bomb1, bomb3 }`) — both pick a frame based on the verdict's judgeIndex+1, with the
    // renderer's clamp degrading high-index verdicts to whatever the imageset's last frame is.
    //
    // A new verdict ALWAYS overwrites the previous one on the same lane (no PERFECT-only
    // filter). The 2-frame keybeam clamps any judge to frame 1 ("you scored, here's a flash"),
    // the 4-frame keybeam distinguishes PG vs GR explicitly, and the bomb imageset relies on
    // its timer (clean-hit-only) to gate visibility regardless of the ref value.
    //
    // Only judgements with a known channel update the ring; READY / AUTO / global ticks all
    // leave channel undefined and skip the update.
    if (state.channel !== undefined) {
      const lane = this.resolveLane(state.channel);
      if (lane !== undefined && lane >= 0 && lane < JUDGE_LANE_REF_RANGE) {
        const judgeIndex = judgeKindToIndex(state.judge);
        if (judgeIndex >= 0) {
          this.lastJudgeOnLane[side][lane] = { kind: judgeIndex, at: this.getNowMs() };
        }
      }
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

    // Stamp `TIMER_FULLCOMBO_*P` (= 48 / 49) the moment the running combo reaches the chart's
    // total note count. The previous trigger (`refreshEndOfNoteTimer`'s `currentBeat >= lastBeat`
    // check) fired at the LAST NOTE'S BEAT, which is up to one late-judge-window early — a player
    // who was still going to land a late-press POOR within the next ~250 ms would have the FC
    // animation stamped despite the run ending in a combo break. Tying the stamp directly to
    // `state.combo === total` is unambiguous: combo can only reach total when every note has
    // been judged AND the last judgement was a combo-keeper, so FC is genuinely achieved.
    //
    // `summary.total` is the chart's full note count (sourced from the engine's per-frame
    // payload); we wait for at least one frame so this is populated before the first judgement
    // can fire FC. Charts with `total === 0` (empty / parser edge case) skip the stamp.
    const total = this.frame?.summary.total ?? 0;
    if (total > 0 && state.combo >= total && !this.fullComboStamped[side]) {
      this.markTimer(side === 1 ? TIMER_FULLCOMBO_1P : TIMER_FULLCOMBO_2P);
      this.fullComboStamped[side] = true;
    }

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
      // Per-verdict early / late counter increment. Sign convention: `deltaMs > 0` =
      // late (player pressed AFTER the note's exact time), `< 0` = early. `=== 0` (perfect-
      // on-time) is rare but doesn't increment either bucket. Default `play5.json`'s
      // judge-count panel reads these via `EARLY_*` / `LATE_*` refs (410-422).
      const bucket = this.earlyLateCounts[state.judge as keyof typeof this.earlyLateCounts];
      if (bucket !== undefined) {
        if (state.deltaMs < 0) bucket.early += 1;
        else if (state.deltaMs > 0) bucket.late += 1;
      }
    }
    // Per-second judge-state bucket update for `judgegraph[]` `type=1` (TYPE_JUDGE).
    // Mirrors upstream `SkinNoteDistributionGraph.updateData()`'s incremental "note moves
    // from state 0 (unjudged) to state N (PG/GR/GD/BD/PR)" behaviour. Runs on every
    // judge publish (READY / AUTO / unknown kinds skip via `judgeStateIndex < 1`).
    this.updateJudgeStateBucket(state);

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
    this.refreshGaugeMaxOp();
    return {
      activeOps: this.activeOps,
      getTimerStart: (id) => this.timerStartedAt.get(id),
      nowMs: this.getNowMs(),
      resolveOffset: (id) => this.resolveOffset(id),
      resolveGaugeState: () => this.resolveGaugeState(),
    };
  }

  /**
   * Toggle `BEATORAJA_OP.GAUGE_NOW_AT_MAX_*P` based on the live groove-gauge percentage.
   * Beatoraja's `SkinJudge.prepare()` consults `gauge.isMax()` directly to decide whether the
   * `judge[6]` fullgauge-PG substitute should replace the standard `judgef-pg` slot (audit
   * 1.2). Beatoraja itself doesn't expose this state through an OPTION code — we synthesize
   * one so the judge expander can use the standard `op[]` gating machinery instead of a
   * parallel substitute path.
   *
   * The op is transient: ON while the gauge is currently at max, OFF when it dips below.
   * Distinct from `TIMER_GAUGE_MAX_1P` (which fires once on FIRST max-cross and stays
   * stamped for the rest of the chart, even if the gauge later falls).
   */
  private refreshGaugeMaxOp(): void {
    const pct = this.resolveGaugePercent();
    if (pct >= 100) this.activeOps.add(BEATORAJA_OP.GAUGE_NOW_AT_MAX_1P);
    else this.activeOps.delete(BEATORAJA_OP.GAUGE_NOW_AT_MAX_1P);
    // 2P-side gauge state isn't currently tracked — battle / DP variants can plumb a separate
    // gauge handle through if and when 2P play lands. Until then, leave the 2P op unset.
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
    // Synthetic judge-word-shift offset (= `judge[].shift` honor path). Mirrors upstream
    // `SkinJudge.java:108-109`:
    //
    //     nowCount.prepare(time, state, combo, nowJudge.region.x, nowJudge.region.y);
    //     nowJudge.region.x += shift ? -nowCount.getLength() / 2 : 0;
    //
    // Where `nowCount.getLength() = (region.width + space) * (currentImages.length - shiftbase)`
    // = the visible combo digits' total pixel width (per-cell width + space, times visible
    // digit count). Shift is applied to `nowJudge.region.x` ONLY — the combo digits
    // themselves stay where they were prepared (= un-shifted parent.x + child.x).
    //
    // Implementation: the synthetic offset id (20001 / 20002) is appended to judgef-*
    // destinations during `expandBeatorajaJudgeDestinations` ONLY when `judge.shift = true`,
    // and the standard offset-summing path in `combineBeatorajaOffsets` adds our resolved
    // value to the keyframe's x. Same observable effect as upstream's inline shift.
    if (offsetId === 20001 || offsetId === 20002) {
      const side: BeatorajaSide = offsetId === 20001 ? 1 : 2;
      // `maxCombo` matches what ref:75 (BEATORAJA_NUM.MAXCOMBO_NOW / BEST_MAXCOMBO_LIVE)
      // displays in the digit row — same value the combo number element renders.
      const combo = this.maxCombo;
      const digitCount = combo <= 0 ? 1 : Math.floor(Math.log10(combo)) + 1;
      const { width, space } = this.judgeComboMetrics[side];
      const shiftPx = ((width + space) * digitCount) / 2;
      // Negative x shifts the judge word LEFT in skin coords.
      return { x: -shiftPx, y: 0, w: 0, h: 0, r: 0, a: 0 };
    }
    if (offsetId === 3) {
      // OFFSET_LIFT — derived live from `liftRatio`, scaled by the skin's lane height so
      // `liftRatio = 1` shifts the cover edge by exactly one lane. We let the manual
      // `setOffset(3, ...)` path override only when no live ratio is set (= 0); once the player
      // nudges the lift slider, this branch always wins. Other axes default to 0 / 255.
      if (this.liftRatio !== 0) {
        // alpha=0 = no change (additive default). Previously 255 was the multiplicative
        // no-op default; matched the old offset semantics but became a +1.0 brightness
        // delta after the alpha-additive switch.
        return { x: 0, y: this.liftRatio * -this.laneHeight, w: 0, h: 0, r: 0, a: 0 };
      }
    }
    if (offsetId === 5) {
      // OFFSET_HIDDEN_COVER — mirrors `LaneRenderer.java:282-296`:
      //
      //   if (enabled) {
      //     hidden.a = 0;
      //     hidden.y = (1 - lift) * ratio * laneHeight       // when lift active
      //              | ratio * laneHeight                    // when lift inactive
      //   } else {
      //     hidden.a = -255;
      //   }
      //
      // The `a = -255` additive delta drops the cover's keyframe alpha (typically 1.0) to
      // 0 — invisible. Default disabled state hides the cover until the player toggles it
      // on via {@link setHiddenCover}.
      if (!this.hiddenEnabled) {
        return { x: 0, y: 0, w: 0, h: 0, r: 0, a: -255 };
      }
      // Negative y in libGDX-Y-UP shifts the cover edge UPWARD (toward the top of the lane).
      // The `(1 - lift)` factor pulls the cover toward the lift edge as the lift rises.
      const liftFactor = this.liftRatio !== 0 ? 1 - this.liftRatio : 1;
      return {
        x: 0,
        y: this.hiddenRatio * liftFactor * -this.laneHeight,
        w: 0,
        h: 0,
        r: 0,
        a: 0,
      };
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
      // Default alpha delta = 0 (additive no-op), matching the new
      // `ZERO_BEATORAJA_OFFSET.a = 0` convention. The previous `?? 255` default was a
      // multiplicative no-op under the old math but is now a maximum-brightness +1.0 delta.
      a: value.a ?? previous?.a ?? 0,
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
    // Sub-artist source covers both formats: bmson `info.subartists[]` (joined with spaces) AND
    // BMS `#SUBARTIST` (which the parser drops into `metadata.extras.SUBARTIST` since it isn't
    // promoted to a typed metadata field). Hosts that need structured access can post-process
    // bmson entries via `parseBmsonSubartist`.
    const subartist = extractChartSubartist(chart);
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
   * Resolve an `image[].ref` / `imageset[].ref` op-code into the frame index the skin should pick
   * from the cell strip / sub-image array. The default `0` keeps lamp / clear-state icons on their
   * initial frame; once gauge / lamp / FC state is wired through state signals, this fans out to
   * the matching cell.
   *
   * Wired ranges:
   *   - `500..509` (1P) / `510..519` (2P) — per-lane most-recent-judge gate. Drives the keybeam
   *     and bomb imagesets (`ref = value_judge(i) = base + lane`). Returns `judgeIndex + 1`
   *     when the lane saw a verdict within {@link KEYBEAM_PERFECT_WINDOW_MS} of `getNowMs()`,
   *     `0` otherwise (= no recent judge). The renderer clamps to `images.length - 1`, so:
   *
   *       - 2-frame imagesets (default 7K's `{ keybeam-w, keybeam-w-pg }`) collapse any
   *         judge to frame 1 (= "you scored a hit").
   *       - 4-frame imagesets (default 9K's `{ keybeam-w, keybeam-w-pg, keybeam-w-gr,
   *         keybeam-w-gr }`) distinguish PG (frame 1) and GR (frame 2); GD/BD/PR/MS clamp
   *         to frame 3 (which the author intentionally aliases to GR's image).
   *
   *     judgeIndex follows beatoraja's enum: 0=PG, 1=GR, 2=GD, 3=BD, 4=PR, 5=MS. Lane 0 is
   *     scratch; 1..7 are keys 1..7; 8/9 are 9-key extensions.
   */
  resolveRefValue(refOp: number): number {
    if (refOp >= JUDGE_LANE_REF_1P_BASE && refOp < JUDGE_LANE_REF_1P_BASE + JUDGE_LANE_REF_RANGE) {
      return this.resolveLaneJudgeRef(1, refOp - JUDGE_LANE_REF_1P_BASE);
    }
    if (refOp >= JUDGE_LANE_REF_2P_BASE && refOp < JUDGE_LANE_REF_2P_BASE + JUDGE_LANE_REF_RANGE) {
      return this.resolveLaneJudgeRef(2, refOp - JUDGE_LANE_REF_2P_BASE);
    }
    return 0;
  }

  private resolveLaneJudgeRef(side: BeatorajaSide, lane: number): number {
    const slot = this.lastJudgeOnLane[side][lane];
    if (slot === undefined || slot.kind < 0) return 0;
    const elapsed = this.getNowMs() - slot.at;
    if (!(elapsed >= 0 && elapsed <= KEYBEAM_PERFECT_WINDOW_MS)) return 0;
    return slot.kind + 1;
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
   * Resolve the full gauge state for the spec-correct `pickBeatorajaGaugeNode` signature
   * (audit 1.4). Beatoraja's `SkinGauge.draw()` indexes nodes as
   * `images[exgauge + frameOffset + (cellBorder < gauge.border ? 1 : 0)]` and needs all four
   * fields to compute the right cell.
   *
   * Returns `undefined` when no frame has landed yet — the gauge renderer hides cells in
   * that case (matching beatoraja's "gauge not yet active" behavior).
   */
  resolveGaugeState():
    | { value: number; max: number; border: number; mode: number }
    | undefined {
    const gauge = this.frame?.summary.gauge;
    if (gauge === undefined || gauge.max <= 0) return undefined;
    return {
      value: gauge.current,
      max: gauge.max,
      border: gauge.clearThreshold,
      mode: beatorajaGaugeModeFromString(gauge.type),
    };
  }

  /**
   * Resolve the gauge type as beatoraja's int constant (`BEATORAJA_GAUGE_MODE.*`). Exposed
   * to Lua via `main_state.gauge_type()`. Defaults to `NORMAL` (= 2) when no frame yet.
   */
  resolveGaugeType(): number {
    const gauge = this.frame?.summary.gauge;
    return beatorajaGaugeModeFromString(gauge?.type);
  }

  /**
   * Live "is the player currently holding the LN on this lane?" lookup. The note layer reads
   * this every frame to flip the LN body sprite between `note.lnBodyHeld` (held) and
   * `note.lnBodyUnheld` (unheld) variants — modern-mode skins (community 9K skins, future
   * default play skins) author distinct sprites per state, and beatoraja's renderer paints
   * the matching one. Legacy-mode skins resolve `lnBodyHeld === lnBodyUnheld` so this lookup
   * has no visual effect for them.
   *
   * Returns `false` when the channel isn't held OR isn't currently in flight as an LN.
   */
  isLaneLnHeld(channel: string): boolean {
    return this.lnHoldHeldByChannel.has(channel);
  }

  /**
   * Resolve a `slider[].type` code into a translation ratio in `[0, 1]`. The skin view translates
   * the slider sprite by `value * range` skin-pixels along its angle axis. The enum is sparse;
   * values mirror upstream `SkinProperty.SLIDER_*` constants. Skins authoring un-surfaced types
   * get `undefined` so their slider sprite stays at home (the renderer hides the indicator).
   *
   * Wired types:
   *   - `4` (`SLIDER_LANECOVER`) / `5` (`SLIDER_LANECOVER2`) → {@link lanecoverRatio}. `0` =
   *     home (no cover), `1` = fully extended. We're single-player so 4 and 5 alias.
   *   - `6` (`SLIDER_MUSIC_PROGRESS`) → `currentSeconds / totalSeconds` clamped to `[0, 1]`.
   *     Drives the small progress-meter bars beatoraja's reference play skins author at the
   *     screen edge (default `play5.json`'s `id=1050/1051`). Returns `0` before the first frame
   *     lands.
   *
   * Unhandled (returns `undefined`):
   *   - `1` (`SLIDER_MUSICSELECT_POSITION`) / `7` (`SLIDER_SKINSELECT_POSITION`) — select-scene
   *     concerns; not driven from the play / decide / result adapter.
   *   - `17`-`19` (`SLIDER_*_VOLUME`) — host-level volume sliders, not surfaced.
   *
   * Note: HISPEED / LIFT / HIDDEN do NOT have slider types in upstream `SkinProperty`. Skins
   * surface those values through `value[]` digit displays (e.g. `BEATORAJA_NUM.HISPEED = 310`),
   * not through `slider[]` indicators.
   */
  resolveSliderValue(type: number): number | undefined {
    switch (type) {
      case 4:
      case 5:
        return this.lanecoverRatio;
      case 6: {
        // Song-playback progress. Falls back to 0 before the first frame lands or for a
        // chart whose totalSeconds didn't resolve (degenerate / empty chart).
        const frame = this.frame;
        if (frame === undefined || frame === null) return 0;
        if (!Number.isFinite(frame.totalSeconds) || frame.totalSeconds <= 0) return 0;
        if (!Number.isFinite(frame.currentSeconds)) return 0;
        return Math.max(0, Math.min(1, frame.currentSeconds / frame.totalSeconds));
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
   *   - `2` (early/late spread) → 21 ms-binned counts from the recent timing buffer covering
   *     the range `[-100 ms, +100 ms]` (10 ms per bin). Mirrors upstream `SkinJudgeGraph`'s
   *     `TYPE_HIT_FAIL_DISTRIBUTION` shape — beatoraja paints one bar per offset bin so the
   *     player sees how their hits cluster around the perfect window. The previous
   *     `[summary.fast, summary.slow]` 2-bar return shape was visibly wrong (only two slabs
   *     instead of a histogram).
   *
   * Returns `undefined` when no data is available yet (chart missing for type=0, or no live
   * summary / no judgements for types 1/2). The renderer hides the graph in that case.
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
        return this.computeTimingHistogram();
      default:
        return undefined;
    }
  }
  private cachedNoteBreakdownBars: ReadonlyArray<number> | undefined;

  /**
   * Bin the live `recentTimings` ring buffer into a histogram for `judgegraph type=2`. Each
   * bin covers a 10 ms slice; bin index 0 spans `[-100, -90)` ms (= max early), bin 20 spans
   * `[+100, +inf)` ms (= max late). Out-of-range samples saturate at the edge bins so a
   * single huge mistime doesn't drop off the chart.
   *
   * Returns `undefined` when no judgements have fired yet — the renderer hides the graph
   * until the first hit lands.
   */
  private computeTimingHistogram(): ReadonlyArray<number> | undefined {
    if (this.recentTimings.length === 0) return undefined;
    const BIN_COUNT = 21;
    const BIN_WIDTH_MS = 10;
    const RANGE_HALF_MS = ((BIN_COUNT - 1) / 2) * BIN_WIDTH_MS; // 100 ms
    const bins = new Array<number>(BIN_COUNT).fill(0);
    for (const sample of this.recentTimings) {
      const offset = sample.deltaMs;
      // Map `[-100, +100]` ms to `[0, 20]` (10 ms per bin), saturating outside.
      let idx = Math.floor((offset + RANGE_HALF_MS) / BIN_WIDTH_MS);
      if (idx < 0) idx = 0;
      else if (idx >= BIN_COUNT) idx = BIN_COUNT - 1;
      bins[idx] = (bins[idx] ?? 0) + 1;
    }
    return bins;
  }

  /**
   * Visible playfield ratio (= what fraction of the lane is unobstructed by lanecover / lift).
   * `withCover = true` reads the live cover state so DURATION_LANECOVER_ON resolvers reflect
   * what the player currently sees; `false` returns the raw 1.0 so DURATION_LANECOVER_OFF
   * tells the player "what would the duration be without cover". Clamped to [0, 1].
   */
  private visibleRatio(withCover: boolean): number {
    if (!withCover) return 1;
    return Math.max(0, Math.min(1, 1 - this.lanecoverRatio - this.liftRatio));
  }

  /**
   * Current BPM for duration math. The frame payload doesn't carry a per-beat BPM today, so
   * we fall back to the chart's main BPM. In practice this is fine — most charts spend most
   * of their time at the main BPM, and the ModernChic panel surfaces the MIN / MAX variants
   * separately for the player to read the range.
   */
  private currentBpmForDuration(): number {
    return this.chart?.metadata.bpm ?? 0;
  }

  /**
   * Min / max BPM across the chart's BPM-change events. Cached on first call (the events list
   * is static for the chart's lifetime). Both fall back to the chart's main BPM when the chart
   * is constant-tempo (no `03` / `08` events).
   */
  private cachedBpmRange(): { min: number; max: number } {
    if (this.bpmRangeCache !== undefined) return this.bpmRangeCache;
    const chart = this.chart;
    const initial = chart?.metadata.bpm ?? 0;
    let min = initial > 0 ? initial : Number.POSITIVE_INFINITY;
    let max = initial;
    const bpmTable = chart?.resources?.bpm ?? {};
    for (const event of chart?.events ?? []) {
      if (event.value === '00' || event.value === '') continue;
      let bpm: number | undefined;
      if (event.channel === '03') {
        const parsed = parseInt(event.value, 16);
        if (Number.isFinite(parsed) && parsed > 0) bpm = parsed;
      } else if (event.channel === '08') {
        const looked = bpmTable[event.value] ?? bpmTable[event.value.toLowerCase()] ?? bpmTable[event.value.toUpperCase()];
        if (typeof looked === 'number') bpm = looked;
        else if (typeof looked === 'string') {
          const parsed = Number.parseFloat(looked);
          bpm = Number.isFinite(parsed) ? parsed : undefined;
        }
      }
      if (bpm !== undefined && bpm > 0) {
        if (bpm < min) min = bpm;
        if (bpm > max) max = bpm;
      }
    }
    if (!Number.isFinite(min)) min = max > 0 ? max : 0;
    this.bpmRangeCache = { min, max };
    return this.bpmRangeCache;
  }
  private bpmRangeCache: { min: number; max: number } | undefined;

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
   * Per-second judge-state histogram for `judgegraph[]` `type=1` (TYPE_JUDGE). Mirrors
   * upstream `SkinNoteDistributionGraph.draw()`'s data shape — each bucket carries the
   * `[unjudged, PG, GR, GD, BD, PR]` counts for one chart-second. Renderer stacks them
   * vertically in column order; as the player progresses, the unjudged (gray) cell at the
   * bottom shrinks and the verdict-coloured cells stack up on top.
   *
   * Returns `undefined` when no chart is loaded (decide / select scenes don't drive this).
   */
  resolveJudgeStateBuckets(type: number): {
    buckets: ReadonlyArray<ReadonlyArray<number>>;
    maxCount: number;
    totalMs: number;
  } | undefined {
    if (type !== 1) return undefined;
    if (this.judgeStateBuckets.length === 0) return undefined;
    return {
      buckets: this.judgeStateBuckets,
      maxCount: this.judgeStateMaxNotesPerBucket,
      totalMs: this.judgeStateTotalMs,
    };
  }

  /**
   * Initialize {@link judgeStateBuckets} from the chart's per-second note distribution.
   * Each judgeable note (NORMAL or LN-end on key/scratch lanes) lands in its second's
   * `unjudged` slot. LN bodies (categories 1 and 4 of the distribution) and mines
   * (category 6) are excluded — upstream's `case TYPE_JUDGE` filter at
   * `SkinNoteDistributionGraph.java:304-309` skips both.
   */
  private initJudgeStateBuckets(chart: BeMusicJson): void {
    const distribution = computeBeatorajaChartNoteDistribution(chart);
    const buckets: number[][] = [];
    let maxPerBucket = 0;
    for (const bucket of distribution.buckets) {
      // Sum the judgeable categories: SCRATCH_LN_END (0), SCRATCH_NORMAL (2),
      // KEY_LN_END (3), KEY_NORMAL (5). LN bodies (1, 4) don't get judged; mines (6)
      // produce damage hits but no PG/GR/GD/BD/PR verdict that lands in TYPE_JUDGE
      // buckets. (Mines DO get judged as a separate "POOR-equivalent" but upstream's
      // TYPE_JUDGE explicitly excludes them via `n instanceof MineNote` early-return.)
      const judgeable = (bucket[0] ?? 0) + (bucket[2] ?? 0) + (bucket[3] ?? 0) + (bucket[5] ?? 0);
      buckets.push([judgeable, 0, 0, 0, 0, 0]);
      if (judgeable > maxPerBucket) maxPerBucket = judgeable;
    }
    this.judgeStateBuckets = buckets;
    this.judgeStateTotalMs = distribution.totalMs;
    // Upstream `updateData()` line 272-274: `max = Math.min((count / 10) * 10 + 10, 100)`
    // bumped from a starting `max = 20`. Same logic — round densest bucket up to nearest
    // 10, capped at 100, floor at 20 (so sparse charts don't stretch a 1-note bucket
    // across the whole graph height).
    this.judgeStateMaxNotesPerBucket = Math.max(20, Math.min(100, Math.ceil(maxPerBucket / 10) * 10));
  }

  /**
   * Update {@link judgeStateBuckets} for one judge event. Decrements the matching
   * bucket's `unjudged` slot and increments the verdict's slot, mirroring upstream's
   * incremental "note moves from state 0 to state N" semantics.
   *
   * The bucket index is approximated as `floor((currentChartTimeMs - deltaMs) / 1000)`.
   * Upstream walks all notes every 750 ms and reads each note's live `getState()` — we
   * don't have per-note state plumbed through, so we use the timing offset to recover the
   * note's chart-second. For the typical `deltaMs ∈ [-150, +150]` range and 1-second
   * buckets, the approximation lands in the correct bucket; only notes within ±deltaMs
   * of a second-boundary might float to a neighbour, an imperceptible visual difference.
   *
   * READY publishes (no `judge` value) and unjudged kinds (`MISS`) skip the update — they
   * don't move a note out of the unjudged state in upstream's semantics.
   */
  private updateJudgeStateBucket(state: PlayerJudgeComboSignalState): void {
    if (this.judgeStateBuckets.length === 0) return;
    const stateIdx = judgeStateIndex(state.judge);
    if (stateIdx < 1) return;
    // Use the engine's latest frame clock as the "current chart time" reference — this is
    // what `frame.currentSeconds * 1000` gives us. Falling back to 0 covers the rare case
    // where a judge fires before the first frame has landed.
    const currentChartTimeMs = (this.frame?.currentSeconds ?? 0) * 1000;
    const noteChartTimeMs = currentChartTimeMs - (state.deltaMs ?? 0);
    const bucketIdx = Math.floor(noteChartTimeMs / 1000);
    if (bucketIdx < 0 || bucketIdx >= this.judgeStateBuckets.length) return;
    const bucket = this.judgeStateBuckets[bucketIdx]!;
    if (bucket[0]! > 0) {
      bucket[0]! -= 1;
      bucket[stateIdx]! += 1;
    }
  }

  /**
   * Resolve the chart's effective judge windows in ms — `{pgreat, great, good, bad}`.
   * Used by the `timingvisualizer[]` renderer to paint upstream's per-band coloured
   * background stripes (mirrors `SkinTimingVisualizer.prepare`'s `getJudgeArea(resource)`
   * call at `SkinTimingVisualizer.java:88`). The skin's bands are stacked outward from
   * the centre — PG window first, then GR / GD / BD / PR — so stretching the dst rect
   * is enough for the player to read where their hits land relative to the windows.
   *
   * Cached per-chart since the windows are derived from the parsed JSON's judge rank
   * and don't change mid-play (dynamic EXRANK changes happen but the timingvisualizer
   * background is regenerated per BMSModel-change in upstream too).
   *
   * Returns `undefined` when no chart is loaded — the renderer falls through to its
   * default IIDX-NORMAL windows so headless tests / unwired hosts still draw a usable
   * background.
   */
  resolveJudgeWindowsMs(): JudgeWindowsMs | undefined {
    if (this.chart === undefined) return undefined;
    if (this.cachedJudgeWindowsMs === undefined) {
      this.cachedJudgeWindowsMs = resolveJudgeWindowsMs(this.chart);
    }
    return this.cachedJudgeWindowsMs;
  }
  private cachedJudgeWindowsMs: JudgeWindowsMs | undefined;

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
   * Polyline-style codes (`110` / `113` / `115` — score history) are NOT surfaced through
   * this resolver because they don't fit the bar-scaling model. {@link resolveGraphPolyline}
   * handles the polyline path with `(progress, ratio)` samples instead.
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

  /**
   * Resolve a `graph[].type` code into a polyline of `(x, y)` samples in `[0, 1]²`. Skins
   * use this for score / gauge history graphs that paint as a curve over time, not as a
   * single bar. Beatoraja's reference theme convention:
   *
   *   - `110` (NUMBER_SCORE_GRAPH) → live exScore polyline. `x` = chart progress (0..1),
   *     `y` = exScore / maxExScore (0..1). Pulled from {@link scoreHistory}, populated
   *     in `applyJudgeCombo` so the curve refreshes on every judgement.
   *   - `113` (NUMBER_TARGET_GRAPH) / `115` (NUMBER_BEST_GRAPH) — DB-backed best /
   *     target curves. We don't have a per-chart score DB yet, so these return
   *     `undefined` (= the renderer hides the curve).
   *
   * Returning `undefined` for unknown / unsurfaced types keeps unsupported skins clean:
   * the renderer hides the polyline rather than painting a flat line.
   */
  resolveGraphPolyline(type: number): ReadonlyArray<{ x: number; y: number }> | undefined {
    switch (type) {
      case 110: {
        // Score history. Each sample has `progress ∈ [0, 1]` and `exScore` (raw integer).
        // Normalize to `y = exScore / maxExScore`. When the history is empty (chart hasn't
        // fired any judges yet) return undefined so the curve stays hidden until the first
        // hit lands.
        const history = this.scoreHistory;
        if (history.length === 0) return undefined;
        const summary = this.frame?.summary;
        const maxExScore = (summary?.total ?? 0) * 2;
        if (maxExScore <= 0) return undefined;
        return history.map((s) => ({
          x: Math.max(0, Math.min(1, s.progress)),
          y: Math.max(0, Math.min(1, s.exScore / maxExScore)),
        }));
      }
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
        // Truncate (not round) — beatoraja's `(int)(hispeed * 100)` cast is a floor for
        // positive values (hispeed is always ≥ 0 in our adapter). At 1.555 the integer part
        // would round to "1" if we used Math.round, but Java's `(int)` cast yields "1"
        // identically for the integer-portion display. Math.trunc keeps that semantics
        // consistent with the AFTERDOT slot below (audit 3.16).
        return Math.trunc(this.lastHiSpeed * 100);
      case BEATORAJA_NUM.HISPEED_AFTERDOT: {
        // Two-digit fractional part of hispeed × 100 — i.e. `(int)(hispeed * 100) % 100`.
        // For 1.50 → 50; for 2.00 → 0. Audit 3.16: previously we used `Math.round` here,
        // which mismatched beatoraja's `(int)` cast at hispeed values like 1.555:
        // round → 56, beatoraja → 55. Math.trunc matches the (int) cast exactly.
        return Math.trunc(this.lastHiSpeed * 100) % 100;
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
        return 0;

      // ─── Duration / green-number readouts (312, 313, 1312-1327) ────────────────────────
      // "Duration" (= white number) is the time in ms for a note to traverse the visible
      // playfield at the current BPM × hispeed × cover state. "Green" is BPM-normalised so
      // it stays constant across BPM changes — the player's "scroll speed setting".
      //
      // Beatoraja exposes 8 white + 8 green variants (1312-1327) so ModernChic's hispeed
      // panel can show "current / no-cover" × "current bpm / main / min / max bpm" combos.
      // We compute all 16 from the same `whiteDurationMs` / `greenDurationMs` helpers below.
      case BEATORAJA_NUM.DURATION:
      case BEATORAJA_NUM.DURATION_LANECOVER_ON:
        return whiteDurationMs(this.visibleRatio(true), this.lastHiSpeed, this.currentBpmForDuration());
      case BEATORAJA_NUM.DURATION_GREEN:
      case BEATORAJA_NUM.DURATION_GREEN_LANECOVER_ON:
        return greenDurationMs(this.visibleRatio(true), this.lastHiSpeed);
      case BEATORAJA_NUM.DURATION_LANECOVER_OFF:
        return whiteDurationMs(this.visibleRatio(false), this.lastHiSpeed, this.currentBpmForDuration());
      case BEATORAJA_NUM.DURATION_GREEN_LANECOVER_OFF:
        return greenDurationMs(this.visibleRatio(false), this.lastHiSpeed);
      case BEATORAJA_NUM.MAINBPM_DURATION_LANECOVER_ON:
        return whiteDurationMs(this.visibleRatio(true), this.lastHiSpeed, this.chart?.metadata.bpm ?? 0);
      case BEATORAJA_NUM.MAINBPM_DURATION_GREEN_LANECOVER_ON:
        return greenDurationMs(this.visibleRatio(true), this.lastHiSpeed);
      case BEATORAJA_NUM.MAINBPM_DURATION_LANECOVER_OFF:
        return whiteDurationMs(this.visibleRatio(false), this.lastHiSpeed, this.chart?.metadata.bpm ?? 0);
      case BEATORAJA_NUM.MAINBPM_DURATION_GREEN_LANECOVER_OFF:
        return greenDurationMs(this.visibleRatio(false), this.lastHiSpeed);
      case BEATORAJA_NUM.MINBPM_DURATION_LANECOVER_ON:
        return whiteDurationMs(this.visibleRatio(true), this.lastHiSpeed, this.cachedBpmRange().min);
      case BEATORAJA_NUM.MINBPM_DURATION_GREEN_LANECOVER_ON:
        return greenDurationMs(this.visibleRatio(true), this.lastHiSpeed);
      case BEATORAJA_NUM.MINBPM_DURATION_LANECOVER_OFF:
        return whiteDurationMs(this.visibleRatio(false), this.lastHiSpeed, this.cachedBpmRange().min);
      case BEATORAJA_NUM.MINBPM_DURATION_GREEN_LANECOVER_OFF:
        return greenDurationMs(this.visibleRatio(false), this.lastHiSpeed);
      case BEATORAJA_NUM.MAXBPM_DURATION_LANECOVER_ON:
        return whiteDurationMs(this.visibleRatio(true), this.lastHiSpeed, this.cachedBpmRange().max);
      case BEATORAJA_NUM.MAXBPM_DURATION_GREEN_LANECOVER_ON:
        return greenDurationMs(this.visibleRatio(true), this.lastHiSpeed);
      case BEATORAJA_NUM.MAXBPM_DURATION_LANECOVER_OFF:
        return whiteDurationMs(this.visibleRatio(false), this.lastHiSpeed, this.cachedBpmRange().max);
      case BEATORAJA_NUM.MAXBPM_DURATION_GREEN_LANECOVER_OFF:
        return greenDurationMs(this.visibleRatio(false), this.lastHiSpeed);

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
      // Ref 75 (`NUMBER_MAXCOMBO`) — despite the misleading "BEST_*" alias inherited from
      // the constant table, upstream's `IntegerPropertyFactory` returns
      // `JudgeManager.getScoreData().getCombo()` during play (= running max combo of the
      // CURRENT run, refreshed via `score.setCombo(Math.max(score.getCombo(), combo))`
      // every judge). Default `play5.json` declares `judgen-pg / -gr / -gd / -bd / -pr /
      // -ms` (judge-popup combo digits) with `ref:75`, so without this case the combo
      // stays at 0 throughout the play.
      case BEATORAJA_NUM.BEST_MAXCOMBO:
      case BEATORAJA_NUM.MAXCOMBO_LIVE:
        return this.maxCombo;
      case BEATORAJA_NUM.TOTALNOTES_LIVE:
        return summary?.total ?? 0;
      case BEATORAJA_NUM.GROOVEGAUGE:
        return Math.floor(gaugePct);
      case BEATORAJA_NUM.GROOVEGAUGE_AFTERDOT:
        return Math.floor((gaugePct - Math.floor(gaugePct)) * 100);
      // Signed millisecond offset of the most recent 1P hit (positive = early/fast,
      // negative = late/slow). Mirrors upstream `JudgeManager.getRecentJudgeTiming(0)`.
      // Skins use the `divy:2` digit-strip layout to render the sign — row 0 = positive,
      // row 1 = negative — so we just hand back the signed integer here.
      //
      // Returns 0 before the first hit lands (empty timing buffer). The fade-out of the
      // judge popup is driven by the JUDGE_1P timer's stamp (read elsewhere via
      // `getTimerStart`), not by this ref.
      case BEATORAJA_NUM.JUDGE_1P_OFFSET_MS: {
        const last = this.recentTimings[this.recentTimings.length - 1];
        if (last === undefined) return 0;
        return Math.trunc(last.deltaMs);
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
      // Per-judge fast / slow split — derived locally from `applyJudgeCombo`'s sample
      // stream (engine `summary` doesn't carry this granularity; only aggregate `fast` /
      // `slow` totals). Default `play5.json`'s judge-count panel renders these as the per-
      // verdict early / late breakdown ("PERFECT 12 EARLY 4 LATE 8" style), so without the
      // breakdown the panel reads as zero.
      case BEATORAJA_NUM.EARLY_PERFECT:
        return this.earlyLateCounts.PERFECT.early;
      case BEATORAJA_NUM.LATE_PERFECT:
        return this.earlyLateCounts.PERFECT.late;
      case BEATORAJA_NUM.EARLY_GREAT:
        return this.earlyLateCounts.GREAT.early;
      case BEATORAJA_NUM.LATE_GREAT:
        return this.earlyLateCounts.GREAT.late;
      case BEATORAJA_NUM.EARLY_GOOD:
        return this.earlyLateCounts.GOOD.early;
      case BEATORAJA_NUM.LATE_GOOD:
        return this.earlyLateCounts.GOOD.late;
      case BEATORAJA_NUM.EARLY_BAD:
        return this.earlyLateCounts.BAD.early;
      case BEATORAJA_NUM.LATE_BAD:
        return this.earlyLateCounts.BAD.late;
      case BEATORAJA_NUM.EARLY_POOR:
        return this.earlyLateCounts.POOR.early;
      case BEATORAJA_NUM.LATE_POOR:
        return this.earlyLateCounts.POOR.late;
      case BEATORAJA_NUM.EARLY_MISS:
        return this.earlyLateCounts.MISS.early;
      case BEATORAJA_NUM.LATE_MISS:
        return this.earlyLateCounts.MISS.late;
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
   * Set the hidden-cover state. `enabled = false` (default) drives `OFFSET_HIDDEN_COVER.a =
   * -255` to clamp the cover sprite invisible. `enabled = true` paints the cover and
   * shifts its y by `ratio × laneHeight` (with the `(1 - lift)` lift-active modifier
   * applied automatically via the shared `liftRatio`). `ratio` is clamped to `[0, 1]`.
   *
   * Mirrors `LaneRenderer.setHiddenCover` + the `OFFSET_HIDDEN_COVER` mutation block. Call
   * with `(0, false)` to mirror beatoraja's "hidden disabled" baseline; call with
   * `(0.5, true)` to expose 50% of the lane through the cover.
   */
  setHiddenCover(ratio: number, enabled: boolean = true): void {
    if (Number.isFinite(ratio)) {
      this.hiddenRatio = Math.max(0, Math.min(1, ratio));
    }
    this.hiddenEnabled = enabled === true;
    this.coverLastChangedAtMs = this.getNowMs();
  }

  /** Read-only handle on the hidden-cover ratio. */
  getHiddenCover(): number {
    return this.hiddenRatio;
  }

  /** Read-only handle on the hidden-cover enabled flag. */
  isHiddenCoverEnabled(): boolean {
    return this.hiddenEnabled;
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
    this.timerStartedAt.set(TIMER_PREVIEW, 0);
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
    this.fullComboStamped[1] = false;
    this.fullComboStamped[2] = false;
    this.pressedChannels.clear();
    this.lnHoldHeldByChannel.clear();
    for (const kind of Object.keys(this.earlyLateCounts) as Array<keyof typeof this.earlyLateCounts>) {
      this.earlyLateCounts[kind].early = 0;
      this.earlyLateCounts[kind].late = 0;
    }
    // Cancel any in-flight `flash-lane` auto-release timeouts so the next run's first
    // frames don't get a stale KEY_OFF stamp from the previous chart's tail flashes.
    for (const handle of this.flashReleaseHandles) clearTimeout(handle);
    this.flashReleaseHandles.clear();
    // Per-lane judge ring — clear both sides so the keybeam / bomb imageset revert to their
    // neutral frame after a re-mount. Without this, a re-mounted scene carries the prior
    // run's last-judge stamps until they age out, so the very first frame of the new run
    // could show a phantom highlight from the previous chart.
    for (let i = 0; i < JUDGE_LANE_REF_RANGE; i += 1) {
      this.lastJudgeOnLane[1][i] = { kind: -1, at: 0 };
      this.lastJudgeOnLane[2][i] = { kind: -1, at: 0 };
    }
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
 * Map a judge-string verdict to beatoraja's per-lane judge index. Returns `-1` for verdicts
 * that don't fit the standard 6-tier ladder (READY ticks, AUTO PLAY without input, etc.).
 *
 * Beatoraja's enum order is canon: PG=0, GR=1, GD=2, BD=3, PR=4, MS=5. The keybeam / bomb
 * imageset ref encoding in `resolveLaneJudgeRef` adds 1 so frame 0 stays reserved for the
 * "no judge" case — see {@link BeatorajaRuntimeAdapter.lastJudgeOnLane} for the full table.
 */
function judgeKindToIndex(kind: string): number {
  switch (kind.toUpperCase()) {
    case 'PERFECT':
      return 0;
    case 'GREAT':
      return 1;
    case 'GOOD':
      return 2;
    case 'BAD':
      return 3;
    case 'POOR':
      return 4;
    case 'MISS':
      return 5;
    default:
      return -1;
  }
}

/**
 * Map a judge-kind string onto the upstream `Note.getState()` index used by
 * `SkinNoteDistributionGraph` TYPE_JUDGE — `data[index][st]++` where `st ∈ [0, 5]`. Mirrors
 * `bms.model.Note.STATE_*` field values:
 *
 *   0 = NONE (unjudged)
 *   1 = PERFECT (PG)
 *   2 = GREAT (GR)
 *   3 = GOOD (GD)
 *   4 = BAD (BD)
 *   5 = POOR / MISS (PR)
 *
 * Returns 0 for unknown / unjudged kinds (READY publishes, etc.) so callers can use
 * `< 1` as the "no state change" gate.
 */
function judgeStateIndex(kind: string): number {
  switch (kind.toUpperCase()) {
    case 'PERFECT':
      return 1;
    case 'GREAT':
      return 2;
    case 'GOOD':
      return 3;
    case 'BAD':
      return 4;
    case 'POOR':
    case 'MISS':
      return 5;
    default:
      return 0;
  }
}

/**
 * Build a fresh per-lane judge-ring buffer. Each slot is initialised to `{ kind: -1, at: 0 }`
 * so the resolver's `kind < 0` short-circuit treats the lane as "no recent judgement" until a
 * real verdict lands. Allocated as a plain array (not a typed array) because each entry is a
 * 2-field record; `JUDGE_LANE_REF_RANGE = 10` slots × 2 sides = 20 records, negligible cost.
 */
function createEmptyLaneJudgeRing(): Array<{ kind: number; at: number }> {
  const out = new Array<{ kind: number; at: number }>(JUDGE_LANE_REF_RANGE);
  for (let i = 0; i < JUDGE_LANE_REF_RANGE; i += 1) {
    out[i] = { kind: -1, at: 0 };
  }
  return out;
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
 * "White" duration — milliseconds for a note to traverse the visible playfield at the given
 * BPM × hispeed × visible-ratio. Mirrors beatoraja's reference convention where white scales
 * INVERSELY with bpm (faster song = less time on screen) but the player can read the value
 * directly from the on-screen panel.
 *
 * Formula: `visibleRatio * 60000 / (hispeed * bpm) * 4` (= ms per 4-beat window). Returns 0
 * for degenerate inputs (zero / negative bpm or hispeed) so the value display stays at zero
 * rather than garbage. 4-beat window picked because IIDX-style charts measure scroll in
 * 4-beat units (= 1 measure of 4/4 time).
 */
function whiteDurationMs(visibleRatio: number, hispeed: number, bpm: number): number {
  if (hispeed <= 0 || bpm <= 0) return 0;
  return Math.round((visibleRatio * 60000 * 4) / (hispeed * bpm));
}

/**
 * "Green" duration — BPM-invariant equivalent of `whiteDurationMs`. Normalised to a constant
 * 130 BPM reference so the player's "scroll setting" reading stays the same regardless of the
 * chart's actual BPM. At BPM 130 the white and green numbers coincide; at higher BPMs green
 * stays put while white shrinks (reflects "same setting, but song scrolls visibly faster").
 */
function greenDurationMs(visibleRatio: number, hispeed: number): number {
  if (hispeed <= 0) return 0;
  return Math.round((visibleRatio * 60000 * 4) / (hispeed * 130));
}

/**
 * Resolve a per-side judge-combo metric `{width, space}` from the host-supplied options.
 * Defaults match the default skin's `play5.json` / `play7main.lua` (`numbers[i].dst.w = 40`,
 * value space = 0).
 */
function resolveJudgeComboMetric(
  preferred: { width?: number; space?: number } | undefined,
): { width: number; space: number } {
  const width =
    typeof preferred?.width === 'number' && Number.isFinite(preferred.width) && preferred.width > 0
      ? preferred.width
      : 40;
  const space =
    typeof preferred?.space === 'number' && Number.isFinite(preferred.space) ? preferred.space : 0;
  return { width, space };
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

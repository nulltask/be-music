// Bridges the engine's UI signals to a `BeatorajaRenderContext` for `BeatorajaPlaySkinView.update()`.
//
// What each beatoraja id reads — the ops a play lights, the numbers and texts, the timers a judgment or a lane action
// starts and stops, the gauge, the graphs and the live offsets — is resolved by `@be-music/beatoraja-skin/scene` from
// plain state. The adapter only keeps that state between engine signals and applies what the resolvers return:
//
//   - `activeOps: Set<number>` — the skin config's option ops and the runtime ops lit now; skin elements gated on
//     `if[]` / `op[]` consult it.
//   - `timerStartedAt: Map<number, number>` — `(timerId → scene-relative ms)`; the keyframe sampler reads it.
//   - the play state the number resolver reads (`play`): the latest engine frame, the combo, the early / late counts,
//     the hi-speed and the lane covers, the chart's facts and the clock.
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
//
// The scene sessions of P4 keep this state as a scene-model `PlayState` and call the same resolvers; this class then
// goes away.

import type { SceneCourseInfo } from '../../scene/course-info.ts';
import type { BeMusicJson } from '@be-music/json';
import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { resolveSideKeySlot } from '@be-music/player/core/lane-layout';
import type { JudgeWindowsMs } from '@be-music/player/core/judge-window';
import { resolveJudgeWindowsMs } from '@be-music/player/core/judge-window';
import type { PlayerJudgeComboSignalState } from '@be-music/player/state-signals';
import type { PlayerUiCommand, PlayerUiFramePayload } from '@be-music/player/core/ui-signal-bus';
import type { BeatorajaRenderContext } from './render.ts';
import { extractChartSubartist } from '../../chart/beatoraja/meta.ts';
import { computeBeatorajaNoteBreakdown } from '../../chart/beatoraja/note-counts.ts';
import { computeBeatorajaChartNoteDistribution } from '../../chart/beatoraja/note-distribution.ts';
import {
  beatorajaPlayChartFacts,
  beatorajaPlayChartTraits,
  computeBeatorajaLastNoteBeats,
} from '../../chart/beatoraja/play-facts.ts';
import {
  BEATORAJA_OP,
  beatorajaGaugeModeFromString,
  JUDGE_LANE_REF_RANGE,
  TIMER_FADEOUT,
  TIMER_FAILED,
  TIMER_PLAY,
  TIMER_PREVIEW,
  TIMER_READY,
  TIMER_SCENE_START,
  TIMER_STARTINPUT,
  type BeatorajaSide,
  type BeatorajaSkinOffsetValue,
} from '@be-music/beatoraja-skin';
import {
  BEATORAJA_COVER_OPS,
  BEATORAJA_PLAY_STARTED_OPS,
  beatorajaGaugePercent,
  beatorajaLaneJudgeImage,
  beatorajaLaneJudgeRef,
  beatorajaWallClockOf,
  createBeatorajaJudgeStateGraph,
  resolveBeatorajaCoverOps,
  resolveBeatorajaFrameTimers,
  resolveBeatorajaGaugeState,
  resolveBeatorajaJudgeEffect,
  resolveBeatorajaJudgeStateMove,
  resolveBeatorajaLanePlacement,
  resolveBeatorajaLaneTimers,
  resolveBeatorajaPlayGraphValue,
  resolveBeatorajaPlayJudgeGraph,
  resolveBeatorajaPlayNumber,
  resolveBeatorajaPlayScoreOps,
  resolveBeatorajaPlaySliderValue,
  resolveBeatorajaPlayStartOps,
  resolveBeatorajaPlayText,
  resolveBeatorajaScorePolyline,
  writeBeatorajaPlayOffset,
  type BeatorajaChartTraits,
  type BeatorajaComboDigitMetric,
  type BeatorajaGaugeInput,
  type BeatorajaLaneAction,
  type BeatorajaLanePlacement,
  type BeatorajaPlayChartFacts,
  type BeatorajaPlayNumberInput,
  type BeatorajaPlayOffsetInput,
  type BeatorajaPlayTextInput,
  type BeatorajaScoreInput,
  type BeatorajaTimerChanges,
} from '@be-music/beatoraja-skin/scene';
import type { LaneCoverState } from '@be-music/scene-model';

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
  /** Optional mounted skin's display name (`BEATORAJA_TEXT.SKIN_NAME = 50`). */
  skinHeaderName?: string;
  /** Optional skin author name (`BEATORAJA_TEXT.SKIN_AUTHOR = 51`). */
  skinHeaderAuthor?: string;
  /** Optional song directory label (`BEATORAJA_TEXT.DIRECTORY = 1000`). */
  directoryLabel?: string;
  /**
   * The running course, when the play is one of its stages: its stage titles surface on `STRING_COURSE1_TITLE` …
   * `STRING_COURSE10_TITLE` (150-159).
   */
  courseInfo?: SceneCourseInfo;
  /**
   * Per-skin lane height in skin-pixel units: the LIFT and HIDDEN+ offsets move across it. Hosts read it from the
   * skin's `lanecover` / `lift` slider `range`; {@link DEFAULT_LANE_HEIGHT} (the reference theme's 580) without one.
   */
  laneHeight?: number;
  /**
   * Per-side combo-digit metrics from the skin's `judge[].numbers[0]` value: the judge word of a `judge[]` with
   * `shift` moves left by half the combo's width (`SkinJudge.java:108-109`). Defaults to the default skin's
   * `width = 40, space = 0`.
   */
  judgeComboMetrics?: { 1?: { width?: number; space?: number }; 2?: { width?: number; space?: number } };
}

/** A judge plate's latest judgment and FAST / SLOW ops, which the next judgment on the plate replaces. */
interface PlateOps {
  lastJudgeOp: number | undefined;
  lastFastSlowOp: number | undefined;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The play state the resolvers read, kept in one object the adapter updates in place. */
type PlayInput = Mutable<
  Omit<BeatorajaPlayNumberInput & BeatorajaPlayOffsetInput, 'cover' | 'plateCombos' | 'earlyLate'>
> & {
  cover: Mutable<LaneCoverState>;
  plateCombos: [number, number, number];
  earlyLate: Record<'PERFECT' | 'GREAT' | 'GOOD' | 'BAD' | 'POOR' | 'MISS', { early: number; late: number }>;
};

/** Default lane height in skin pixels: `play7main.lua`'s `lanecover` slider `range`. */
const DEFAULT_LANE_HEIGHT = 580;

/** How long `LANECOVER1_CHANGING` (270) stays lit after the player moves a cover; skins fade a percentage popup on it. */
const COVER_CHANGING_WINDOW_MS = 500;

/** Timed judgments kept for the timing visualizer's tail and the judge graph's histogram (`SkinTimingVisualizer`). */
const RECENT_TIMINGS_CAPACITY = 50;

/**
 * How long an autoplay `flash-lane` keeps the key beam on before its release, as the LR2 path's
 * `KEY_ON_FLASH_HOLD_MS`; skipped when the lane is pressed or held meanwhile.
 */
const FLASH_LANE_HOLD_MS = 60;

/**
 * How long the long-note hold timer, restarted on the tail's judgment for the hold bomb (ModernChic's `lnbomb` keys on
 * `HOLD_*P_KEY*`), stays on. beatoraja switches it off the frame after the tail (`JudgeManager.java:546-547`); skins
 * that omit `loop` would otherwise animate the bomb forever. 320 ms covers the surveyed bomb cycles (ModernChic 160,
 * GdbG up to ~200).
 */
const LN_TAIL_BOMB_HOLD_MS = 320;

const NO_EARLY_LATE = (): PlayInput['earlyLate'] => ({
  PERFECT: { early: 0, late: 0 },
  GREAT: { early: 0, late: 0 },
  GOOD: { early: 0, late: 0 },
  BAD: { early: 0, late: 0 },
  POOR: { early: 0, late: 0 },
  MISS: { early: 0, late: 0 },
});

function createEmptyLaneJudgeRing(): Array<{ kind: number; at: number }> {
  return Array.from({ length: JUDGE_LANE_REF_RANGE }, () => ({ kind: -1, at: 0 }));
}

function resolveJudgeComboMetric(preferred: { width?: number; space?: number } | undefined): BeatorajaComboDigitMetric {
  const width =
    typeof preferred?.width === 'number' && Number.isFinite(preferred.width) && preferred.width > 0
      ? preferred.width
      : 40;
  const space = typeof preferred?.space === 'number' && Number.isFinite(preferred.space) ? preferred.space : 0;
  return { width, space };
}

export class BeatorajaRuntimeAdapter {
  /**
   * Live op set — option ops (from `baseOps`) plus runtime ops. The same `Set` instance is handed to the skin view
   * every frame.
   */
  private readonly activeOps: Set<number>;
  private baseOps: ReadonlySet<number>;
  private readonly timerStartedAt = new Map<number, number>();
  /** Timers that start once per play (failure, end of notes, full combo, full gauge) and already did. */
  private readonly firedOnce = new Set<number>();
  private readonly renderContext: BeatorajaRenderContext;
  private readonly chartPlayVariant: ChartPlayVariant;
  private readonly getNowMs: () => number;
  private readonly chart: BeMusicJson | undefined;
  private readonly startTraits: BeatorajaChartTraits | undefined;
  private readonly texts: BeatorajaPlayTextInput;
  private readonly play: PlayInput;
  private frame: PlayerUiFramePayload | null = null;
  /** The ops the running score lit on the last frame ({@link resolveBeatorajaPlayScoreOps}). */
  private scoreOps: readonly number[] = [];
  /** Per judge plate (1P, 2P, POPN 9 KEY's third). */
  private readonly plates: Record<BeatorajaSide, PlateOps> = {
    1: { lastJudgeOp: undefined, lastFastSlowOp: undefined },
    2: { lastJudgeOp: undefined, lastFastSlowOp: undefined },
    3: { lastJudgeOp: undefined, lastFastSlowOp: undefined },
  };
  /** Per side and lane, the latest judgment's place in beatoraja's order and when it came (refs 500-519). */
  private readonly lastJudgeOnLane: Record<BeatorajaSide, Array<{ kind: number; at: number }>> = {
    1: createEmptyLaneJudgeRing(),
    2: createEmptyLaneJudgeRing(),
    3: createEmptyLaneJudgeRing(),
  };
  private readonly placements = new Map<string, BeatorajaLanePlacement>();
  private poorBgaActive = false;
  /** Lanes whose long note the player holds now: the note layer draws the held body sprite. */
  private readonly lnHoldHeldByChannel = new Set<string>();
  /**
   * Lanes in a long note whose tail's judgment is still to come. `release-lane` arrives before the tail's judgment, so
   * the hold flag above is already gone; this one restarts the hold timer for the tail's bomb.
   */
  private readonly lnTailVerdictLatch = new Set<string>();
  /** Lanes the player presses now, which a `flash-lane` release leaves alone. */
  private readonly pressedChannels = new Set<string>();
  private readonly flashReleaseHandles = new Set<ReturnType<typeof setTimeout>>();
  private readonly lnTailBombReleaseHandles = new Set<ReturnType<typeof setTimeout>>();
  /** When the player last moved a cover (`getNowMs` ms): `LANECOVER1_CHANGING` stays lit for a moment after. */
  private coverLastChangedAtMs: number | undefined;
  /** Offsets the host set by id (sliders); a live offset the play sets wins over them. */
  private readonly offsets = new Map<number, BeatorajaSkinOffsetValue>();
  /** One object per live offset id, refilled on every read: the renderer reads it at once and does not keep it. */
  private readonly liveOffsets = new Map<number, BeatorajaSkinOffsetValue>();
  private scoreHistory: Array<{ progress: number; exScore: number }> = [];
  private gaugeHistory: Array<{ progress: number; value: number }> = [];
  /** The latest timed judgments, oldest first ({@link RECENT_TIMINGS_CAPACITY}). */
  private readonly recentTimings: Array<{ deltaMs: number; kind: string }> = [];
  /** Every timed judgment of the play, for the result's timing distribution. */
  private readonly allTimings: Array<{ deltaMs: number; kind: string }> = [];
  /** The judge-state graph (`judgegraph[]` type 1), updated in place as notes are judged. */
  private judgeState: { buckets: number[][]; maxCount: number; totalMs: number } | undefined;
  private readonly bootMs = Date.now();
  /** Recent frame times (`getNowMs`), averaged into the frame rate readout. */
  private readonly fpsRingMs = new Float64Array(120);
  private fpsRingHead = 0;
  private fpsRingFilled = 0;
  /** The beat and gauge of the frame before, for the beat and failure timers. */
  private lastFrameBeat: number | undefined;
  private lastFrameGauge: number | undefined;
  private readonly lastNoteBeats: { 1?: number; 2?: number };
  private cachedNoteBreakdown: ReturnType<typeof computeBeatorajaNoteBreakdown> | undefined;
  private cachedJudgeWindowsMs: JudgeWindowsMs | undefined;
  /** Refs the resolvers do not cover, logged once per session each. */
  private readonly unresolvedNumberRefs = new Set<number>();
  private readonly unresolvedTextRefs = new Set<number>();

  constructor(options: BeatorajaRuntimeAdapterOptions) {
    this.chartPlayVariant = options.chartPlayVariant;
    this.baseOps = options.baseOps;
    this.activeOps = new Set(options.baseOps);
    this.renderContext = {
      activeOps: this.activeOps,
      getTimerStart: (id) => this.timerStartedAt.get(id),
      nowMs: 0,
      resolveOffset: (id) => this.resolveOffset(id),
      resolveGaugeState: () => this.resolveGaugeState(),
    };
    this.getNowMs = options.getNowMs;
    const chart = options.chart;
    this.chart = chart;
    this.startTraits = chart !== undefined ? beatorajaPlayChartTraits(chart) : undefined;
    this.lastNoteBeats = chart !== undefined ? computeBeatorajaLastNoteBeats(chart) : {};
    this.texts = {
      ...(chart !== undefined
        ? {
            song: {
              title: chart.metadata.title,
              subtitle: chart.metadata.subtitle,
              genre: chart.metadata.genre,
              artist: chart.metadata.artist,
              subartist: extractChartSubartist(chart),
              directory: options.directoryLabel,
            },
          }
        : {}),
      skin: { name: options.skinHeaderName, author: options.skinHeaderAuthor },
      ...(options.courseInfo !== undefined ? { course: options.courseInfo } : {}),
    };
    const laneHeight =
      typeof options.laneHeight === 'number' && Number.isFinite(options.laneHeight) && options.laneHeight > 0
        ? options.laneHeight
        : DEFAULT_LANE_HEIGHT;
    this.play = {
      combo: 0,
      maxCombo: 0,
      earlyLate: NO_EARLY_LATE(),
      ...(chart?.metadata.total !== undefined ? { chartTotal: chart.metadata.total } : {}),
      // The host sets the hi-speed every frame; `DEFAULT_PLAY_OPTIONS.hiSpeed` until it does.
      hiSpeed: 2.0,
      cover: { side: '1P', sudden: 0, suddenOn: false, hidden: 0, hiddenOn: false, lift: 0 },
      chart: this.initJudgeState(),
      plateCombos: [0, 0, 0],
      laneHeight,
      comboDigits: {
        1: resolveJudgeComboMetric(options.judgeComboMetrics?.[1]),
        2: resolveJudgeComboMetric(options.judgeComboMetrics?.[2]),
      },
    };
    this.refreshClock();
    this.addStartOps(options.autoPlay === true);
    // The scene-start timer runs from the start: many elements default to `timer = 0`. The preview timer
    // (ModernChic's lane reveal) has no separate "loaded, not playing" phase here, so it starts with the scene.
    this.timerStartedAt.set(TIMER_SCENE_START, 0);
    this.timerStartedAt.set(TIMER_PREVIEW, 0);
  }

  /** The ops a play starts with: autoplay, loading, the groove gauge, the key mode and the chart's traits. */
  private addStartOps(autoPlay: boolean): void {
    const startOps = resolveBeatorajaPlayStartOps({
      playVariant: this.chartPlayVariant,
      autoPlay,
      ...(this.startTraits !== undefined ? { traits: this.startTraits } : {}),
    });
    for (const op of startOps) this.activeOps.add(op);
  }

  /** Builds the judge-state graph and returns the chart facts, from one walk of the chart's notes. */
  private initJudgeState(): BeatorajaPlayChartFacts {
    const chart = this.chart;
    if (chart === undefined) {
      this.judgeState = undefined;
      return beatorajaPlayChartFacts(undefined, undefined);
    }
    const distribution = computeBeatorajaChartNoteDistribution(chart);
    const graph = createBeatorajaJudgeStateGraph(distribution);
    this.judgeState = graph && { ...graph, buckets: graph.buckets.map((bucket) => [...bucket]) };
    return beatorajaPlayChartFacts(chart, distribution);
  }

  /** Stamp a built-in / per-event timer at the current `getNowMs()`. Re-marks override. */
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

  /** Stamp the `play` timer (prop.lua `play = 41`) and swap `NOW_LOADING` for `LOADED`, when the engine starts. */
  markPlay(): void {
    this.markTimer(TIMER_PLAY);
    this.activeOps.delete(BEATORAJA_PLAY_STARTED_OPS.off);
    this.activeOps.add(BEATORAJA_PLAY_STARTED_OPS.on);
  }

  /** Stamp the `fadeout` timer (prop.lua `fadeout = 2`). Fires at chart end / interrupt. */
  markFadeout(): void {
    this.markTimer(TIMER_FADEOUT);
  }

  /**
   * Stamp `TIMER_FAILED` (prop.lua `failed = 3`) for an end-of-chart fail, from the engine's `onComplete`. Once per
   * play: a survival gauge that already failed mid-play keeps that stamp, so the fail animation is not restarted.
   */
  markFailed(): void {
    this.startOnce(TIMER_FAILED);
  }

  private startOnce(timerId: number): void {
    if (this.firedOnce.has(timerId)) return;
    this.firedOnce.add(timerId);
    this.markTimer(timerId);
  }

  /** Start and stop the timers a change of the play asks for. */
  private applyTimers(changes: BeatorajaTimerChanges): void {
    for (const id of changes.start) this.markTimer(id);
    for (const id of changes.startOnce) this.startOnce(id);
    for (const id of changes.stop) this.timerStartedAt.delete(id);
  }

  /** Latch the current engine frame: the score, gauge and clock the resolvers read, the score ops and frame timers. */
  applyFrame(frame: PlayerUiFramePayload): void {
    this.frame = frame;
    this.play.score = frame.summary;
    this.play.gauge = frame.summary.gauge;
    this.play.clock = frame;
    // The frame-rate readout averages the scene clock over recent frames, so a throttled ticker reads as throttled.
    this.fpsRingMs[this.fpsRingHead] = this.getNowMs();
    this.fpsRingHead = (this.fpsRingHead + 1) % this.fpsRingMs.length;
    if (this.fpsRingFilled < this.fpsRingMs.length) this.fpsRingFilled += 1;
    this.syncScoreOps(frame.summary, frame.summary.gauge);
    this.applyTimers(
      resolveBeatorajaFrameTimers({
        beat: frame.currentBeat,
        ...(this.lastFrameBeat !== undefined ? { previousBeat: this.lastFrameBeat } : {}),
        ...(frame.summary.gauge !== undefined ? { gauge: frame.summary.gauge } : {}),
        ...(this.lastFrameGauge !== undefined ? { previousGauge: this.lastFrameGauge } : {}),
        lastNoteBeats: this.lastNoteBeats,
      }),
    );
    if (Number.isFinite(frame.currentBeat)) this.lastFrameBeat = frame.currentBeat;
    this.lastFrameGauge = frame.summary.gauge?.current;
  }

  /**
   * Swap the score ops of the last frame for this frame's. `P1_BAND_BORDER_OR_MORE` stays lit for the rest of the
   * play once lit.
   */
  private syncScoreOps(score: BeatorajaScoreInput, gauge: BeatorajaGaugeInput | undefined): void {
    const next = resolveBeatorajaPlayScoreOps(score, gauge);
    for (const op of this.scoreOps) {
      if (op !== BEATORAJA_OP.P1_BAND_BORDER_OR_MORE && !next.includes(op)) this.activeOps.delete(op);
    }
    for (const op of next) this.activeOps.add(op);
    this.scoreOps = next;
  }

  private placementOf(channel: string): BeatorajaLanePlacement {
    let placement = this.placements.get(channel);
    if (placement === undefined) {
      const slot = resolveSideKeySlot(channel, this.chartPlayVariant);
      placement = resolveBeatorajaLanePlacement(channel, this.chartPlayVariant, slot);
      this.placements.set(channel, placement);
    }
    return placement;
  }

  private applyLaneAction(action: BeatorajaLaneAction, channel: string): void {
    this.applyTimers(resolveBeatorajaLaneTimers(action, this.placementOf(channel)));
  }

  /** Fold one engine UI command into the lane timers and state. Unknown kinds are ignored. */
  applyCommand(command: PlayerUiCommand): void {
    switch (command.kind) {
      case 'press-lane':
        this.pressedChannels.add(command.channel);
        this.applyLaneAction('press', command.channel);
        break;
      case 'release-lane':
        // Ends a long note held on the lane too: its hold timer goes off and its body sprite back to the unheld one.
        this.pressedChannels.delete(command.channel);
        this.applyLaneAction('release', command.channel);
        this.lnHoldHeldByChannel.delete(command.channel);
        break;
      case 'flash-lane': {
        // Every press the engine saw, AUTO PLAY's included: the key beam flashes, then comes off on its own, unless a
        // real press or a long note took the lane meanwhile (AUTO PLAY sends no release).
        const channel = command.channel;
        this.applyLaneAction('flash', channel);
        const handle = setTimeout(() => {
          this.flashReleaseHandles.delete(handle);
          if (this.pressedChannels.has(channel) || this.lnHoldHeldByChannel.has(channel)) return;
          this.applyLaneAction('flash-end', channel);
        }, FLASH_LANE_HOLD_MS);
        this.flashReleaseHandles.add(handle);
        break;
      }
      case 'hold-lane-until-beat':
        this.applyLaneAction('hold', command.channel);
        this.lnHoldHeldByChannel.add(command.channel);
        this.lnTailVerdictLatch.add(command.channel);
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
   * Fold one engine judgment into the plate's judgment and FAST / SLOW ops, the timers it starts
   * ({@link resolveBeatorajaJudgeEffect}), the lane's latest judgment, the combo, the timings and early / late counts,
   * the judge-state graph and the graphs' samples.
   */
  applyJudgeCombo(state: PlayerJudgeComboSignalState): void {
    const channel = state.channel;
    const placement = channel !== undefined ? this.placementOf(channel) : undefined;
    const effect = resolveBeatorajaJudgeEffect(state, placement, this.frame?.summary.total ?? 0);
    const plate = placement?.plate ?? 1;
    const plateOps = this.plates[plate];
    if (plateOps.lastJudgeOp !== undefined && plateOps.lastJudgeOp !== effect.judgeOp) {
      this.activeOps.delete(plateOps.lastJudgeOp);
    }
    if (effect.judgeOp !== undefined) {
      this.activeOps.add(effect.judgeOp);
      plateOps.lastJudgeOp = effect.judgeOp;
    }
    // The judge popup's combo: the live combo at the plate's latest judgment (0 after a break), not the max.
    this.play.plateCombos[plate - 1] = state.combo;
    if (effect.timing !== undefined) {
      const fastSlowOp = effect.timing.fastSlowOp;
      if (plateOps.lastFastSlowOp !== undefined && plateOps.lastFastSlowOp !== fastSlowOp) {
        this.activeOps.delete(plateOps.lastFastSlowOp);
      }
      if (fastSlowOp !== undefined) this.activeOps.add(fastSlowOp);
      plateOps.lastFastSlowOp = fastSlowOp;
    }
    this.applyTimers(effect.timers);
    if (channel !== undefined && this.lnTailVerdictLatch.has(channel)) {
      // A long note's tail: the hold bomb plays again, then its timer goes off as beatoraja's does.
      this.lnTailVerdictLatch.delete(channel);
      this.applyLaneAction('hold', channel);
      const handle = setTimeout(() => {
        this.lnTailBombReleaseHandles.delete(handle);
        this.applyLaneAction('hold-end', channel);
      }, LN_TAIL_BOMB_HOLD_MS);
      this.lnTailBombReleaseHandles.add(handle);
    }
    const lane = placement?.lane;
    if (
      placement !== undefined &&
      lane !== undefined &&
      lane < JUDGE_LANE_REF_RANGE &&
      effect.laneJudge !== undefined
    ) {
      this.lastJudgeOnLane[placement.side][lane] = { kind: effect.laneJudge, at: this.getNowMs() };
    }
    this.play.combo = state.combo;
    if (state.combo > this.play.maxCombo) this.play.maxCombo = state.combo;
    if (typeof state.deltaMs === 'number' && Number.isFinite(state.deltaMs)) {
      const sample = { deltaMs: state.deltaMs, kind: state.judge };
      this.recentTimings.push(sample);
      if (this.recentTimings.length > RECENT_TIMINGS_CAPACITY) this.recentTimings.shift();
      this.allTimings.push(sample);
      this.play.lastJudgeDeltaMs = state.deltaMs;
      const count = this.play.earlyLate[state.judge as keyof PlayInput['earlyLate']];
      if (count !== undefined) {
        if (state.deltaMs < 0) count.early += 1;
        else if (state.deltaMs > 0) count.late += 1;
      }
    }
    if (this.judgeState !== undefined) {
      // The note's chart time: the frame's time less the judgment's offset (beatoraja reads each note's state).
      const noteMs = (this.frame?.currentSeconds ?? 0) * 1000 - (state.deltaMs ?? 0);
      const move = resolveBeatorajaJudgeStateMove(this.judgeState, state.judge, noteMs);
      if (move !== undefined) {
        const bucket = this.judgeState.buckets[move.bucket]!;
        bucket[0] = bucket[0]! - 1;
        bucket[move.slot] = bucket[move.slot]! + 1;
      }
    }
    // One graph sample per judgment, so the graphs are dense where the chart is.
    const frame = this.frame;
    if (frame !== null) {
      const progress = frame.totalSeconds > 0 ? Math.max(0, Math.min(1, frame.currentSeconds / frame.totalSeconds)) : 0;
      this.scoreHistory.push({ progress, exScore: frame.summary.exScore });
      this.gaugeHistory.push({ progress, value: beatorajaGaugePercent(frame.summary.gauge) });
    }
  }

  /** Copies of the graphs and timings of the play, for the result scene. */
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
   * The context the skin view reads every frame: the same object and op set each time, with the cover ops, the clock
   * and `nowMs` brought up to date.
   */
  getRenderContext(): BeatorajaRenderContext {
    const changing =
      this.coverLastChangedAtMs !== undefined && this.getNowMs() - this.coverLastChangedAtMs < COVER_CHANGING_WINDOW_MS;
    const coverOps = resolveBeatorajaCoverOps(this.play.cover, changing);
    for (const op of BEATORAJA_COVER_OPS) {
      if (coverOps.includes(op)) this.activeOps.add(op);
      else this.activeOps.delete(op);
    }
    this.refreshClock();
    this.renderContext.nowMs = this.getNowMs();
    return this.renderContext;
  }

  /** The wall clock, the time running and the frame rate the clock readouts show. */
  private refreshClock(): void {
    const now = new Date();
    this.play.wallClock = beatorajaWallClockOf(now);
    this.play.operatingMs = now.getTime() - this.bootMs;
    this.play.fps = this.currentFps();
  }

  /** Frames per second over the frames in the ring (N stamps bracket N - 1 intervals); 0 with fewer than two. */
  private currentFps(): number {
    if (this.fpsRingFilled < 2) return 0;
    const length = this.fpsRingMs.length;
    const newest = this.fpsRingMs[(this.fpsRingHead - 1 + length) % length]!;
    const oldest = this.fpsRingMs[(this.fpsRingHead - this.fpsRingFilled + length) % length]!;
    const spanSec = (newest - oldest) / 1000;
    return spanSec > 0 ? Math.round((this.fpsRingFilled - 1) / spanSec) : 0;
  }

  /**
   * The shift of a `SkinProperty.OFFSET_*` id: the play's live value for the LIFT, HIDDEN+ and the judge word shift
   * ({@link writeBeatorajaPlayOffset}), else what the host set with {@link setOffset} (`undefined` reads as no shift).
   */
  resolveOffset(offsetId: number): Readonly<BeatorajaSkinOffsetValue> | undefined {
    let live = this.liveOffsets.get(offsetId);
    if (live === undefined) {
      live = { x: 0, y: 0, w: 0, h: 0, r: 0, a: 0 };
      this.liveOffsets.set(offsetId, live);
    }
    return writeBeatorajaPlayOffset(offsetId, this.play, live) ? live : this.offsets.get(offsetId);
  }

  /**
   * Set an offset by id (a host slider). A partial value keeps the fields it leaves out at their last value; alpha
   * defaults to 0, no change.
   */
  setOffset(offsetId: number, value: Readonly<Partial<BeatorajaSkinOffsetValue>>): void {
    const previous = this.offsets.get(offsetId);
    this.offsets.set(offsetId, {
      x: value.x ?? previous?.x ?? 0,
      y: value.y ?? previous?.y ?? 0,
      w: value.w ?? previous?.w ?? 0,
      h: value.h ?? previous?.h ?? 0,
      r: value.r ?? previous?.r ?? 0,
      a: value.a ?? previous?.a ?? 0,
    });
  }

  /**
   * A `text[].ref` string: the course stage titles, the chart's song texts and the skin's own
   * ({@link resolveBeatorajaPlayText}). Without a chart every text renders empty.
   */
  resolveTextContent(refOp: number): string | undefined {
    if (this.chart === undefined) return undefined;
    const value = resolveBeatorajaPlayText(refOp, this.texts);
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

  /**
   * An `image[].ref` / `imageset[].ref` frame: the key beam and bomb images of each lane's latest judgment (refs
   * 500-519, {@link beatorajaLaneJudgeImage}); 0 for any other ref.
   */
  resolveRefValue(refOp: number): number {
    const ref = beatorajaLaneJudgeRef(refOp);
    if (ref === undefined) return 0;
    const slot = this.lastJudgeOnLane[ref.side][ref.lane];
    return slot !== undefined ? beatorajaLaneJudgeImage(slot.kind, this.getNowMs() - slot.at) : 0;
  }

  /**
   * A `value[].ref` number ({@link resolveBeatorajaPlayNumber}); `undefined` (drawn as 0) for a ref it does not cover,
   * logged once.
   */
  resolveNumberValue(refOp: number): number | undefined {
    const value = resolveBeatorajaPlayNumber(refOp, this.play);
    if (value === undefined && !this.unresolvedNumberRefs.has(refOp)) {
      this.unresolvedNumberRefs.add(refOp);
      // eslint-disable-next-line no-console
      console.log('[beatoraja-adapter] resolveNumberValue: ref not wired (returns 0)', JSON.stringify({ ref: refOp }));
    }
    return value;
  }

  /** The gauge in percent of its maximum; 0 before the first frame. */
  resolveGaugePercent(): number {
    return beatorajaGaugePercent(this.frame?.summary.gauge);
  }

  /** The gauge as the gauge element draws it ({@link resolveBeatorajaGaugeState}); `undefined` before the first frame. */
  resolveGaugeState(): { value: number; max: number; border: number; mode: number } | undefined {
    return resolveBeatorajaGaugeState(this.frame?.summary.gauge);
  }

  /** The gauge's mode (`BEATORAJA_GAUGE_MODE`); NORMAL before the first frame. */
  resolveGaugeType(): number {
    return beatorajaGaugeModeFromString(this.frame?.summary.gauge?.type);
  }

  /** Whether the player holds a long note on the lane now: the note layer draws the held body sprite. */
  isLaneLnHeld(channel: string): boolean {
    return this.lnHoldHeldByChannel.has(channel);
  }

  /** A `slider[].type` position ({@link resolveBeatorajaPlaySliderValue}): the lane cover and the song's progress. */
  resolveSliderValue(type: number): number | undefined {
    return resolveBeatorajaPlaySliderValue(type, this.play);
  }

  /** A `judgegraph[].type` bar list ({@link resolveBeatorajaPlayJudgeGraph}). */
  resolveJudgeGraphBars(type: number): ReadonlyArray<number> | undefined {
    return resolveBeatorajaPlayJudgeGraph(type, {
      ...(type === 0 && this.chart !== undefined ? { breakdown: this.noteBreakdown(this.chart) } : {}),
      ...(this.play.score !== undefined ? { score: this.play.score } : {}),
      recentTimings: this.recentTimings,
    });
  }

  private noteBreakdown(chart: BeMusicJson): ReturnType<typeof computeBeatorajaNoteBreakdown> {
    this.cachedNoteBreakdown ??= computeBeatorajaNoteBreakdown(chart);
    return this.cachedNoteBreakdown;
  }

  /** The latest timed judgments, oldest first (signed offsets, > 0 late), for the timing visualizer. */
  resolveTimingSamples(): ReadonlyArray<{ deltaMs: number; kind: string }> {
    return this.recentTimings;
  }

  /** The judge-state graph (`judgegraph[]` type 1); `undefined` for another type or without a chart. */
  resolveJudgeStateBuckets(
    type: number,
  ): { buckets: ReadonlyArray<ReadonlyArray<number>>; maxCount: number; totalMs: number } | undefined {
    return type === 1 ? this.judgeState : undefined;
  }

  /** The chart's judge windows in ms, for the timing visualizer's bands; `undefined` without a chart. */
  resolveJudgeWindowsMs(): JudgeWindowsMs | undefined {
    if (this.chart === undefined) return undefined;
    this.cachedJudgeWindowsMs ??= resolveJudgeWindowsMs(this.chart);
    return this.cachedJudgeWindowsMs;
  }

  /** A `graph[].type` fill ratio ({@link resolveBeatorajaPlayGraphValue}): the gauge, the song's progress, loading. */
  resolveGraphValue(type: number): number | undefined {
    return resolveBeatorajaPlayGraphValue(type, this.play);
  }

  /** A line graph's points: the EX score over the chart so far (110); `undefined` for another type. */
  resolveGraphPolyline(type: number): ReadonlyArray<{ x: number; y: number }> | undefined {
    return type === 110 ? resolveBeatorajaScorePolyline(this.scoreHistory, this.frame?.summary.total ?? 0) : undefined;
  }

  /** Latch the hi-speed the notes scroll at; the host sets it every frame. Ignores a value that is not positive. */
  setHiSpeed(value: number): void {
    if (Number.isFinite(value) && value > 0) this.play.hiSpeed = value;
  }

  /** Set the lane cover (SUDDEN+) to a fraction of the lane, clamped to [0, 1]; it is drawn while above 0. */
  setLanecover(value: number): void {
    if (!Number.isFinite(value)) return;
    const cover = this.play.cover;
    cover.sudden = Math.max(0, Math.min(1, value));
    cover.suddenOn = cover.sudden > 0;
    this.coverLastChangedAtMs = this.getNowMs();
  }

  /** Move the lane cover by `delta` of the lane (keys step ±0.01, the wheel ±0.05). */
  adjustLanecover(delta: number): void {
    if (!Number.isFinite(delta)) return;
    this.setLanecover(this.play.cover.sudden + delta);
  }

  getLanecover(): number {
    return this.play.cover.sudden;
  }

  /** Set the LIFT to a fraction of the lane, clamped to [0, 1]. */
  setLift(value: number): void {
    if (!Number.isFinite(value)) return;
    this.play.cover.lift = Math.max(0, Math.min(1, value));
    this.coverLastChangedAtMs = this.getNowMs();
  }

  /** Move the LIFT by `delta` of the lane. */
  adjustLift(delta: number): void {
    if (!Number.isFinite(delta)) return;
    this.setLift(this.play.cover.lift + delta);
  }

  getLift(): number {
    return this.play.cover.lift;
  }

  /**
   * Set HIDDEN+: its height as a fraction of the lane above the LIFT (clamped to [0, 1]; a non-finite one keeps the
   * height) and whether it is drawn.
   */
  setHiddenCover(ratio: number, enabled: boolean = true): void {
    const cover = this.play.cover;
    if (Number.isFinite(ratio)) cover.hidden = Math.max(0, Math.min(1, ratio));
    cover.hiddenOn = enabled === true;
    this.coverLastChangedAtMs = this.getNowMs();
  }

  getHiddenCover(): number {
    return this.play.cover.hidden;
  }

  isHiddenCoverEnabled(): boolean {
    return this.play.cover.hiddenOn;
  }

  /** The longest combo of the play (the engine's summary has none). */
  getMaxCombo(): number {
    return this.play.maxCombo;
  }

  /**
   * Replace the skin config's option ops (a `property[]` re-pick mid-chart), keeping the runtime ops: ops absent from
   * `next` go, new ones are added.
   */
  setBaseOps(next: ReadonlySet<number>): void {
    for (const op of this.baseOps) {
      if (!next.has(op)) this.activeOps.delete(op);
    }
    for (const op of next) this.activeOps.add(op);
    this.baseOps = next;
  }

  /** Update the autoplay op. */
  setAutoPlay(active: boolean): void {
    this.activeOps.delete(active ? BEATORAJA_OP.AUTOPLAY_OFF : BEATORAJA_OP.AUTOPLAY_ON);
    this.activeOps.add(active ? BEATORAJA_OP.AUTOPLAY_ON : BEATORAJA_OP.AUTOPLAY_OFF);
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

  /** Every started timer as `[id, atMs]`, by id (diagnostics). */
  timerSnapshot(): ReadonlyArray<readonly [number, number]> {
    return Array.from(this.timerStartedAt.entries()).sort((a, b) => a[0] - b[0]);
  }

  /** The lit ops, sorted (diagnostics). */
  activeOpSnapshot(): ReadonlyArray<number> {
    return Array.from(this.activeOps).sort((a, b) => a - b);
  }

  /**
   * Back to the start of a play (a restart): the runtime ops, timers, judgments, graphs and timings go; the option ops,
   * the autoplay op, the hi-speed, the covers and the host's offsets stay.
   */
  reset(): void {
    const wasAutoplay = this.activeOps.has(BEATORAJA_OP.AUTOPLAY_ON);
    this.activeOps.clear();
    for (const op of this.baseOps) this.activeOps.add(op);
    this.addStartOps(wasAutoplay);
    this.timerStartedAt.clear();
    this.timerStartedAt.set(TIMER_SCENE_START, 0);
    this.timerStartedAt.set(TIMER_PREVIEW, 0);
    this.firedOnce.clear();
    for (const side of [1, 2, 3] as const) {
      this.plates[side].lastJudgeOp = undefined;
      this.plates[side].lastFastSlowOp = undefined;
      this.lastJudgeOnLane[side] = createEmptyLaneJudgeRing();
    }
    const play = this.play;
    play.plateCombos = [0, 0, 0];
    play.combo = 0;
    play.maxCombo = 0;
    play.earlyLate = NO_EARLY_LATE();
    delete play.score;
    delete play.gauge;
    delete play.clock;
    delete play.lastJudgeDeltaMs;
    play.chart = this.initJudgeState();
    this.poorBgaActive = false;
    this.frame = null;
    this.lastFrameBeat = undefined;
    this.lastFrameGauge = undefined;
    this.scoreOps = [];
    this.scoreHistory = [];
    this.gaugeHistory = [];
    this.recentTimings.length = 0;
    this.allTimings.length = 0;
    this.pressedChannels.clear();
    this.lnHoldHeldByChannel.clear();
    // Cancel pending flash and hold-bomb releases so they do not switch off the next run's timers.
    for (const handle of this.flashReleaseHandles) clearTimeout(handle);
    this.flashReleaseHandles.clear();
    for (const handle of this.lnTailBombReleaseHandles) clearTimeout(handle);
    this.lnTailBombReleaseHandles.clear();
  }
}

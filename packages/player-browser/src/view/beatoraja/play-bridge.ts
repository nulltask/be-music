/**
 * The beatoraja play skin's runtime on the view side: what the skin reads each frame (`BeatorajaRenderContext` and the
 * skin view's resolvers), kept from the play session's frames. The play itself — the combo, the max combo, the timed
 * judgments with their early / late counts, the graphs, the lane covers and the hi-speed — is the frame's `PlayState`;
 * the engine's latest frame gives the score, the gauge and the clock. What each beatoraja id reads of them is resolved
 * by `@be-music/skin-beatoraja/scene`. The bridge keeps only what is the skin's own between frames:
 *
 * - the ops lit now (`activeOps`): the skin options' ops, the play's start, score, cover, judgment and FAST / SLOW ops;
 * - the timers started (`timerStartedAt`, on the play clock), from the frame's events: the scene stages, the lanes, the
 *   judgments, the beat, the gauge and the end of the notes;
 * - the judge plates' combos and latest judgments, each lane's latest judgment, the long notes held, the POOR image;
 * - the judge-state graph (`judgegraph[]` type 1): beatoraja's note states per second of the chart, moved by each
 *   judgment the frame's events carry, timed or not;
 * - the offsets the host set, the frame rate and the wall clock.
 *
 * Time comes in with each frame (`nowMs`, the play clock), so the bridge reads no clock but the wall clock and keeps no
 * timer: a flash and a long note's tail bomb end when a later frame reaches their end.
 */

import {
  resolveBeatorajaScoreTimers,
  resolveBeatorajaHCNTimers,
  resolveBeatorajaCharacterTimers,
  type BeatorajaCharacterTimerState,
} from '@be-music/skin-beatoraja/scene';
import type { PlayerHCNLaneState } from '@be-music/player-engine/signals';
import type { PlayFrame } from '../types.ts';
import type { BeMusicJSON } from '@be-music/chart-source';
import {
  BEATORAJA_OP,
  JUDGE_LANE_REF_RANGE,
  TIMER_FADEOUT,
  TIMER_FAILED,
  TIMER_PLAY,
  TIMER_MUSIC_END,
  TIMER_PREVIEW,
  TIMER_READY,
  TIMER_SCENE_START,
  TIMER_STARTINPUT,
  type BeatorajaSide,
  type BeatorajaSkinOffsetValue,
} from '@be-music/skin-beatoraja';
import {
  BEATORAJA_COVER_OPS,
  BEATORAJA_PLAY_STARTED_OPS,
  beatorajaGaugePercent,
  beatorajaLaneJudgeImage,
  beatorajaLaneJudgeRef,
  beatorajaWallClockOf,
  createBeatorajaJudgeStateGraph,
  resolveBeatorajaConstantOps,
  resolveBeatorajaJudgeDisplayOps,
  resolveBeatorajaCoverOps,
  resolveBeatorajaFrameTimers,
  resolveBeatorajaSeekTimers,
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
  type BeatorajaEarlyLate,
  type BeatorajaGaugeInput,
  type BeatorajaLaneAction,
  type BeatorajaLanePlacement,
  type BeatorajaPlayChartFacts,
  type BeatorajaPlayNumberInput,
  type BeatorajaPlayOffsetInput,
  type BeatorajaPlayTextInput,
  type BeatorajaScoreInput,
  type BeatorajaTimerChanges,
} from '@be-music/skin-beatoraja/scene';
import type { ChartPlayVariant } from '@be-music/chart-model';
import { DEFAULT_POOR_BGA_DISPLAY_SECONDS } from '@be-music/player-engine/display';
import { resolveSideKeySlot } from '@be-music/player-engine/lanes';
import {
  recentJudgeTimings,
  type CourseView,
  type JudgmentTiming,
  type LaneCoverState,
  type PlayState,
} from '@be-music/player-scene-model';
import type { BeMusicJudgeWindows, BeMusicJudgeWindowSet } from '@be-music/player-skin-sdk';
import { isMissLayerShown } from '../../chart/bga-timeline.ts';
import { extractChartSubartist } from '../../chart/beatoraja/meta.ts';
import { computeBeatorajaNoteBreakdown } from '../../chart/beatoraja/note-counts.ts';
import { computeBeatorajaChartNoteDistribution } from '../../chart/beatoraja/note-distribution.ts';
import {
  beatorajaPlayChartFacts,
  beatorajaPlayChartTraits,
  computeBeatorajaLastNoteBeats,
} from '../../chart/beatoraja/play-facts.ts';
import type { BeatorajaSkinAudio } from '../../skin/beatoraja/audio.ts';
import type { BeatorajaRenderContext } from '../../skin/beatoraja/render.ts';
import type { PlayViewEvent } from '../types.ts';

export interface BeatorajaPlayBridgeOptions {
  /** The chart's play variant (`ChartPlayVariant`): which lane each channel is on. */
  readonly chartPlayVariant: ChartPlayVariant;
  /** The ops of the player's picks for the skin's options: lit for the whole play. */
  readonly baseOps: ReadonlySet<number>;
  /** The play is AUTO PLAY (`AUTOPLAY_ON`). */
  readonly autoPlay?: boolean;
  /** Motion periods from a character pack; the upstream default is 1 ms for every motion. */
  readonly pmCharaMotionDurationsMs?: readonly number[];
  /**
   * The chart as the play plays it (its `#RANDOM` branches drawn, DP FLIP applied): its texts, BPM, last notes, note
   * kinds and the judge-state graph's seconds. Without it every text renders empty.
   */
  readonly chart?: BeMusicJSON;
  /** The skin's name and author (texts 50 / 51). */
  readonly skinHeaderName?: string;
  readonly skinHeaderAuthor?: string;
  /** The chart's folder (text 1000). */
  readonly directoryLabel?: string;
  /** The running course, when the play is one of its stages: its stage titles show on texts 150-159. */
  readonly courseInfo?: CourseView;
  /**
   * The lane's height in skin pixels: the LIFT and HIDDEN+ offsets move across it. The skin's `lanecover` slider
   * `range`; {@link DEFAULT_LANE_HEIGHT} (the reference theme's 580) without one.
   */
  readonly laneHeight?: number;
  /**
   * Per side, the combo digits of the skin's `judge[].numbers[0]`: a judge word with `shift` moves left by half the
   * combo's width (`SkinJudge.java:108-109`). Defaults to the default skin's `width = 40, space = 0`.
   */
  readonly judgeComboMetrics?: { 1?: { width?: number; space?: number }; 2?: { width?: number; space?: number } };
  /** Where the skin's Lua sounds play (`main_state.audio_*`); they are silent without it. */
  readonly skinSounds?: BeatorajaSkinAudio;
}

/** The engine's summary as the skin reads it: the counts, the scores and the gauge. */
export interface BeatorajaPlaySummaryInput extends BeatorajaScoreInput {
  readonly gauge?: BeatorajaGaugeInput;
}

/** Where the engine is: its latest frame's chart time and beat, the chart's length, and its summary. */
export interface BeatorajaPlayEngineInput {
  readonly currentSeconds: number;
  readonly currentBeat: number;
  readonly totalSeconds: number;
  /** Chart time of an LR2 negative-BPM reversal, when the chart has one. */
  readonly reversalSeconds?: number;
  readonly summary: BeatorajaPlaySummaryInput;
  readonly hcnLanes?: readonly PlayerHCNLaneState[];
  readonly judgedNoteCount?: number;
}

/** What the bridge reads of one frame of the play. */
export interface BeatorajaPlayBridgeFrame {
  /** The play clock, in ms: the skin's timers count on it. */
  readonly nowMs: number;
  readonly judgeTimingMs?: number;
  /** The player's Visual CONSTANT setting, which lights `OPTION_CONSTANT` (400) even where a course stops it drawing. */
  readonly visualConstant?: boolean;
  /** The play's automatic judge timing mode: LR2's SILENT (`'LR2-SILENT'`) hides the skin's judgment display. */
  readonly judgeTimingAutoAdjust?: string;
  readonly exiting?: boolean;
  readonly scoreTargets?: PlayFrame['scoreTargets'];
  /** The host's clock, in ms, for the frame rate; the play clock without it. */
  readonly hostNowMs?: number;
  readonly state: PlayState;
  /** The engine's latest frame; absent before the play has one. */
  readonly engine?: BeatorajaPlayEngineInput;
  /** What happened since the last frame, oldest first. */
  readonly events: readonly PlayViewEvent[];
  /**
   * The windows the engine judges the play by (its judge ruleset's), as the session holds them once the engine has
   * started; absent before. The timing visualizer's bands show the key lanes' ones.
   */
  readonly judgeWindows?: BeMusicJudgeWindows;
}

/** A judge plate's latest judgment and FAST / SLOW ops, which the next judgment on the plate replaces. */
interface PlateOps {
  lastJudgeOp: number | undefined;
  lastFastSlowOp: number | undefined;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The play the resolvers read, kept in one object the bridge updates in place. */
type PlayInput = Mutable<Omit<BeatorajaPlayNumberInput & BeatorajaPlayOffsetInput, 'plateCombos'>> & {
  plateCombos: [number, number, number];
};

/** A lane's flash or long-note tail bomb that ends at `atMs`. */
interface PendingLaneEnd {
  readonly atMs: number;
  readonly channel: string;
  readonly action: 'flash-end' | 'hold-end';
}

/** Default lane height in skin pixels: `play7main.lua`'s `lanecover` slider `range`. */
export const DEFAULT_LANE_HEIGHT = 580;

/** How long `LANECOVER1_CHANGING` (270) stays lit after the player moves a cover; skins fade a percentage popup on it. */
const COVER_CHANGING_WINDOW_MS = 500;

/** Timed judgments the timing visualizer and the timing histogram (`judgegraph[]` type 2) read. */
const RECENT_TIMINGS_CAPACITY = 50;

/**
 * How long an AUTO PLAY flash keeps the key beam on, as the play session's own key flash; skipped when the lane is
 * pressed or held meanwhile.
 */
const FLASH_LANE_HOLD_MS = 60;

/**
 * How long the long-note hold timer, restarted on the tail's judgment for the hold bomb (ModernChic's `lnbomb` keys on
 * `HOLD_*P_KEY*`), stays on. beatoraja switches it off the frame after the tail (`JudgeManager.java:546-547`); skins
 * that omit `loop` would otherwise animate the bomb forever. 320 ms covers the surveyed bomb cycles (ModernChic 160,
 * GdbG up to ~200).
 */
const LN_TAIL_BOMB_HOLD_MS = 320;

/** No early / late count for beatoraja's MISS, which the engine has none of: its rows read 0, not POOR's. */
const NO_MISS_COUNT = { early: 0, late: 0 } as const;

/** The 1P covers before the play state has any: nothing drawn. */
const NO_COVER: LaneCoverState = { side: '1P', sudden: 0, suddenOn: false, hidden: 0, hiddenOn: false, lift: 0 };

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

/** The beatoraja play skin's runtime on the view side. See the module comment. */
export class BeatorajaPlayBridge {
  /** Lit ops: the option ops and the play's. The same `Set` goes to the skin view every frame. */
  private readonly activeOps: Set<number>;
  private baseOps: ReadonlySet<number>;
  /** Timer id → when it started, on the play clock. */
  private readonly timerStartedAt = new Map<number, number>();
  /** Timers that start once per play (failure, end of notes, full combo, full gauge) and already did. */
  private readonly firedOnce = new Set<number>();
  private readonly renderContext: BeatorajaRenderContext;
  private readonly chartPlayVariant: ChartPlayVariant;
  private readonly chart: BeMusicJSON | undefined;
  private readonly startTraits: BeatorajaChartTraits | undefined;
  private readonly texts: BeatorajaPlayTextInput;
  private readonly play: PlayInput;
  private readonly lastNoteBeats: { 1?: number; 2?: number };
  private readonly pmCharaMotionDurationsMs: readonly number[] | undefined;
  private nowMs = 0;
  private hasJudgment = false;
  private characterJudge: string | undefined;
  private characterState: BeatorajaCharacterTimerState = { lastNotes: [0, 0] };
  private engine: BeatorajaPlayEngineInput | undefined;
  private state: PlayState | undefined;
  private sceneStarted = false;
  private loaded = false;
  private fadeoutStamped = false;
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
  /** Chart seconds of the last miss (the engine's `trigger-poor-bga`), which starts the miss layer's window. */
  private lastMissSeconds: number | undefined;
  /** Lanes whose long note the player holds now: the note layer draws the held body sprite. */
  private readonly lnHoldHeldByChannel = new Set<string>();
  /**
   * Lanes in a long note whose tail's judgment is still to come. The release comes before the tail's judgment, so the
   * hold flag above is already gone; this one restarts the hold timer for the tail's bomb.
   */
  private readonly lnTailVerdictLatch = new Set<string>();
  /** Lanes the player presses now, which a flash's end leaves alone. */
  private readonly pressedChannels = new Set<string>();
  /** Flashes and tail bombs still to end, by when. */
  private pending: PendingLaneEnd[] = [];
  /** The covers of the last frame, to tell when the player moved one. */
  private lastCovers: readonly LaneCoverState[] | undefined;
  /** When the player last moved a cover (play clock): `LANECOVER1_CHANGING` stays lit for a moment after. */
  private coverLastChangedAtMs: number | undefined;
  /** Offsets the host set by id (sliders); a live offset the play sets wins over them. */
  private readonly offsets = new Map<number, BeatorajaSkinOffsetValue>();
  /** One object per live offset id, refilled on every read: the renderer reads it at once and does not keep it. */
  private readonly liveOffsets = new Map<number, BeatorajaSkinOffsetValue>();
  /** The judge-state graph (`judgegraph[]` type 1), updated in place as notes are judged. */
  private judgeState: { buckets: number[][]; maxCount: number; totalMs: number } | undefined;
  /** The early / late counts the numbers read: the play state's, with beatoraja's MISS at 0. */
  private earlyLate: { source: PlayState['earlyLate']; counts: BeatorajaEarlyLate } | undefined;
  /** The latest timed judgments as the timing visualizer reads them, kept until the play state's list changes. */
  private timingSamples: { source: readonly JudgmentTiming[]; samples: Array<{ deltaMs: number; kind: string }> } = {
    source: [],
    samples: [],
  };
  private readonly bootMs = Date.now();
  /** Recent frame times (host clock), averaged into the frame rate readout. */
  private readonly fpsRingMs = new Float64Array(120);
  private fpsRingHead = 0;
  private fpsRingFilled = 0;
  /** The beat and gauge of the engine frame before, for the beat and failure timers. */
  private lastFrameBeat: number | undefined;
  private lastFrameGauge: number | undefined;
  private cachedNoteBreakdown: ReturnType<typeof computeBeatorajaNoteBreakdown> | undefined;
  /** The play's judge windows, as the latest frame carried them. */
  private judgeWindows: BeMusicJudgeWindows | undefined;
  /** Refs the resolvers do not cover, logged once per play each. */
  private readonly unresolvedNumberRefs = new Set<number>();
  private readonly unresolvedTextRefs = new Set<number>();

  public constructor(options: BeatorajaPlayBridgeOptions) {
    this.pmCharaMotionDurationsMs = options.pmCharaMotionDurationsMs;
    this.chartPlayVariant = options.chartPlayVariant;
    this.baseOps = options.baseOps;
    this.activeOps = new Set(options.baseOps);
    const skinSounds = options.skinSounds;
    this.renderContext = {
      activeOps: this.activeOps,
      getTimerStart: (id) => this.timerStartedAt.get(id),
      nowMs: 0,
      resolveOffset: (id) => this.resolveOffset(id),
      resolveGaugeState: () => this.resolveGaugeState(),
      ...(skinSounds !== undefined
        ? {
            audioPlay: (path: string, volume: number) => skinSounds.play(path, volume),
            audioLoop: (path: string, volume: number) => skinSounds.loop(path, volume),
            audioStop: (path: string) => skinSounds.stop(path),
          }
        : {}),
    };
    const chart = options.chart;
    this.chart = chart;
    this.startTraits = chart !== undefined ? beatorajaPlayChartTraits(chart) : undefined;
    this.lastNoteBeats = chart !== undefined ? computeBeatorajaLastNoteBeats(chart) : {};
    this.texts = {
      ...(chart !== undefined
        ? {
            chart: {
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
      ...(chart?.metadata.total !== undefined ? { chartTotal: chart.metadata.total } : {}),
      // The play state's from the first frame; `DEFAULT_PLAY_OPTIONS.hiSpeed` until then.
      hiSpeed: 2.0,
      cover: NO_COVER,
      chart: this.initJudgeState(),
      plateCombos: [0, 0, 0],
      laneHeight,
      comboDigits: {
        1: resolveJudgeComboMetric(options.judgeComboMetrics?.[1]),
        2: resolveJudgeComboMetric(options.judgeComboMetrics?.[2]),
      },
    };
    this.refreshClock();
    const startOps = resolveBeatorajaPlayStartOps({
      // Generic keyboards borrow an SP theme frame; their note geometry and judging keep the generic variant.
      playVariant: this.chartPlayVariant.startsWith('generic-') ? '7' : this.chartPlayVariant,
      autoPlay: options.autoPlay === true,
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

  /**
   * Takes one frame of the play — the lane ends now due, the engine's frame, the events since the last frame and the
   * play state, in that order — and returns the context the skin view reads (the same object and op set each time).
   */
  public update(frame: BeatorajaPlayBridgeFrame): BeatorajaRenderContext {
    this.nowMs = frame.nowMs;
    // The scene starts with the play's scene start when this frame carries it, else with the frame.
    let sceneStartAt = frame.nowMs;
    for (const event of frame.events) {
      if (event.kind === 'scene-start') {
        sceneStartAt = event.atMs;
        break;
      }
    }
    this.startScene(sceneStartAt);
    this.endDueLanes(frame.nowMs);
    if (frame.engine !== undefined) this.applyEngine(frame.engine, frame.hostNowMs ?? frame.nowMs);
    for (const event of frame.events) this.handle(event);
    // PLAY is chart time: tempo changes, replay tempo, pauses and seeks all come from the same engine clock.
    if (this.timerStartedAt.has(TIMER_PLAY) && frame.engine !== undefined) {
      this.timerStartedAt.set(TIMER_PLAY, frame.nowMs - Math.max(0, frame.engine.currentSeconds) * 1000);
    }
    this.applyAnimationTimers(frame);
    this.applyState(frame.state);
    this.play.judgeTimingMs = frame.judgeTimingMs ?? 0;
    this.activeOps.delete(BEATORAJA_OP.CONSTANT);
    for (const op of resolveBeatorajaConstantOps(frame.visualConstant)) this.activeOps.add(op);
    this.activeOps.delete(BEATORAJA_OP.JUDGE_DISPLAY_HIDDEN);
    for (const op of resolveBeatorajaJudgeDisplayOps(frame.judgeTimingAutoAdjust)) this.activeOps.add(op);
    this.judgeWindows = frame.judgeWindows;
    return this.renderContextAt(frame.nowMs);
  }

  private applyAnimationTimers(frame: BeatorajaPlayBridgeFrame): void {
    const engine = frame.engine;
    const score = engine?.summary;
    const pastNotes =
      engine?.judgedNoteCount ??
      (score === undefined ? 0 : score.perfect + score.great + score.good + score.bad + score.poor);
    if (score !== undefined) {
      this.applyTimers(
        resolveBeatorajaScoreTimers({
          exScore: score.exScore,
          totalNotes: score.total,
          hasJudgment: this.hasJudgment || pastNotes > 0,
          ...frame.scoreTargets,
          started: new Set(this.timerStartedAt.keys()),
        }),
      );
      this.applyTimers(
        resolveBeatorajaHCNTimers({
          lanes: (engine?.hcnLanes ?? []).map((lane) => ({ ...this.placementOf(lane.channel), gaining: lane.gaining })),
          started: this.timerStartedAt.keys(),
        }),
      );
    }
    const playing = this.timerStartedAt.has(TIMER_PLAY);
    const finished = this.timerStartedAt.has(TIMER_MUSIC_END);
    const stopped = frame.exiting === true && !finished;
    const character = resolveBeatorajaCharacterTimers({
      nowMs: frame.nowMs,
      timers: this.timerStartedAt,
      state: this.characterState,
      stage: finished ? 'finished' : stopped ? 'stopped' : playing ? 'playing' : 'loading',
      pastNotes,
      motionDurationsMs: this.pmCharaMotionDurationsMs,
      latestJudge: this.characterJudge,
      gaugeMax: score?.gauge !== undefined && score.gauge.max > 0 && score.gauge.current >= score.gauge.max,
    });
    this.characterState = character.state;
    this.applyTimers(character.changes);
  }

  /**
   * Starts the scene's timers (scene start, preview: ModernChic's lane reveal) on the first frame shown, or when the
   * play's scene starts, whichever comes first.
   */
  /**
   * The scene, ready and play timers a view that joins mid-play starts at `atMs` (the play clock when the chart
   * started, or now while the intro is still running). Later frames move the play timer onto the engine clock.
   */
  public joinRunning(atMs: number, chartStarted: boolean): void {
    this.startScene(atMs);
    if (!chartStarted) return;
    this.markLoaded(atMs);
    if (!this.timerStartedAt.has(TIMER_STARTINPUT)) this.timerStartedAt.set(TIMER_STARTINPUT, atMs);
    if (!this.timerStartedAt.has(TIMER_PLAY)) this.timerStartedAt.set(TIMER_PLAY, atMs);
  }

  public startScene(atMs: number): void {
    if (this.sceneStarted) return;
    this.sceneStarted = true;
    this.timerStartedAt.set(TIMER_SCENE_START, atMs);
    this.timerStartedAt.set(TIMER_PREVIEW, atMs);
  }

  /** One event of the play: its stages, a lane, a long note held, a judgment, the POOR image. */
  public handle(event: PlayViewEvent): void {
    switch (event.kind) {
      case 'scene-start':
        this.startScene(event.atMs);
        return;
      case 'input-start':
        if (!this.timerStartedAt.has(TIMER_STARTINPUT)) this.timerStartedAt.set(TIMER_STARTINPUT, event.atMs);
        return;
      case 'play-start':
        if (!this.timerStartedAt.has(TIMER_PLAY)) this.timerStartedAt.set(TIMER_PLAY, event.atMs);
        return;
      case 'music-end':
        if (!this.timerStartedAt.has(TIMER_MUSIC_END)) this.timerStartedAt.set(TIMER_MUSIC_END, event.atMs);
        return;
      case 'load-end':
        this.markLoaded(event.atMs);
        return;
      case 'exit-fade-out':
        if (this.fadeoutStamped) return;
        this.fadeoutStamped = true;
        this.timerStartedAt.set(TIMER_FADEOUT, event.atMs);
        return;
      case 'exit-close':
        // The play failed and stops (beatoraja's `STATE_FAILED`): `TIMER_FAILED` starts, unless the frame that took the
        // gauge to 0 already started it.
        if (this.firedOnce.has(TIMER_FAILED)) return;
        this.firedOnce.add(TIMER_FAILED);
        this.timerStartedAt.set(TIMER_FAILED, event.atMs);
        return;
      case 'lane':
        this.applyLane(event.channel, event.action);
        return;
      case 'lane-hold':
        this.applyLaneAction('hold', event.channel);
        this.lnHoldHeldByChannel.add(event.channel);
        this.lnTailVerdictLatch.add(event.channel);
        return;
      case 'poor-bga':
        // beatoraja times its miss layer from the miss alone: a later judgment (`clear-poor-bga`) does not end it.
        if (event.shown && event.seconds !== undefined) this.lastMissSeconds = event.seconds;
        return;
      case 'judge':
        this.applyJudge(event);
        return;
      case 'seek':
        this.applySeek(event);
        return;
      default:
        return;
    }
  }

  /**
   * The play sought: every timer but the scene's stops and the once-per-play ones may start again
   * ({@link resolveBeatorajaSeekTimers}); the plates' judgment and FAST / SLOW ops, the lanes' latest judgments, the held
   * long notes, the flashes still to end and the miss window go; and the judge-state graph is rebuilt from the
   * judgments before the second sought. The long notes held across it come next, as their own events.
   */
  private applySeek(event: Extract<PlayViewEvent, { kind: 'seek' }>): void {
    const engine = this.engine;
    const changes = resolveBeatorajaSeekTimers({
      started: [...this.timerStartedAt.keys()],
      beat: engine?.currentBeat ?? Number.NaN,
      ...(engine?.summary.gauge !== undefined ? { gauge: engine.summary.gauge } : {}),
      lastNoteBeats: this.lastNoteBeats,
    });
    for (const id of changes.stop) this.firedOnce.delete(id);
    this.applyTimers(changes);
    if (engine !== undefined && Number.isFinite(engine.currentBeat)) this.lastFrameBeat = engine.currentBeat;
    for (const plate of [1, 2, 3] as const) {
      const ops = this.plates[plate];
      if (ops.lastJudgeOp !== undefined) this.activeOps.delete(ops.lastJudgeOp);
      if (ops.lastFastSlowOp !== undefined) this.activeOps.delete(ops.lastFastSlowOp);
      ops.lastJudgeOp = undefined;
      ops.lastFastSlowOp = undefined;
      this.lastJudgeOnLane[plate] = createEmptyLaneJudgeRing();
    }
    this.lnHoldHeldByChannel.clear();
    this.lnTailVerdictLatch.clear();
    this.pressedChannels.clear();
    this.pending = [];
    this.lastMissSeconds = undefined;
    this.hasJudgment = event.judgments.length > 0;
    this.characterJudge = event.judgments.at(-1)?.judge;
    this.characterState = { lastNotes: [0, 0] };
    this.initJudgeState();
    const graph = this.judgeState;
    if (graph === undefined) return;
    for (const judgment of event.judgments) {
      const noteMs = judgment.seconds * 1000 - (judgment.deltaMs ?? 0);
      const move = resolveBeatorajaJudgeStateMove(graph, judgment.judge, noteMs);
      if (move === undefined) continue;
      const bucket = graph.buckets[move.bucket]!;
      bucket[0] = bucket[0]! - 1;
      bucket[move.slot] = bucket[move.slot]! + 1;
    }
  }

  /**
   * The chart has loaded: READY (40) starts, and
   * `LOADED` lights in place of `NOW_LOADING`.
   */
  private markLoaded(atMs: number): void {
    if (this.loaded) return;
    this.loaded = true;
    this.timerStartedAt.set(TIMER_READY, atMs);
    this.activeOps.delete(BEATORAJA_PLAY_STARTED_OPS.off);
    this.activeOps.add(BEATORAJA_PLAY_STARTED_OPS.on);
  }

  private startOnce(timerId: number): void {
    if (this.firedOnce.has(timerId)) return;
    this.firedOnce.add(timerId);
    this.timerStartedAt.set(timerId, this.nowMs);
  }

  /** Start and stop the timers a change of the play asks for. */
  private applyTimers(changes: BeatorajaTimerChanges): void {
    for (const id of changes.start) this.timerStartedAt.set(id, this.nowMs);
    for (const id of changes.startOnce) this.startOnce(id);
    for (const id of changes.stop) this.timerStartedAt.delete(id);
  }

  /** The engine's latest frame: the score, gauge and clock the resolvers read, the score ops and the frame's timers. */
  public applyEngine(engine: BeatorajaPlayEngineInput, hostNowMs: number = this.nowMs): void {
    this.engine = engine;
    const summary = engine.summary;
    this.play.score = summary;
    if (summary.gauge !== undefined) this.play.gauge = summary.gauge;
    else delete this.play.gauge;
    this.play.clock = engine;
    // The frame-rate readout averages the host clock over recent frames, so a throttled ticker reads as throttled.
    this.fpsRingMs[this.fpsRingHead] = hostNowMs;
    this.fpsRingHead = (this.fpsRingHead + 1) % this.fpsRingMs.length;
    if (this.fpsRingFilled < this.fpsRingMs.length) this.fpsRingFilled += 1;
    this.syncScoreOps(summary, summary.gauge);
    this.applyTimers(
      resolveBeatorajaFrameTimers({
        beat: engine.currentBeat,
        ...(this.lastFrameBeat !== undefined ? { previousBeat: this.lastFrameBeat } : {}),
        ...(summary.gauge !== undefined ? { gauge: summary.gauge } : {}),
        ...(this.lastFrameGauge !== undefined ? { previousGauge: this.lastFrameGauge } : {}),
        lastNoteBeats: this.lastNoteBeats,
      }),
    );
    if (Number.isFinite(engine.currentBeat)) this.lastFrameBeat = engine.currentBeat;
    this.lastFrameGauge = summary.gauge?.current;
  }

  /** Swap the score and gauge ops of the last frame for this frame's. */
  private syncScoreOps(score: BeatorajaScoreInput, gauge: BeatorajaGaugeInput | undefined): void {
    const next = resolveBeatorajaPlayScoreOps(score, gauge);
    for (const op of this.scoreOps) {
      if (!next.includes(op)) this.activeOps.delete(op);
    }
    for (const op of next) this.activeOps.add(op);
    this.scoreOps = next;
  }

  /**
   * The play state: the combo and max combo, the early / late counts and the latest timing, the 1P covers and the
   * hi-speed the notes scroll at. A cover the player moved lights `LANECOVER1_CHANGING` for a moment.
   */
  public applyState(state: PlayState): void {
    this.state = state;
    const play = this.play;
    play.combo = state.combo;
    play.maxCombo = state.maxCombo;
    if (state.lastJudgeDeltaMs !== undefined) play.lastJudgeDeltaMs = state.lastJudgeDeltaMs;
    else delete play.lastJudgeDeltaMs;
    if (this.earlyLate?.source !== state.earlyLate) {
      this.earlyLate = { source: state.earlyLate, counts: { ...state.earlyLate, MISS: NO_MISS_COUNT } };
    }
    play.earlyLate = this.earlyLate.counts;
    const drawn = state.view.hiSpeed.drawn;
    if (Number.isFinite(drawn) && drawn > 0) play.hiSpeed = drawn;
    const covers = state.view.covers;
    if (this.lastCovers !== undefined && covers !== this.lastCovers) this.coverLastChangedAtMs = this.nowMs;
    this.lastCovers = covers;
    play.cover = covers.find((cover) => cover.side === '1P') ?? covers[0] ?? NO_COVER;
  }

  private placementOf(channel: string): BeatorajaLanePlacement {
    let placement = this.placements.get(channel);
    if (placement === undefined) {
      const slot = resolveSideKeySlot(channel, this.chartPlayVariant);
      placement = this.chartPlayVariant.startsWith('generic-')
        ? { side: 1, plate: 1, ...(slot >= 0 ? { lane: slot } : {}) }
        : resolveBeatorajaLanePlacement(channel, this.chartPlayVariant, slot);
      this.placements.set(channel, placement);
    }
    return placement;
  }

  private applyLaneAction(action: BeatorajaLaneAction, channel: string): void {
    this.applyTimers(resolveBeatorajaLaneTimers(action, this.placementOf(channel)));
  }

  /** A key went down or up, or the engine flashed a lane (AUTO PLAY's press, which has no release). */
  private applyLane(channel: string, action: 'press' | 'release' | 'flash'): void {
    switch (action) {
      case 'press':
        this.pressedChannels.add(channel);
        this.applyLaneAction('press', channel);
        return;
      case 'release':
        // Ends a long note held on the lane too: its hold timer goes off and its body sprite back to the unheld one.
        this.pressedChannels.delete(channel);
        this.applyLaneAction('release', channel);
        this.lnHoldHeldByChannel.delete(channel);
        return;
      case 'flash':
        // The key beam flashes, then comes off on its own, unless a real press or a long note took the lane meanwhile.
        this.applyLaneAction('flash', channel);
        this.pending.push({ atMs: this.nowMs + FLASH_LANE_HOLD_MS, channel, action: 'flash-end' });
        return;
    }
  }

  /** Ends the flashes and tail bombs whose time has come by `nowMs`, each at its own time. */
  private endDueLanes(nowMs: number): void {
    if (this.pending.length === 0) return;
    const due = this.pending.filter((entry) => entry.atMs <= nowMs);
    if (due.length === 0) return;
    this.pending = this.pending.filter((entry) => entry.atMs > nowMs);
    for (const entry of due) {
      this.nowMs = entry.atMs;
      if (entry.action === 'flash-end') {
        if (this.pressedChannels.has(entry.channel) || this.lnHoldHeldByChannel.has(entry.channel)) continue;
        this.applyLaneAction('flash-end', entry.channel);
      } else {
        this.applyLaneAction('hold-end', entry.channel);
      }
    }
    this.nowMs = nowMs;
  }

  /**
   * A judgment: the plate's judgment and FAST / SLOW ops, the timers it starts ({@link resolveBeatorajaJudgeEffect}),
   * the plate's combo, the lane's latest judgment, a long note's tail bomb and the judge-state graph.
   */
  private applyJudge(event: Extract<PlayViewEvent, { kind: 'judge' }>): void {
    this.hasJudgment = true;
    this.characterJudge = event.judge;
    const channel = event.channel;
    const placement = channel !== undefined ? this.placementOf(channel) : undefined;
    const combo = event.combo ?? this.state?.combo ?? 0;
    const judge = {
      judge: event.judge,
      combo,
      ...(event.deltaMs !== undefined ? { deltaMs: event.deltaMs } : {}),
    };
    const effect = resolveBeatorajaJudgeEffect(judge, placement, this.engine?.summary.total ?? 0);
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
    this.play.plateCombos[plate - 1] = combo;
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
      this.pending.push({ atMs: this.nowMs + LN_TAIL_BOMB_HOLD_MS, channel, action: 'hold-end' });
    }
    const lane = placement?.lane;
    if (
      placement !== undefined &&
      lane !== undefined &&
      lane < JUDGE_LANE_REF_RANGE &&
      effect.laneJudge !== undefined
    ) {
      this.lastJudgeOnLane[placement.side][lane] = { kind: effect.laneJudge, at: this.nowMs };
    }
    if (this.judgeState !== undefined) {
      // The note's chart time: the engine frame's time less the judgment's offset (beatoraja reads each note's state).
      const noteMs = (this.engine?.currentSeconds ?? 0) * 1000 - (event.deltaMs ?? 0);
      const move = resolveBeatorajaJudgeStateMove(this.judgeState, event.judge, noteMs);
      if (move !== undefined) {
        const bucket = this.judgeState.buckets[move.bucket]!;
        bucket[0] = bucket[0]! - 1;
        bucket[move.slot] = bucket[move.slot]! + 1;
      }
    }
  }

  /** The context the skin view reads at `nowMs`, with the cover ops and the clock brought up to date. */
  private renderContextAt(nowMs: number): BeatorajaRenderContext {
    const changing =
      this.coverLastChangedAtMs !== undefined && nowMs - this.coverLastChangedAtMs < COVER_CHANGING_WINDOW_MS;
    const coverOps = resolveBeatorajaCoverOps(this.play.cover, changing);
    for (const op of BEATORAJA_COVER_OPS) {
      if (coverOps.includes(op)) this.activeOps.add(op);
      else this.activeOps.delete(op);
    }
    this.refreshClock();
    this.renderContext.nowMs = nowMs;
    return this.renderContext;
  }

  /** The wall clock, the time running and the frame rate the clock readouts show. */
  private refreshClock(): void {
    const now = new Date();
    this.play.wallClock = beatorajaWallClockOf(now);
    this.play.operatingMs = now.getTime() - this.bootMs;
    this.play.fps = this.currentFPS();
  }

  /** Frames per second over the frames in the ring (N stamps bracket N - 1 intervals); 0 with fewer than two. */
  private currentFPS(): number {
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
  public resolveOffset(offsetId: number): Readonly<BeatorajaSkinOffsetValue> | undefined {
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
  public setOffset(offsetId: number, value: Readonly<Partial<BeatorajaSkinOffsetValue>>): void {
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
  public resolveTextContent(refOp: number): string | undefined {
    if (this.chart === undefined) return undefined;
    const value = resolveBeatorajaPlayText(refOp, this.texts);
    if (value === undefined && !this.unresolvedTextRefs.has(refOp)) {
      this.unresolvedTextRefs.add(refOp);
      // eslint-disable-next-line no-console
      console.log('[beatoraja-play] text ref not wired (renders empty)', JSON.stringify({ ref: refOp }));
    }
    return value;
  }

  /**
   * An `image[].ref` / `imageset[].ref` frame: the key beam and bomb images of each lane's latest judgment (refs
   * 500-519, {@link beatorajaLaneJudgeImage}); 0 for any other ref.
   */
  public resolveRefValue(refOp: number): number {
    const ref = beatorajaLaneJudgeRef(refOp);
    if (ref === undefined) return 0;
    const slot = this.lastJudgeOnLane[ref.side][ref.lane];
    return slot !== undefined ? beatorajaLaneJudgeImage(slot.kind, this.nowMs - slot.at) : 0;
  }

  /**
   * A `value[].ref` number ({@link resolveBeatorajaPlayNumber}); `undefined` (drawn as 0) for a ref it does not cover,
   * logged once.
   */
  public resolveNumberValue(refOp: number): number | undefined {
    const value = resolveBeatorajaPlayNumber(refOp, this.play);
    if (value === undefined && !this.unresolvedNumberRefs.has(refOp)) {
      this.unresolvedNumberRefs.add(refOp);
      // eslint-disable-next-line no-console
      console.log('[beatoraja-play] number ref not wired (draws 0)', JSON.stringify({ ref: refOp }));
    }
    return value;
  }

  /** The gauge in percent of its maximum; 0 before the engine's first frame. */
  public resolveGaugePercent(): number {
    return beatorajaGaugePercent(this.engine?.summary.gauge);
  }

  /** The gauge as the gauge element draws it ({@link resolveBeatorajaGaugeState}); `undefined` before the first frame. */
  public resolveGaugeState(): { value: number; max: number; border: number; mode: number } | undefined {
    return resolveBeatorajaGaugeState(this.engine?.summary.gauge);
  }

  /** Whether the player holds a long note on the lane now: the note layer draws the held body sprite. */
  public isLaneLNHeld(channel: string): boolean {
    return this.lnHoldHeldByChannel.has(channel);
  }

  /** A `slider[].type` position ({@link resolveBeatorajaPlaySliderValue}): the lane cover and the song's progress. */
  public resolveSliderValue(type: number): number | undefined {
    return resolveBeatorajaPlaySliderValue(type, this.play);
  }

  /** A `judgegraph[].type` bar list ({@link resolveBeatorajaPlayJudgeGraph}). */
  public resolveJudgeGraphBars(type: number): ReadonlyArray<number> | undefined {
    return resolveBeatorajaPlayJudgeGraph(type, {
      ...(type === 0 && this.chart !== undefined ? { breakdown: this.noteBreakdown(this.chart) } : {}),
      ...(this.play.score !== undefined ? { score: this.play.score } : {}),
      recentTimings: this.recentTimings(),
    });
  }

  private noteBreakdown(chart: BeMusicJSON): ReturnType<typeof computeBeatorajaNoteBreakdown> {
    this.cachedNoteBreakdown ??= computeBeatorajaNoteBreakdown(chart);
    return this.cachedNoteBreakdown;
  }

  /** The play state's latest timed judgments ({@link RECENT_TIMINGS_CAPACITY}), oldest first. */
  private recentTimings(): readonly JudgmentTiming[] {
    return this.state !== undefined ? recentJudgeTimings(this.state, RECENT_TIMINGS_CAPACITY) : [];
  }

  /** The latest timed judgments, oldest first (signed offsets, > 0 late), for the timing visualizer. */
  public resolveTimingSamples(): ReadonlyArray<{ deltaMs: number; kind: string }> {
    const recent = this.recentTimings();
    if (this.timingSamples.source !== recent) {
      this.timingSamples = {
        source: recent,
        samples: recent.map((timing) => ({ deltaMs: timing.deltaMs, kind: timing.judge })),
      };
    }
    return this.timingSamples.samples;
  }

  /** The judge-state graph (`judgegraph[]` type 1); `undefined` for another type or without a chart. */
  public resolveJudgeStateBuckets(
    type: number,
  ): { buckets: ReadonlyArray<ReadonlyArray<number>>; maxCount: number; totalMs: number } | undefined {
    return type === 1 ? this.judgeState : undefined;
  }

  /**
   * The play's key-lane judge windows (its judge ruleset's, which the frames carry from the session), for the timing
   * visualizer's bands; `undefined` until the engine has reported them.
   */
  public resolveTimingJudgeWindows(): BeMusicJudgeWindowSet | undefined {
    return this.judgeWindows?.note;
  }

  /** A `graph[].type` fill ratio ({@link resolveBeatorajaPlayGraphValue}): the gauge, the song's progress, loading. */
  public resolveGraphValue(type: number): number | undefined {
    return resolveBeatorajaPlayGraphValue(type, this.play);
  }

  /** A line graph's points: the play state's EX score over the chart so far (110); `undefined` for another type. */
  public resolveGraphPolyline(type: number): ReadonlyArray<{ x: number; y: number }> | undefined {
    return type === 110
      ? resolveBeatorajaScorePolyline(this.state?.scoreHistory ?? [], this.engine?.summary.total ?? 0)
      : undefined;
  }

  /**
   * Replace the skin config's option ops (a `property[]` re-pick mid-chart), keeping the play's ops: ops absent from
   * `next` go, new ones are added.
   */
  public setBaseOps(next: ReadonlySet<number>): void {
    for (const op of this.baseOps) {
      if (!next.has(op)) this.activeOps.delete(op);
    }
    for (const op of next) this.activeOps.add(op);
    this.baseOps = next;
  }

  /**
   * Whether the POOR image shows at chart time `seconds`: for beatoraja's `misslayerDuration` (500 ms by default) from
   * the last miss, as `BGAProcessor.drawBGA` draws it.
   */
  public isPoorBGAActive(seconds: number): boolean {
    return isMissLayerShown(this.lastMissSeconds, seconds, DEFAULT_POOR_BGA_DISPLAY_SECONDS);
  }

  /** Whether `op` is lit (diagnostics, tests). */
  public hasOp(op: number): boolean {
    return this.activeOps.has(op);
  }

  /** When `timerId` started on the play clock, or `undefined` (diagnostics, tests). */
  public getTimerStart(timerId: number): number | undefined {
    return this.timerStartedAt.get(timerId);
  }

  /** Every started timer as `[id, atMs]`, by id (diagnostics). */
  public timerSnapshot(): ReadonlyArray<readonly [number, number]> {
    return Array.from(this.timerStartedAt.entries()).sort((a, b) => a[0] - b[0]);
  }

  /** The lit ops, sorted (diagnostics). */
  public activeOpSnapshot(): ReadonlyArray<number> {
    return Array.from(this.activeOps).sort((a, b) => a - b);
  }
}

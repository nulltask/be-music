/**
 * The beatoraja family's play screen: a beatoraja play skin (`play_<variant>`) drawn by `BeatorajaPlaySkinView` with the
 * play's notes, lane markers and BGA spliced in where the skin authors them (`BeatorajaPlayStage`), its canvas fitted
 * into the window. It draws the play session's frames:
 *
 * - the skin's ops, timers, numbers, texts, graphs and offsets through the bridge ({@link BeatorajaPlayBridge}): the
 *   frame's `PlayState` and events, the engine's latest frame, resolved by `@be-music/beatoraja-skin/scene`;
 * - the notes and markers on the engine's clock at the play state's hi-speed, the BGA from the session's textures;
 * - the chart's own images in the skin's synthetic slots (-100 to -102), and the skin's Lua sounds through the audio
 *   service.
 *
 * The skin's cover buttons and the mouse wheel come back as cover intents; the cover keys and the hi-speed keys are the
 * session's (`PlaySessionOptions.coverKeys`), and the view shows what they set for a moment. The session times the
 * play from the view's timing ({@link resolveBeatorajaPlayTiming}): the loading ends at once, the chart starts
 * {@link BEATORAJA_PLAY_LEAD_IN_MS} later, and the play ends over the skin's `fadeout`.
 */

import {
  buildBaseOpSet,
  normalizeBeatorajaNote,
  normalizeBeatorajaSliders,
  type BeatorajaSkin,
  type BeatorajaSkinConfig,
  type BeatorajaSkinCustomOffset,
} from '@be-music/beatoraja-skin';
import { withBeatorajaCourseStageOps } from '@be-music/beatoraja-skin/scene';
import type { BeMusicJson } from '@be-music/json';
import type { ChartPlayVariant } from '@be-music/chart';
import type { PlayerGaugeSummary, PlayerUiFrameNote, PlayerUiFramePayload } from '@be-music/player/signals';
import type { ScoreSummary } from '@be-music/player/ruleset';
import type { CourseView, HiSpeedTransition, LibraryChart, PlayState } from '@be-music/scene-model';
import type { BeMusicJudgeWindows } from '@be-music/skin-sdk';
import { BEATORAJA_HI_SPEED_SCALE } from '@be-music/scene-model';
import { Container, Text, type Texture } from 'pixi.js';
import { computeBeatorajaBpmCurve, type BpmCurvePoint } from '../../chart/beatoraja/bpm-curve.ts';
import { flipDpChart } from '../../chart/beatoraja/dp-flip.ts';
import { computeBeatorajaChartMarkers } from '../../chart/beatoraja/markers.ts';
import {
  computeBeatorajaChartNoteDistribution,
  type BeatorajaChartNoteDistribution,
} from '../../chart/beatoraja/note-distribution.ts';
import type { BrowserSongAssetSource } from '../../collection/types.ts';
import type { BeatorajaKit } from '../../host/family-kit.ts';
import { logger } from '../../logger.ts';
import type { BgaCue, NonstopBgaStage, NonstopStageBgaTimeline } from '../../chart/bga-timeline.ts';
import { DESIGN_HEIGHT, DESIGN_WIDTH, KEY_ON_FADE_OUT_MS } from '../../stage/design.ts';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import type { BeatorajaSkinAudio } from '../../skin/beatoraja/audio.ts';
import type { PlayPlaylogViewScale } from '../../session/play/play-session-theme.ts';
import { playEndingFadeAlpha } from '../shared/play-frame.ts';
import { uploadTextures } from '../shared/texture-upload.ts';
import { TouchLaneInput } from '../shared/touch-lane-input.ts';
import type {
  IntentSink,
  PlayFrame,
  PlayIntent,
  PlayView,
  PlayViewSetting,
  PlayViewTiming,
  PlayfieldSkin,
} from '../types.ts';
import { BeatorajaPlayBridge, type BeatorajaPlayEngineInput } from './play-bridge.ts';
import { BeatorajaPlayStage, type BeatorajaPlayBga, type BeatorajaPlayChartLayout } from './play-stage.ts';
import { createBeatorajaLaneTimelines, createBeatorajaScrollMapper } from './play/scroll-placement.ts';
import { readJudgeComboMetrics } from './play/skin-metrics.ts';
import { BeatorajaViewChartImages, resolveBeatorajaFadeOutMs } from './scene-frame.ts';

const log = logger('beatoraja-gameplay');

/**
 * How long the chart waits after the play has loaded: the 1.5 s the engine's lead-in held a beatoraja play at READY
 * before the chart's start.
 */
export const BEATORAJA_PLAY_LEAD_IN_MS = 1500;

/** How far the skin's cover buttons move a cover: 5 % of the lane per click (Shift reverses). */
const COVER_BUTTON_STEP = 0.05;

/** The wheel moves SUDDEN+ by 0.5 % of the lane per tick, 2.5 % with Shift. */
const WHEEL_COVER_STEP = 0.005;
const WHEEL_COVER_STEP_SHIFT = 0.025;

/** The view-setting feedback shows fully for 800 ms, then fades over 600 ms. */
const INDICATOR_HOLD_MS = 800;
const INDICATOR_FADE_MS = 600;

/** The skin's buttons that move the covers: `LANECOVER` (330), `LIFT` (331), `HIDDEN` (332). */
const BUTTON_LANECOVER = 330;
const BUTTON_LIFT = 331;
const BUTTON_HIDDEN = 332;

/** The beatoraja scale the play log reads the hi-speed on: a lane is four beats at hi-speed 1. */
const BEATORAJA_PLAYLOG_VIEW: PlayPlaylogViewScale = { scale: BEATORAJA_HI_SPEED_SCALE, laneBeats: 4 };

/**
 * The beatoraja play skin's timing: the play has loaded once it shows (READY and the play timers start then), the chart
 * starts {@link BEATORAJA_PLAY_LEAD_IN_MS} later, and the play ends over the skin's `fadeout` (500 ms without one).
 */
export function resolveBeatorajaPlayTiming(skin: Pick<BeatorajaSkin, 'fadeout'>): PlayViewTiming {
  return {
    loadEndOffsetMs: 0,
    playStartOffsetMs: BEATORAJA_PLAY_LEAD_IN_MS,
    fadeOutMs: resolveBeatorajaFadeOutMs(skin.fadeout),
    closeMs: 0,
  };
}

/**
 * The skin's options as ops (`buildBaseOpSet`), with a course stage's: they pick a destination's `if[]` alternatives
 * (beatoraja's per-layout BGA and lane presets) for the whole play.
 */
function resolveSkinConfigOps(
  skinConfig: BeatorajaSkinConfig | undefined,
  course: CourseView | undefined,
): ReadonlySet<number> {
  return withBeatorajaCourseStageOps(buildBaseOpSet(skinConfig?.option), course);
}

/** What the beatoraja play view reads of the running play: the play session's members of these names. */
export interface BeatorajaPlayRuntime {
  readonly song: LibraryChart | undefined;
  /** The chart as the play plays it (its `#RANDOM` branches drawn), before DP FLIP. */
  readonly resolvedChart: BeMusicJson | undefined;
  readonly resolvedPlayChart: { readonly reversal?: BeatorajaPlayChartLayout['reversal'] } | undefined;
  readonly chartPlayVariant: ChartPlayVariant;
  readonly notes: readonly PlayerUiFrameNote[];
  /** The engine's latest frame; `undefined` before its first. */
  readonly engineFrame: Readonly<PlayerUiFramePayload> | undefined;
  /** The engine's counts as the play started (all 0 but the total), for the intro before its first frame. */
  readonly score: ScoreSummary;
  readonly gaugeState: PlayerGaugeSummary;
  readonly scrollHiSpeed: HiSpeedTransition;
  readonly bgaTextures: ReadonlyMap<string, Texture>;
  readonly bgaLayerTextures: ReadonlyMap<string, Texture>;
  readonly bgaVideos: ReadonlyMap<string, { video: HTMLVideoElement }>;
  readonly bgaTimeline: { base: BgaCue[]; layer: BgaCue[]; poor: BgaCue[] };
  /** A stitched NONSTOP chart's cues split by stage (`splitNonstopBgaTimeline`), for the BGA's crossfade at a seam. */
  readonly nonstopBgaTimelines: readonly NonstopStageBgaTimeline[] | undefined;
  readonly assetsLoading: boolean;
  readonly exiting: boolean;
  readonly exitFadeStartedAt: number | undefined;
  readonly exitFadeOutMs: number;
  readonly playMoments: { readonly failedAtMs?: number };
  /**
   * The windows the engine judges the play by (its judge ruleset's, after the debug override), once it has started;
   * the timing visualizer's bands show the key lanes' ones.
   */
  readonly judgeWindows: BeMusicJudgeWindows | undefined;
  readonly disposed: boolean;
  playClock(): number;
  resolveSongDurationSeconds(): number;
}

/** What the beatoraja play view draws with besides its kit. */
export interface BeatorajaPlayViewOptions {
  /** The play is AUTO PLAY. */
  readonly autoPlay?: boolean;
  /** DP FLIP: the chart's sides swap, for the skin's per-side readouts (the notes come flipped from the session). */
  readonly dpFlip?: boolean;
  /** The course the play is a stage of, with the stage being played. */
  readonly course?: CourseView;
  /** The stages of a stitched NONSTOP chart (`PlaySessionOptions.nonstop`), whose BGA cross-fades at each seam. */
  readonly nonstop?: { readonly stages: readonly NonstopBgaStage[] };
  /** Where the chart's files are, for its `#STAGEFILE`, `#BACKBMP` and `#BANNER`. */
  readonly source?: BrowserSongAssetSource;
  /** Where the skin's Lua sounds play (`main_state.audio_*`); they are silent without it. */
  readonly skinSounds?: BeatorajaSkinAudio;
}

/** What the view works out of the chart once it is prepared. */
interface PreparedChart {
  readonly chart: BeMusicJson;
  readonly analysis: BeatorajaChartNoteDistribution;
  readonly bpmCurve: readonly BpmCurvePoint[];
  readonly layout: BeatorajaPlayChartLayout;
}

/** The beatoraja play view. See the module comment. */
export class BeatorajaPlayView implements PlayView {
  public readonly family = 'beatoraja' as const;
  public readonly root: Container = new Container();
  public readonly timing: PlayViewTiming;
  /** How the view answers the session: the skin's canvas and the beam fade. */
  public readonly playfieldSkin: PlayfieldSkin;
  /**
   * The canvas under the fingers: no touch lanes (the skin owns its lanes and lays none out for the playfield), but a
   * finger still keeps the page from scrolling or zooming, as on every play screen.
   */
  private readonly touchLanes: TouchLaneInput = new TouchLaneInput({
    stage: () => this.playfieldSkin.stage,
    lanes: () => [],
    liftCount: () => 0,
  });
  private kit: BeatorajaKit;
  private readonly play: BeatorajaPlayRuntime;
  private readonly options: BeatorajaPlayViewOptions;
  private readonly chartImages: BeatorajaViewChartImages;
  private prepared: PreparedChart | undefined;
  private bridge: BeatorajaPlayBridge | undefined;
  private stage: BeatorajaPlayStage | undefined;
  private host: PixiSceneHost | undefined;
  /** The host the play loads on, for the GPU upload of its BGA before the view is attached. */
  private uploadHost: PixiSceneHost | undefined;
  private emit: IntentSink<PlayIntent> | undefined;
  /** READY has been reached: the notes stand at the chart's start until the engine's first frame. */
  private loaded = false;
  private wasPaused = false;
  private state: PlayState | undefined;
  private indicator: Text | undefined;
  private indicatorShownAt = 0;
  private disposed = false;

  public constructor(kit: BeatorajaKit, play: BeatorajaPlayRuntime, options: BeatorajaPlayViewOptions = {}) {
    this.kit = kit;
    this.play = play;
    this.options = options;
    this.timing = resolveBeatorajaPlayTiming(kit.kit.skin);
    this.chartImages = new BeatorajaViewChartImages(play.song, options.source);
    const skin = kit.kit.skin;
    this.playfieldSkin = {
      stage: {
        width: typeof skin.w === 'number' && skin.w > 0 ? skin.w : DESIGN_WIDTH,
        height: typeof skin.h === 'number' && skin.h > 0 ? skin.h : DESIGN_HEIGHT,
      },
      ownsLanes: true,
      laneRect: () => undefined,
      noteCell: () => undefined,
      measureLines: () => undefined,
      bgaTargets: () => {},
      bombCell: () => undefined,
      bombDurationMs: () => 0,
      keyOnFadeMs: () => KEY_ON_FADE_OUT_MS,
    };
  }

  /** Keeps `host` for the GPU upload of what the play loads before the view is attached. */
  public prepareOn(host: PixiSceneHost): void {
    this.uploadHost = host;
  }

  /**
   * Gets the skin ready for the play once its chart is prepared (the session's `prepareView`): the chart as the play
   * plays it (DP FLIP applied for the skin's per-side readouts), its BPM graph, note distribution, markers and scroll,
   * the bridge, the skin with the notes and markers, and the chart's own images.
   */
  public async prepare(): Promise<void> {
    if (this.disposed || this.prepared !== undefined) return;
    const play = this.play;
    const resolved = play.resolvedChart ?? play.song?.chart;
    if (resolved === undefined) return;
    const chart = this.options.dpFlip === true ? flipDpChart(resolved) : resolved;
    const skin = this.kit.kit.skin;
    const scrollMapper = createBeatorajaScrollMapper(chart);
    const laneTimelines = scrollMapper !== undefined ? createBeatorajaLaneTimelines(chart) : undefined;
    const timeMarkers = normalizeBeatorajaNote(skin.note).time.length > 0;
    this.prepared = {
      chart,
      analysis: computeBeatorajaChartNoteDistribution(chart),
      bpmCurve: computeBeatorajaBpmCurve(chart),
      layout: {
        variant: play.chartPlayVariant,
        scrollMapper,
        timelineBeats: laneTimelines?.beats,
        beatToSeconds: laneTimelines?.beatToSeconds,
        reversal: play.resolvedPlayChart?.reversal,
        // One-second time ticks when the skin authors `time[]` markers.
        markers: computeBeatorajaChartMarkers(chart, {
          timeIntervalSec: timeMarkers ? 1 : undefined,
          totalSeconds: undefined,
        }),
        autoPlay: this.options.autoPlay === true,
      },
    };
    this.bridge = this.createBridge(chart);
    this.buildStage();
    log.info('beatoraja play prepared', {
      variant: play.chartPlayVariant,
      skin: { w: this.stage?.width, h: this.stage?.height, name: skin.name },
      autoPlay: this.options.autoPlay === true,
    });
    await this.chartImages.load();
  }

  private createBridge(chart: BeMusicJson): BeatorajaPlayBridge {
    const { skin, skinConfig } = this.kit.kit;
    // The LIFT and HIDDEN+ move across the lane's height: the skin's lane cover slider range.
    const laneHeight = normalizeBeatorajaSliders((skin as { slider?: unknown }).slider).find(
      (s) => s.type === 4,
    )?.range;
    const bridge = new BeatorajaPlayBridge({
      chartPlayVariant: this.play.chartPlayVariant,
      baseOps: resolveSkinConfigOps(skinConfig, this.options.course),
      autoPlay: this.options.autoPlay === true,
      chart,
      skinHeaderName: skin.name,
      skinHeaderAuthor: skin.author,
      directoryLabel: this.play.song?.directoryLabel,
      ...(this.options.course !== undefined ? { courseInfo: this.options.course } : {}),
      ...(laneHeight !== undefined ? { laneHeight } : {}),
      judgeComboMetrics: readJudgeComboMetrics(skin),
      ...(this.options.skinSounds !== undefined ? { skinSounds: this.options.skinSounds } : {}),
    });
    applyCustomOffsets(bridge, skin.offset, skinConfig?.customOffset);
    return bridge;
  }

  /** Builds the stage for the kit's skin (again, after the player changed its options) and puts it in the root. */
  private buildStage(): void {
    const prepared = this.prepared;
    const bridge = this.bridge;
    if (prepared === undefined || bridge === undefined) return;
    const previous = this.stage;
    const kit = this.kit.kit;
    const analysis = prepared.analysis;
    const stage = new BeatorajaPlayStage(
      kit,
      resolveSkinConfigOps(kit.skinConfig, this.options.course),
      prepared.layout,
      {
        resolveRefValue: (ref) => bridge.resolveRefValue(ref),
        resolveTextContent: (ref) => bridge.resolveTextContent(ref),
        resolveNumberValue: (ref) => bridge.resolveNumberValue(ref),
        resolveFontFamily: kit.fonts !== undefined ? (id) => kit.fonts!.family(id) : undefined,
        resolveFontKind: kit.fonts !== undefined ? (id) => kit.fonts!.kind(id) : undefined,
        resolveGraphValue: (type) => bridge.resolveGraphValue(type),
        resolveGraphPolyline: (type) => bridge.resolveGraphPolyline(type),
        resolveSliderValue: (type) => bridge.resolveSliderValue(type),
        resolveGaugePercent: () => bridge.resolveGaugePercent(),
        resolveBpmGraphPoints: () => prepared.bpmCurve,
        resolveBpmGraphData: () =>
          analysis.bpmSegments.length === 0 || analysis.totalMs <= 0
            ? undefined
            : {
                segments: analysis.bpmSegments,
                mainBpm: analysis.mainBpm,
                minBpm: analysis.minBpm,
                maxBpm: analysis.maxBpm,
                totalMs: analysis.totalMs,
              },
        resolveJudgeGraphBars: (type) => bridge.resolveJudgeGraphBars(type),
        resolveJudgeStateBuckets: (type) => bridge.resolveJudgeStateBuckets(type),
        resolveNoteDistribution: () =>
          analysis.buckets.length === 0
            ? undefined
            : { buckets: analysis.buckets, maxCount: analysis.maxCount, totalMs: analysis.totalMs },
        resolveTimingSamples: () => bridge.resolveTimingSamples(),
        resolveTimingJudgeWindows: () => bridge.resolveTimingJudgeWindows(),
        // The playhead on `bpmgraph` / `notes-graph`, from the engine's frame; hidden before its first.
        resolveCurrentTimeMs: () => {
          const seconds = this.play.engineFrame?.currentSeconds;
          return seconds !== undefined && Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : undefined;
        },
        chartImageProvider: (id) => this.chartImages.resolve(id),
        onButtonAction: (act, modifiers) => this.handleSkinButton(act, modifiers),
      },
    );
    if (previous !== undefined) {
      previous.dispose();
      if (!this.play.assetsLoading) stage.addBga(this.bgaOf());
    }
    this.stage = stage;
    this.root.addChildAt(stage.root, 0);
  }

  /** The session's BGA as the BGA layer draws it; a key drawn only on the layer track uses its layer texture. */
  private bgaOf(): BeatorajaPlayBga {
    const play = this.play;
    const nonstop = this.options.nonstop;
    return {
      textures: new Map<string, Texture>([...play.bgaLayerTextures, ...play.bgaTextures]),
      videos: new Map([...play.bgaVideos].map(([key, { video }]) => [key, video] as const)),
      cues: play.bgaTimeline,
      ...(nonstop !== undefined && play.nonstopBgaTimelines !== undefined
        ? { nonstop: { stages: nonstop.stages, timelines: play.nonstopBgaTimelines } }
        : {}),
    };
  }

  public attach(host: PixiSceneHost, emit: IntentSink<PlayIntent>): void {
    if (this.disposed) return;
    this.host = host;
    this.emit = emit;
    if (typeof window !== 'undefined') window.addEventListener('wheel', this.handleWheel, { passive: false });
    this.touchLanes.attach(host, emit);
  }

  public detach(): void {
    this.touchLanes.detach();
    if (typeof window !== 'undefined') window.removeEventListener('wheel', this.handleWheel);
    this.host = undefined;
    this.emit = undefined;
  }

  public draw(frame: PlayFrame): void {
    const stage = this.stage;
    const bridge = this.bridge;
    const host = this.host;
    this.root.visible = frame.shown;
    if (stage === undefined || bridge === undefined || host === undefined || !frame.shown || this.disposed) return;
    stage.fitTo(host);
    const play = this.play;
    this.state = frame.state;
    for (const event of frame.events) {
      if (event.kind === 'load-end') this.loaded = true;
      else if (event.kind === 'view-setting') this.showViewSetting(event.setting, frame.state);
    }
    // The BGA goes in once it has loaded (before READY), and its video plays on after a pause.
    if (!stage.hasBga && !play.assetsLoading) stage.addBga(this.bgaOf());
    const paused = frame.stage === 'paused';
    if (this.wasPaused && !paused) stage.resumeBga();
    this.wasPaused = paused;
    const context = bridge.update({
      nowMs: play.playClock(),
      hostNowMs: frame.clock.nowMs,
      state: frame.state,
      ...withEngine(this.engineInput()),
      ...(play.judgeWindows !== undefined ? { judgeWindows: play.judgeWindows } : {}),
      events: frame.events,
    });
    // The notes stand at the chart's start from READY until the engine's first frame, as the engine's lead-in held them.
    const engineFrame = play.engineFrame;
    const clock = engineFrame ?? (this.loaded ? { notes: play.notes, currentSeconds: 0, currentBeat: 0 } : undefined);
    stage.draw(context, clock, play.scrollHiSpeed.valueAt(performance.now()), bridge);
    // A failed play's picture fades with its sound; on a normal end the skin draws its own fade-out.
    if (play.exiting && play.playMoments.failedAtMs !== undefined && play.exitFadeStartedAt !== undefined) {
      stage.canvas.alpha = playEndingFadeAlpha(play.playClock() - play.exitFadeStartedAt, play.exitFadeOutMs);
    }
    this.fadeIndicator();
  }

  /**
   * The engine's frame as the bridge reads it, with the song's length the play state's graphs run over; from READY
   * until the engine's first frame, the chart's start with the play's starting score and gauge.
   */
  private engineInput(): BeatorajaPlayEngineInput | undefined {
    const play = this.play;
    const frame = play.engineFrame;
    const totalSeconds = play.resolveSongDurationSeconds();
    if (frame !== undefined) {
      return {
        currentSeconds: frame.currentSeconds,
        currentBeat: frame.currentBeat,
        totalSeconds,
        ...(frame.reversalSeconds !== undefined ? { reversalSeconds: frame.reversalSeconds } : {}),
        summary: frame.summary,
      };
    }
    if (!this.loaded) return undefined;
    return { currentSeconds: 0, currentBeat: 0, totalSeconds, summary: { ...play.score, gauge: play.gaugeState } };
  }

  /** Uploads `textures` to the GPU through the host's renderer, when the view has a host. */
  public uploadTextures(textures: Iterable<Texture | undefined>, isCancelled: () => boolean): Promise<void> {
    return uploadTextures((this.host ?? this.uploadHost)?.app.renderer, textures, isCancelled);
  }

  /**
   * The beatoraja scale the play log reads the hi-speed on: a lane of four beats. The session takes the visible time at
   * the play's main BPM, as on every family's play screen.
   */
  public playlogView(): PlayPlaylogViewScale {
    return BEATORAJA_PLAYLOG_VIEW;
  }

  /**
   * Takes the player's new options for the skin: the skin is built again with them (its textures and fonts from the new
   * kit) while the play and its bridge carry on, the option ops and the custom offsets replaced. A kit of another skin
   * entry is taken the same way.
   */
  public updateKit(kit: BeatorajaKit): void {
    if (this.disposed) return;
    this.kit = kit;
    const bridge = this.bridge;
    if (bridge === undefined) return;
    bridge.setBaseOps(resolveSkinConfigOps(kit.kit.skinConfig, this.options.course));
    applyCustomOffsets(bridge, kit.kit.skin.offset, kit.kit.skinConfig?.customOffset);
    this.buildStage();
    log.info('beatoraja play skin replaced', {
      canvas: { w: this.stage?.width, h: this.stage?.height },
      name: kit.kit.skin.name,
    });
  }

  public getStageInfo(): { container: Container; width: number; height: number } {
    return this.stage?.getStageInfo() ?? { container: this.root, ...this.playfieldSkin.stage };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.detach();
    this.disposed = true;
    this.stage?.dispose();
    this.stage = undefined;
    this.chartImages.dispose();
    this.indicator?.destroy();
    this.indicator = undefined;
    if (!this.root.destroyed) this.root.destroy({ children: false });
  }

  /** A skin's cover button (`LANECOVER` / `LIFT` / `HIDDEN`): a step of the cover, back with Shift. */
  private handleSkinButton(act: number, modifiers?: { shift: boolean; ctrl: boolean; alt: boolean }): void {
    const emit = this.emit;
    if (emit === undefined) return;
    const delta = (modifiers?.shift === true ? -1 : 1) * COVER_BUTTON_STEP;
    switch (act) {
      case BUTTON_LANECOVER:
        emit({ type: 'cover', command: { type: 'cover-adjust', part: 'sudden', delta } });
        return;
      case BUTTON_LIFT:
        emit({ type: 'cover', command: { type: 'cover-adjust', part: 'lift', delta } });
        return;
      case BUTTON_HIDDEN: {
        // HIDDEN+ off comes on at one step; on, it steps, going off at nothing. A course's lock holds it.
        const state = this.state;
        const covers = state?.view.covers ?? [];
        if (state?.view.hiSpeed.locked === true) return;
        if (covers.some((cover) => cover.hiddenOn)) {
          emit({ type: 'cover', command: { type: 'cover-adjust', part: 'hidden', delta } });
        } else {
          emit({
            type: 'cover',
            command: {
              type: 'cover-set',
              covers: covers.map((cover) => ({ side: cover.side, hidden: COVER_BUTTON_STEP, hiddenOn: true })),
            },
          });
        }
        return;
      }
    }
  }

  /** The mouse wheel moves SUDDEN+: down covers more of the lane, up less; faster with Shift. */
  private readonly handleWheel = (event: WheelEvent): void => {
    if (event.deltaY === 0) return;
    event.preventDefault();
    const step = event.shiftKey ? WHEEL_COVER_STEP_SHIFT : WHEEL_COVER_STEP;
    this.emit?.({
      type: 'cover',
      command: { type: 'cover-adjust', part: 'sudden', delta: (event.deltaY > 0 ? 1 : -1) * step },
    });
  };

  /** Shows what a key set, for a moment: the lane cover, the LIFT, HIDDEN+ or the hi-speed. */
  private showViewSetting(setting: PlayViewSetting, state: PlayState): void {
    const cover = state.view.covers.find((entry) => entry.side === '1P') ?? state.view.covers[0];
    const percent = (fraction: number | undefined): number => Math.round((fraction ?? 0) * 100);
    let text: string;
    switch (setting) {
      case 'sudden':
        text = `Lanecover ${percent(cover?.sudden)}%`;
        break;
      case 'lift':
        text = `Lift ${percent(cover?.lift)}%`;
        break;
      case 'hidden-toggle':
        text = cover?.hiddenOn === true ? `Hidden cover ON (${percent(cover.hidden)}%)` : 'Hidden cover OFF';
        break;
      case 'hidden':
        text = cover?.hiddenOn === true ? `Hidden cover ${percent(cover.hidden)}%` : 'Hidden cover OFF';
        break;
      case 'hi-speed':
        text = `Hi-Speed ×${state.view.hiSpeed.player.toFixed(2)}`;
        break;
    }
    const indicator = this.indicatorNode();
    indicator.text = text;
    // Placed again each time: the skin's canvas size, in the root's (unscaled) space.
    indicator.x = (this.stage?.width ?? 0) / 2;
    indicator.y = (this.stage?.height ?? 0) * 0.2;
    indicator.alpha = 1;
    indicator.visible = true;
    this.indicatorShownAt = performance.now();
  }

  private indicatorNode(): Text {
    if (this.indicator === undefined) {
      const node = new Text({
        text: '',
        style: {
          fontFamily: 'sans-serif',
          fontSize: 28,
          fill: 0xffe066,
          fontWeight: '700',
          stroke: { color: 0x000000, width: 4 },
        },
      });
      node.anchor.set(0.5, 0.5);
      node.eventMode = 'none';
      this.root.addChild(node);
      this.indicator = node;
    }
    return this.indicator;
  }

  private fadeIndicator(): void {
    const indicator = this.indicator;
    if (indicator === undefined || !indicator.visible) return;
    const elapsed = performance.now() - this.indicatorShownAt;
    if (elapsed < INDICATOR_HOLD_MS) indicator.alpha = 1;
    else if (elapsed < INDICATOR_HOLD_MS + INDICATOR_FADE_MS) {
      indicator.alpha = 1 - (elapsed - INDICATOR_HOLD_MS) / INDICATOR_FADE_MS;
    } else indicator.visible = false;
  }
}

function withEngine(engine: BeatorajaPlayEngineInput | undefined): { engine?: BeatorajaPlayEngineInput } {
  return engine !== undefined ? { engine } : {};
}

/**
 * Hands the bridge the player's custom offsets (`BeatorajaSkinConfig.customOffset`) by the skin's offset ids
 * (`header.offset[]`): the axes each slot exposes, so a destination that lists the id (`offsets: [50]`) moves.
 */
export function applyCustomOffsets(
  bridge: Pick<BeatorajaPlayBridge, 'setOffset'>,
  schema: ReadonlyArray<BeatorajaSkinCustomOffset> | undefined,
  picks: BeatorajaSkinConfig['customOffset'],
): void {
  if (schema === undefined || schema.length === 0 || picks === undefined) return;
  for (const slot of schema) {
    const axes = picks[slot.name];
    if (axes === undefined) continue;
    const next: Partial<{ x: number; y: number; w: number; h: number; r: number; a: number }> = {};
    if (slot.x && axes.x !== undefined) next.x = axes.x;
    if (slot.y && axes.y !== undefined) next.y = axes.y;
    if (slot.w && axes.w !== undefined) next.w = axes.w;
    if (slot.h && axes.h !== undefined) next.h = axes.h;
    if (slot.r && axes.r !== undefined) next.r = axes.r;
    if (slot.a && axes.a !== undefined) next.a = axes.a;
    bridge.setOffset(slot.id, next);
  }
}

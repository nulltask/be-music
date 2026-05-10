// Gameplay scene for a beatoraja play skin.
//
// Composition:
//
//     PixiBeatorajaGameplayView
//     ├── BeatorajaPlaySkinView                  ← static + cycle-animated chrome (lane chrome, judge plate, key beams)
//     ├── BeatorajaRuntimeAdapter                ← engine signals → activeOps / timer-start map / text-ref
//     └── runEngineDriver                        ← audio + input + chart playback (manual / auto)
//
// The view drives the skin from the engine's UI signals every Pixi tick. Three signal kinds flow through:
//
//   - `frame` (currentSeconds, summary, notes[]) — latched into the adapter so text / value resolvers can
//     read combo / score / per-lane judge counts.
//   - `commands` (press-lane / release-lane / flash-lane / hold-lane-until-beat / poor-bga) — folded into
//     the adapter's per-lane timer slots.
//   - `judge-combo` publishes — fold into the per-side judge timer + last-judge op gate.
//
// `drainWebUiSignals` does the polling so the engine doesn't have to call back into the renderer on its
// own clock. The adapter keeps a single mutable `activeOps` Set + timer Map; `view.update(ctx)` re-samples
// every destination keyframe against the current state.
//
// Notes / BGA / fallback chrome are not yet wired here — the skin paints lane backgrounds, key-beam
// glows, judge plates and HUD text from the engine state, but the actual scrolling notes and BGA video
// land in follow-up patches that add a sub-container layered on top of the skin view.

import { Container, Graphics, Text, type Ticker } from 'pixi.js';
import type { BeMusicJson } from '@be-music/json';
import type {
  BeatorajaImageElement,
  BeatorajaImageId,
  BeatorajaSkin,
  BeatorajaSkinConfig,
  BeatorajaSkinCustomOffset,
} from '@be-music/beatoraja-skin';
import {
  buildBaseOpSet,
  normalizeBeatorajaImages,
  normalizeBeatorajaNote,
  normalizeBeatorajaSliders,
} from '@be-music/beatoraja-skin';
import type { BeatorajaSkinAudio } from './beatoraja-skin-audio.ts';
import type { BeatorajaPlayableVariant } from './beatoraja-theme.ts';
import { BeatorajaNoteLayer } from './pixi-beatoraja-notes.ts';
import { BeatorajaMarkerLayer, BEATORAJA_MARKER_PIXELS_PER_BEAT } from './pixi-beatoraja-markers.ts';
import { computeBeatorajaChartMarkers } from './beatoraja-chart-markers.ts';
import { computeBeatorajaBpmCurve, type BpmCurvePoint } from './beatoraja-chart-bpm-curve.ts';
import {
  computeBeatorajaChartNoteDistribution,
  type BeatorajaChartNoteDistribution,
} from './beatoraja-chart-note-distribution.ts';
import { flipDpChart } from './beatoraja-chart-dp-flip.ts';
import { BeatorajaBgaLayer } from './pixi-beatoraja-bga.ts';
import type { BgaCue } from './pixi-gameplay-bga.ts';
import type { Texture } from 'pixi.js';
import type { BeatorajaFontCache } from './beatoraja-fonts.ts';
import type { PlayerOptions, PlayerSummary } from '@be-music/player/core/engine';
import type { PlayerInputSignalBus } from '@be-music/player/core/input-signal-bus';
import type { PlayerStateSignals } from '@be-music/player/state-signals';
import type { PlayerUiFramePayload, PlayerUiSignalBus } from '@be-music/player/core/ui-signal-bus';
import { runEngineDriver, type EngineDriverAudioContext, type EngineDriverResult } from './engine-driver.ts';
import { BeatorajaRuntimeAdapter } from './beatoraja-runtime-adapter.ts';
import { BeatorajaPlaySkinView } from './pixi-beatoraja-skin-view.ts';
import type { BeatorajaTextureCache } from './beatoraja-textures.ts';
import { GameplayRecorder, type GameplayRecorderResult } from './gameplay-recorder.ts';
import { HISPEED_MAX, HISPEED_MIN } from './pixi-gameplay-constants.ts';
import { drainWebUiSignals } from './web-ui-runtime.ts';
import { logger } from './logger.ts';
import type { PixiScene, PixiSceneHost } from './pixi-scene-host.ts';

const log = logger('beatoraja-gameplay');

export interface PixiBeatorajaGameplayViewOptions {
  // Skin / textures
  skin: BeatorajaSkin;
  textures: BeatorajaTextureCache;
  /** Confirmed user picks for the skin's option dialog. Drives `buildBaseOpSet`. */
  skinConfig?: BeatorajaSkinConfig;
  /**
   * Play variant the chart resolves to. Only the subset {@link BeatorajaPlayableVariant} the engine can
   * actually drive (no 24-key) is accepted — mirrors {@link ChartPlayVariant} verbatim so the runtime
   * adapter's lane-resolution stays in sync with the engine's own channel mapping.
   */
  variant: BeatorajaPlayableVariant;

  // Engine driver inputs
  chart: BeMusicJson;
  audio: EngineDriverAudioContext;
  mode: 'manual' | 'auto';
  /**
   * Optional DP-flip flag. When `true` AND the chart is a DP variant (10 / 14 keys), the
   * chart's lane channels are mirrored before the engine consumes them — `1X ↔ 2X` for
   * visible / invisible / LN / landmine slots. Pure SP charts are unaffected (no
   * 2P channels to swap with). Mirrors beatoraja's `Config.flipMode`.
   *
   * Default `false`. Hosts wire this to a UI toggle (the demo's keymode-options panel
   * surfaces it on a top-level setting).
   */
  dpFlip?: boolean;
  /** Optional song directory label (e.g. parent folder name). Surfaces `BEATORAJA_TEXT.DIRECTORY = 1000`. */
  directoryLabel?: string;
  inputTarget?: EventTarget;
  shouldSkipKey?: (event: KeyboardEvent) => boolean;
  engineOptions?: Omit<PlayerOptions, 'createAudioSession' | 'createInputRuntime' | 'createUiRuntime' | 'auto'>;

  /**
   * Pre-loaded skin TTF cache, keyed by `font[].id`. Built via `loadBeatorajaFonts` (parallel to the
   * texture cache). Omitting it falls back to the platform sans-serif on every text destination.
   */
  fonts?: BeatorajaFontCache;

  // BGA inputs (optional — omitting means no BGA paints, only the skin chrome + notes)
  /**
   * Pre-decoded BGA textures keyed by `#BMPxx` slot label. The host typically builds this once via the
   * same `decodeBmpTextures` helper the LR2 path uses; the gameplay view treats it as read-only and
   * never disposes the textures.
   */
  bgaTextures?: ReadonlyMap<string, Texture>;
  /**
   * Optional `<video>` elements keyed by `#BMPxx` slot, for chart-shipped video BGAs (mp4 /
   * webm / etc.). Sparse — only video keys present. The BGA layer pauses / plays / seeks
   * the matching element when its texture becomes the active cue. Empty / undefined when
   * the chart has no video BGAs (or when the host opts to skip video decode).
   */
  bgaVideoElements?: ReadonlyMap<string, HTMLVideoElement>;
  /**
   * Pre-decoded chart imagery for the synthetic-id slots `-100 STAGEFILE` / `-101 BACKBMP` /
   * `-102 BANNER`. ModernChic's `Play/lua/sp/cover.lua` paints the stagefile as the lane-cover
   * backing; default's `play_parts.lua` references `-100` for "loading" chrome. Missing entries
   * hide the matching destinations.
   */
  chartImages?: {
    stageFile?: Texture;
    backBmp?: Texture;
    banner?: Texture;
  };
  /** Chart-time BGA cues from `buildBgaTimeline(chart, resolver)`. Required when {@link bgaTextures} is set. */
  bgaCues?: { base: ReadonlyArray<BgaCue>; layer: ReadonlyArray<BgaCue>; poor: ReadonlyArray<BgaCue> };

  // Lifecycle hooks
  /** Called when the user requests exit (ESC) — the host should navigate away after the engine resolves. */
  onExit?: () => void;
  /**
   * Called once the engine resolves with a chart-end summary. `maxCombo` is plumbed alongside
   * because `PlayerSummary` doesn't carry it (it's a derived value the adapter latches from the
   * judge-state stream); result scenes need both halves to render the final score block.
   *
   * `history` carries the per-judge `(progress, exScore)` and `(progress, gauge%)` polylines the
   * adapter accumulated during the run — result skins consume these for score-over-time graph
   * elements (`graph[].type = 110` / `113` / `115` in beatoraja's reference). Empty arrays when
   * the run produced no judges.
   */
  onComplete?: (
    summary: PlayerSummary,
    maxCombo: number,
    history: {
      scoreHistory: ReadonlyArray<{ progress: number; exScore: number }>;
      gaugeHistory: ReadonlyArray<{ progress: number; value: number }>;
      timingHistory: ReadonlyArray<{ deltaMs: number; kind: string }>;
    },
  ) => void;
  /** Called if the engine rejects (interrupt or fatal) — the host can branch on the error type. */
  onError?: (error: unknown) => void;
  /**
   * Optional audio backend for `main_state.audio_play / loop / stop` Lua calls. Distinct from
   * {@link audio} — that field carries the engine's chart-audio context (BGM mixing, key
   * sounds), this carries the SE backend the skin's Lua scripts call into.
   */
  skinAudio?: BeatorajaSkinAudio;
}

export class PixiBeatorajaGameplayView implements PixiScene {
  readonly root = new Container();
  /**
   * Backdrop that fills the full canvas behind the (letterboxed) skin container. The Pixi `Application`
   * runs with `backgroundAlpha: 0` so all scenes share a transparent canvas and decide for themselves
   * what to paint behind their content. Without this Graphics, the page's white background bleeds into
   * the letterbox bars on either side of a 16:9 skin in a non-16:9 viewport — which makes the rendered
   * area look narrower than it actually is and was the most likely cause of "ステージサイズがおかしい"
   * after the chrome was rendering correctly.
   */
  private readonly backdrop = new Graphics();
  // Visual layers — re-built in `replaceSkin` so option changes can hot-swap the chrome without
  // tearing down the engine driver.
  private view: BeatorajaPlaySkinView;
  private noteLayer: BeatorajaNoteLayer;
  /**
   * Lane markers — section lines, BPM-change indicators, STOP markers, optional time ticks.
   * Drawn UNDER the note layer (via insertion order) so notes overlay markers, matching
   * beatoraja's reference layering. Beat positions come from `chartMarkers` (computed once at
   * construction); the layer only updates sprite positions per frame.
   */
  private markerLayer: BeatorajaMarkerLayer;
  private readonly chartMarkers: ReturnType<typeof computeBeatorajaChartMarkers>;
  /**
   * Chart's BPM curve as a polyline in `[0, 1]²` — computed once at construction and handed to
   * the play skin view's `resolveBpmGraphPoints` so any `bpmgraph[]` element gets a real curve
   * to plot. Static for the lifetime of the scene; the view caches the stroke after first paint.
   */
  private readonly chartBpmCurve: ReadonlyArray<BpmCurvePoint>;
  /**
   * Spec-faithful note-distribution + BPM-segment analysis (per-second × per-category histogram
   * matching beatoraja's `notes-graph` / `judgegraph type=0`, plus the `bpmgraph` segments with
   * mainBpm/min/max identity). Computed once at construction; both the initial view and
   * `replaceSkin` re-use it through `resolveNoteDistribution` / `resolveBpmGraphData`.
   */
  private readonly chartAnalysis: BeatorajaChartNoteDistribution;
  private bgaLayer: BeatorajaBgaLayer | undefined;
  private readonly adapter: BeatorajaRuntimeAdapter;
  private readonly options: PixiBeatorajaGameplayViewOptions;
  private currentFrame: PlayerUiFramePayload | null = null;
  private hiSpeed = 1;
  private host?: PixiSceneHost;
  private startMs = 0;
  private tickerHandle?: (ticker: Ticker) => void;
  private uiSignals?: PlayerUiSignalBus;
  private stateSignals?: PlayerStateSignals;
  private inputSignals?: PlayerInputSignalBus;
  private lastJudgeComboTick = 0;
  private enginePromise?: Promise<EngineDriverResult>;
  private engineSettled = false;
  private exitRequested = false;
  private disposed = false;
  /**
   * Frame-counter for periodic-summary debug logs. Avoids per-tick spam by gating heavy summaries on
   * a multiple-of-300 (~5 s at 60 fps) frame counter.
   */
  private debugFrameCounter = 0;
  /**
   * Active canvas + audio recorder when the host has called {@link startRecording}. Tied to
   * the `audio.audioContext` / `audio.audioBus.outputNode` passed at construction so the
   * captured audio matches what the player hears (the bus's `outputNode` is the same node
   * the speakers tap, regardless of compressor mode).
   *
   * `undefined` while idle. We hold the instance across the play session so {@link
   * stopRecording} / {@link dispose} can finalize cleanly even if the chart ends or the
   * scene unmounts mid-recording.
   */
  private recorder: GameplayRecorder | undefined;
  /**
   * Last screen size we ran `fitToStage` against. The Pixi `Application` is `resizeTo: container`, which
   * means the canvas can resize asynchronously after `enter()` (e.g. when the demo's gameplay scene
   * mounts before the layout settles, or when the user resizes the window mid-chart). We re-fit on every
   * tick when the screen has actually changed; same idiom the LR2 path uses.
   */
  private lastFitWidth = 0;
  private lastFitHeight = 0;

  constructor(options: PixiBeatorajaGameplayViewOptions) {
    // Apply DP flip to the chart BEFORE anything else consumes it. The transform swaps
    // `1X ↔ 2X` (and 3/4, 5/6, D/E) channel sides — pure SP charts have no 2P channels to
    // swap with so the transform is a fast-path no-op. Re-stash the flipped chart on a
    // copy of `options` so all downstream consumers (engine driver, BPM curve, markers,
    // BGA timeline) see the same flipped chart.
    const effectiveChart = options.dpFlip === true ? flipDpChart(options.chart) : options.chart;
    this.options = effectiveChart === options.chart ? options : { ...options, chart: effectiveChart };

    // Skin-config-level op set built ONCE from the user's selected skin options. Threaded into
    // every consumer that runs `normalizeBeatorajaDestinations` (the play-skin view, BGA layer,
    // marker layer) so inner if-gated keyframe alternatives — beatoraja's per-layout BGA /
    // lane-position presets — pick the variant matching the user's chosen options. Without it
    // the resolver falls back to the catch-all alternative, which silently mismatches when the
    // skin's default layout isn't the user's preference (e.g. compact-BGA setting selected but
    // BGA paints at full-layout coordinates).
    const skinConfigOps = buildBaseOpSet(options.skinConfig?.option);

    // Adapter is constructed first so the skin view can route ref/text resolvers through it. The clock
    // captures `getNowMs` as a closure that reads `this.startMs`, which is set at `enter()` time — until
    // then, `getNowMs()` returns negative values. That's fine; the skin view only samples after `enter()`.
    // Lane-height hint comes from the skin's lanecover slider range (= `slider[].type = 4`'s
    // `range` field, the canonical authored value). The adapter scales `OFFSET_LIFT.y` against
    // this so a `liftRatio = 1` shifts the hidden-cover edge by exactly one lane on whatever
    // skin is mounted, not just the reference theme's 580.
    const sliderDefs = normalizeBeatorajaSliders((options.skin as { slider?: unknown }).slider);
    const lanecoverSliderRange = sliderDefs.find((s) => s.type === 4)?.range;
    // Per-side judge combo digit metrics (`{width, space}` from the matching `value[]`
    // declaration referenced by `judge[].numbers[0].id`). Drives the synthetic
    // judge-word-shift offset that honors `judge[].shift = true` per upstream
    // `SkinJudge.java:108-109`'s `nowJudge.region.x += -nowCount.getLength() / 2`
    // formula. Defaults `(width=40, space=0)` cover default skin's `play5.json` /
    // `play7main.lua`.
    const judgeComboMetrics = readJudgeComboMetrics(options.skin);
    this.adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: options.variant,
      baseOps: skinConfigOps,
      getNowMs: () => performance.now() - this.startMs,
      autoPlay: options.mode === 'auto',
      chart: effectiveChart,
      // Surface skin / directory metadata so `BEATORAJA_TEXT.SKIN_NAME` / `SKIN_AUTHOR` /
      // `DIRECTORY` resolve to real strings on the play scene's chrome panels.
      skinHeaderName: options.skin.name,
      skinHeaderAuthor: options.skin.author,
      directoryLabel: options.directoryLabel,
      laneHeight: lanecoverSliderRange,
      judgeComboMetrics,
    });
    // Push the user's `customOffset` picks into the adapter's offset table KEYED BY ID. The
    // skin's `header.offset[]` declares each slot's `(name, id, axisFlags)`; the host config
    // carries per-name axis values. Walking both gives us numeric-id-keyed rows for the
    // renderer to consume via `resolveOffset(id)`. Without this, ModernChic-style author-
    // exposed sliders (e.g. `main_brightness.a`) only reach the Lua side via
    // `skin_config.offset[name]` — destinations referencing the slot id directly via
    // `offsets: [50]` see no shift.
    this.applyCustomOffsets(options.skin.offset, options.skinConfig?.customOffset);

    // BPM curve + note distribution analysis are static for the chart's lifetime — compute
    // both once here. Both the initial view and `replaceSkin` reuse them via the resolvers
    // below.
    this.chartBpmCurve = computeBeatorajaBpmCurve(effectiveChart);
    this.chartAnalysis = computeBeatorajaChartNoteDistribution(effectiveChart);
    this.view = new BeatorajaPlaySkinView({
      skin: options.skin,
      textures: options.textures,
      skinConfigOps,
      resolveRefValue: (ref) => this.adapter.resolveRefValue(ref),
      resolveTextContent: (ref) => this.adapter.resolveTextContent(ref),
      resolveNumberValue: (ref) => this.adapter.resolveNumberValue(ref),
      resolveFontFamily: options.fonts ? (id) => options.fonts!.family(id) : undefined,
      resolveFontKind: options.fonts ? (id) => options.fonts!.kind(id) : undefined,
      resolveGraphValue: (type) => this.adapter.resolveGraphValue(type),
      resolveGraphPolyline: (type) => this.adapter.resolveGraphPolyline(type),
      resolveSliderValue: (type) => this.adapter.resolveSliderValue(type),
      resolveGaugePercent: () => this.adapter.resolveGaugePercent(),
      resolveBpmGraphPoints: () => this.chartBpmCurve,
      resolveBpmGraphData: () => this.bpmGraphDataForCurrentChart(),
      resolveJudgeGraphBars: (type) => this.adapter.resolveJudgeGraphBars(type),
      resolveJudgeStateBuckets: (type) => this.adapter.resolveJudgeStateBuckets(type),
      resolveNoteDistribution: () => this.noteDistributionForCurrentChart(),
      resolveTimingSamples: () => this.adapter.resolveTimingSamples(),
      resolveTimingJudgeWindowsMs: () => this.adapter.resolveJudgeWindowsMs(),
      // Live playhead position drives the cursor on `bpmgraph` / `notes-graph`. Reads the
      // engine's currentSeconds latched into `currentFrame`; before the first frame lands
      // we return undefined so the cursor stays hidden.
      resolveCurrentTimeMs: () => this.currentTimeMsForCursor(),
      // Chart-image synthetic ids (-100 STAGEFILE / -101 BACKBMP / -102 BANNER). ModernChic
      // uses STAGEFILE under the lane cover; default skin's loading panel anchors on it too.
      // Missing entries return undefined → matching destinations stay hidden.
      chartImageProvider: (id) => resolveChartImage(this.options.chartImages, id),
      // Skin-authored cover-adjustment buttons (LANECOVER / LIFT / HIDDEN). Each click steps
      // the matching ratio; shift-click reverses direction. Without this routing, clicking
      // the skin's authored cover buttons during play was inert — the skin visualised the
      // press but the underlying offset stayed put.
      onButtonAction: (act, modifiers) => this.handleCoverButton(act, modifiers),
    });
    // Backdrop sits behind the skin container so the letterbox bars are filled with a stable color
    // instead of leaking the page's CSS background through.
    this.root.addChild(this.backdrop);
    this.root.addChild(this.view.container);

    // Note layer paints inside the skin's coordinate system so it scales / positions with the skin chrome.
    // Mounting onto `view.container` (rather than `this.root` directly) means `fitToStage`'s scale +
    // translation cascade applies to notes too, keeping the lane geometry in sync without a duplicate
    // transform.
    // Per-id `image[]` map for the note layer's per-lane sprite resolution. The skin's `note.note[]`
    // / `lnstart[]` / etc. lists are image-id strings (or numbers); the note layer looks them up here
    // to find the source rect to crop.
    const noteImageMap = new Map<BeatorajaImageId, BeatorajaImageElement>();
    for (const image of normalizeBeatorajaImages(options.skin.image)) {
      noteImageMap.set(image.id, image);
    }
    const noteSection = normalizeBeatorajaNote(options.skin.note);
    this.noteLayer = new BeatorajaNoteLayer({
      noteSection,
      variant: options.variant,
      images: noteImageMap,
      textures: options.textures,
      canvasHeight: this.view.height,
    });
    // Marker layer goes ON the same container as notes — insertion order makes markers paint
    // first, then notes paint on top. Authors expect this so a falling note can visually cross
    // the section line without the line obscuring the note.
    this.markerLayer = new BeatorajaMarkerLayer({
      group: noteSection.group,
      bpm: noteSection.bpm,
      stop: noteSection.stop,
      time: noteSection.time,
      images: noteImageMap,
      textures: options.textures,
      canvasHeight: this.view.height,
    });
    this.chartMarkers = computeBeatorajaChartMarkers(effectiveChart, {
      // 1-second time ticks when the skin authors `time[]` markers. Disabled when the skin
      // doesn't author them — the marker layer culls the empty list anyway.
      timeIntervalSec: noteSection.time.length > 0 ? 1 : undefined,
      totalSeconds: undefined,
    });
    // Insert at the skin's "notes anchor" so destinations declared AFTER the anchor (lanecover,
    // hidden-cover, score readouts, …) paint on top of the falling notes — matching beatoraja's
    // own z-order. Skins without a notes anchor get the legacy "notes always on top" behavior
    // because `noteLayerInsertIndex` defaults to `container.children.length`.
    insertNoteAndMarkerLayers(this.view, this.markerLayer, this.noteLayer);

    log.info('beatoraja gameplay mounted', {
      variant: options.variant,
      skin: { w: this.view.width, h: this.view.height, name: options.skin.name },
      autoPlay: options.mode === 'auto',
      bga: options.bgaTextures !== undefined && options.bgaCues !== undefined,
      fontsLoaded: options.fonts ? options.fonts.values().length : 0,
    });

    // BGA layer is spliced into the view's `container.children` at the index the skin
    // authored its `{id = bga.id}` destination — mirroring upstream's per-destination
    // z-order where later array entries paint on top. Without this anchor the layer
    // would land at index 0 and end up behind every authored backdrop (most visibly the
    // default skin's full-canvas `id = 1` playbg, which would completely cover the BGA).
    // Falls back to top-of-stack when the skin omits a BGA destination — same behaviour
    // as the note-anchor path.
    if (options.bgaTextures !== undefined && options.bgaCues !== undefined) {
      this.bgaLayer = new BeatorajaBgaLayer({
        skin: options.skin,
        textures: options.bgaTextures,
        videoElements: options.bgaVideoElements,
        cues: options.bgaCues,
        skinConfigOps,
      });
      this.view.container.addChildAt(this.bgaLayer.container, this.view.bgaLayerInsertIndex);
    }
  }

  enter(host: PixiSceneHost): void {
    if (this.disposed) return;
    this.host = host;
    this.startMs = performance.now();
    this.fitToStage();

    this.tickerHandle = () => this.tick();
    host.app.ticker.add(this.tickerHandle);

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyDown);
      window.addEventListener('wheel', this.handleWheel, { passive: false });
    }

    this.enginePromise = runEngineDriver({
      chart: this.options.chart,
      audio: this.options.audio,
      mode: this.options.mode,
      inputTarget: this.options.inputTarget,
      shouldSkipKey: this.options.shouldSkipKey,
      engineOptions: this.options.engineOptions,
      onInputSignalsReady: ({ inputSignals }) => {
        this.inputSignals = inputSignals;
        // The engine input bus is up — stamp the `startinput` timer so chrome gated on it (input-active
        // indicators, etc.) becomes visible.
        this.adapter.markStartInput();
        // If the host requested exit before the engine constructed its input bus (e.g. user mashed ESC
        // mid-loading), forward the interrupt as soon as the bus exists.
        if (this.exitRequested) {
          inputSignals.pushCommand({ kind: 'interrupt', reason: 'escape' });
        }
      },
      ui: {
        onSignalsReady: ({ uiSignals, stateSignals }) => {
          this.uiSignals = uiSignals;
          this.stateSignals = stateSignals;
        },
        onStart: () => {
          // The engine has begun audible playback. Stamp `ready` (skin's READY flash) and `play` (the
          // main play timer most chrome anchors against). `markPlay` also flips `now_loading` →
          // `loaded` so the skin's loading panel exits.
          this.adapter.markReady();
          this.adapter.markPlay();
        },
        onStop: () => this.adapter.markFadeout(),
        // The actual per-frame fan-out of frame / command / judge-combo events is handled by
        // `drainWebUiSignals` inside `tick()` so all engine state arrives at the renderer in a single
        // batched pass per Pixi frame. Leaving these callbacks unset would still work via the engine's
        // own subscription path, but doubling them up would cause every frame's effects to run twice.
      },
    })
      .then((summary) => {
        this.engineSettled = true;
        // End-of-chart fail declaration. Mid-play instant fail (HARD / DEATH gauge → 0) is
        // already caught by the adapter's per-frame gauge-zero detector; calling `markFailed`
        // here covers the GROOVE / EASY case where the chart finishes with the gauge below
        // the clear threshold but never reached zero. The adapter's idempotent latch makes
        // this safe to call regardless of which path tripped first — only the EARLIER stamp
        // wins, so the failure animation runs from the fail moment, not the chart's last
        // frame.
        if (summary.gauge !== undefined && !summary.gauge.cleared) {
          this.adapter.markFailed();
        }
        if (!this.disposed) {
          this.options.onComplete?.(summary, this.adapter.getMaxCombo(), this.adapter.getResultHistory());
        }
        return summary;
      })
      .catch((error) => {
        this.engineSettled = true;
        if (!this.disposed) {
          log.warn('engine driver rejected', { error });
          this.options.onError?.(error);
        }
        throw error;
      });
  }

  exit(): void {
    if (this.tickerHandle && this.host) {
      this.host.app.ticker.remove(this.tickerHandle);
    }
    this.tickerHandle = undefined;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeyDown);
      window.removeEventListener('wheel', this.handleWheel);
    }
    this.host = undefined;
  }

  /**
   * Tear down the scene. If the engine driver hasn't resolved yet, push an interrupt so it can drain
   * cleanly — a swallowed rejection here is intentional, the engine emits `PlayerInterruptedError` for
   * the escape path which the host already handles via `onError`.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.exit();
    if (!this.engineSettled && this.inputSignals) {
      this.inputSignals.pushCommand({ kind: 'interrupt', reason: 'escape' });
    }
    // Finalize an in-flight recording so we don't leak the audio tap / MediaRecorder when
    // the host tears down the scene mid-recording (e.g. ESC during a take). The promise
    // is intentionally not awaited — `stop()` handles the async finalization itself, and
    // dispose can't be async without changing the scene-host contract.
    if (this.recorder !== undefined) {
      void this.recorder.stop();
      this.recorder = undefined;
    }
    this.bgaLayer?.dispose();
    this.noteLayer.dispose();
    this.markerLayer.dispose();
    this.view.dispose();
    if (!this.root.destroyed) {
      this.root.destroy({ children: false });
    }
  }

  /**
   * Screenshot capture descriptor — returns the skin-space container + native authored
   * dimensions. The play view's `view.container` is the skin canvas root (notes / BGA /
   * markers all parent into it via the `insertNoteAndMarkerLayers` path), so capturing it
   * with the transform reset gives a frame at the skin's exact authored resolution.
   */
  getStageInfo(): { container: Container; width: number; height: number } {
    return { container: this.view.container, width: this.view.width, height: this.view.height };
  }

  /**
   * Ask the engine to fade out and resolve with the current summary. The host typically calls this from
   * a top-level pause/menu UI. ESC handling below routes through this same path.
   */
  requestExit(): void {
    if (this.exitRequested) return;
    this.exitRequested = true;
    this.options.onExit?.();
    if (this.inputSignals) {
      this.inputSignals.pushCommand({ kind: 'interrupt', reason: 'escape' });
    }
  }

  /** Promise that resolves once the engine driver finishes (chart end / interrupt / error). */
  awaitCompletion(): Promise<EngineDriverResult> | undefined {
    return this.enginePromise;
  }

  /**
   * Begin recording the play scene (canvas video + audio bus mix) into a WebM blob. Same
   * `GameplayRecorder` infrastructure the LR2 gameplay path uses, just bound to the
   * beatoraja view's host canvas + the audio bus the engine driver received at
   * construction.
   *
   * Throws when:
   *   - The scene hasn't been mounted yet (no `host` → no canvas to capture)
   *   - The browser doesn't expose `MediaRecorder` / `canvas.captureStream` / a usable
   *     codec (older Safari)
   *
   * Idempotent in the sense that calling while a recording is already active is a no-op
   * (use {@link isRecording} as the canonical gate).
   */
  startRecording(): void {
    if (this.recorder?.isActive() === true) return;
    if (this.host === undefined) {
      throw new Error('PixiBeatorajaGameplayView.startRecording: scene is not mounted (no host canvas)');
    }
    // Build a fresh recorder per session — instances are one-shot by design (chunk
    // buffer + audio tap lifecycle), so the host gets a clean blob on every start.
    this.recorder = new GameplayRecorder({
      canvas: this.host.app.canvas,
      audioContext: this.options.audio.audioContext,
      audioOutput: this.options.audio.audioBus.outputNode,
    });
    this.recorder.start();
  }

  /**
   * Finalize the active recording and resolve with the assembled blob plus its MIME type
   * + duration. Resolves with `undefined` when no recording is in progress, so callers
   * can call this unconditionally on chart end / unmount without branching.
   */
  async stopRecording(): Promise<GameplayRecorderResult | undefined> {
    const recorder = this.recorder;
    if (recorder === undefined) return undefined;
    this.recorder = undefined;
    return recorder.stop();
  }

  /** Whether a recording session is currently active. The demo's record button reads this. */
  isRecording(): boolean {
    return this.recorder?.isActive() ?? false;
  }

  /**
   * Hot-swap the skin (and matching texture / font caches) without tearing down the engine driver.
   * Used by the skin-options panel when the user re-picks a `property[]` or `filepath[]` value
   * mid-chart — the chrome rebuilds instantly while audio / input / scoring keep running.
   *
   * The runtime adapter's `baseOps` is updated to reflect the new option set; per-side judge state,
   * timer stamps, and the latched frame are preserved so visual continuity (judge plate fade-out,
   * combo readout, etc.) carries through the swap.
   */
  replaceSkin(opts: {
    skin: BeatorajaSkin;
    skinConfig?: BeatorajaSkinConfig;
    textures: BeatorajaTextureCache;
    fonts?: BeatorajaFontCache;
  }): void {
    if (this.disposed) return;

    // 1. Adapter: swap base ops while keeping runtime state.
    const skinConfigOps = buildBaseOpSet(opts.skinConfig?.option);
    this.adapter.setBaseOps(skinConfigOps);
    // Re-seed the per-name custom offsets against the new skin's `header.offset[]` schema —
    // entries from the previous skin that no longer exist in the new schema are dropped, the
    // rest carry forward. Replacing the same skin with new picks fully overrides the prior
    // values via the adapter's `setOffset` merge semantics.
    this.applyCustomOffsets(opts.skin.offset, opts.skinConfig?.customOffset);

    // 2. Tear down the old visual layers. Textures live on the per-entry cache and survive disposal
    // (we never destroy them through the cache by design — see `beatoraja-textures.ts`).
    this.bgaLayer?.dispose();
    this.bgaLayer = undefined;
    this.noteLayer.dispose();
    this.markerLayer.dispose();
    this.view.dispose();

    // 3. Rebuild against the new skin. Reuse `chartBpmCurve` — the chart hasn't changed.
    this.view = new BeatorajaPlaySkinView({
      skin: opts.skin,
      textures: opts.textures,
      skinConfigOps,
      resolveRefValue: (ref) => this.adapter.resolveRefValue(ref),
      resolveTextContent: (ref) => this.adapter.resolveTextContent(ref),
      resolveNumberValue: (ref) => this.adapter.resolveNumberValue(ref),
      resolveFontFamily: opts.fonts ? (id) => opts.fonts!.family(id) : undefined,
      resolveFontKind: opts.fonts ? (id) => opts.fonts!.kind(id) : undefined,
      resolveGraphValue: (type) => this.adapter.resolveGraphValue(type),
      resolveGraphPolyline: (type) => this.adapter.resolveGraphPolyline(type),
      resolveSliderValue: (type) => this.adapter.resolveSliderValue(type),
      resolveGaugePercent: () => this.adapter.resolveGaugePercent(),
      resolveBpmGraphPoints: () => this.chartBpmCurve,
      resolveBpmGraphData: () => this.bpmGraphDataForCurrentChart(),
      resolveJudgeGraphBars: (type) => this.adapter.resolveJudgeGraphBars(type),
      resolveJudgeStateBuckets: (type) => this.adapter.resolveJudgeStateBuckets(type),
      resolveNoteDistribution: () => this.noteDistributionForCurrentChart(),
      resolveTimingSamples: () => this.adapter.resolveTimingSamples(),
      resolveTimingJudgeWindowsMs: () => this.adapter.resolveJudgeWindowsMs(),
      resolveCurrentTimeMs: () => this.currentTimeMsForCursor(),
      chartImageProvider: (id) => resolveChartImage(this.options.chartImages, id),
      onButtonAction: (act, modifiers) => this.handleCoverButton(act, modifiers),
    });
    const noteImageMap = new Map<BeatorajaImageId, BeatorajaImageElement>();
    for (const image of normalizeBeatorajaImages(opts.skin.image)) {
      noteImageMap.set(image.id, image);
    }
    const noteSection = normalizeBeatorajaNote(opts.skin.note);
    this.noteLayer = new BeatorajaNoteLayer({
      noteSection,
      variant: this.options.variant,
      images: noteImageMap,
      textures: opts.textures,
      canvasHeight: this.view.height,
    });
    this.markerLayer = new BeatorajaMarkerLayer({
      group: noteSection.group,
      bpm: noteSection.bpm,
      stop: noteSection.stop,
      time: noteSection.time,
      images: noteImageMap,
      textures: opts.textures,
      canvasHeight: this.view.height,
    });
    if (this.options.bgaTextures !== undefined && this.options.bgaCues !== undefined) {
      this.bgaLayer = new BeatorajaBgaLayer({
        skin: opts.skin,
        textures: this.options.bgaTextures,
        videoElements: this.options.bgaVideoElements,
        cues: this.options.bgaCues,
        skinConfigOps,
      });
    }

    // 4. Re-attach in the new skin's authored z-order: backdrop → background skin destinations →
    //    markers → notes → foreground skin destinations (lanecover / hidden-cover / readouts).
    //    The "notes anchor" inside `view.noteLayerInsertIndex` decides where the marker / note
    //    layers slot in.
    insertNoteAndMarkerLayers(this.view, this.markerLayer, this.noteLayer);
    if (this.bgaLayer !== undefined) {
      this.view.container.addChildAt(this.bgaLayer.container, this.view.bgaLayerInsertIndex);
    }
    // The root already contains [backdrop, oldView]; replace the old view child with the new one.
    // Old view's container was destroyed (children detach), so we just append the new view.
    this.root.addChild(this.view.container);

    // 5. Force a re-fit on next tick so the new skin's `w` / `h` are applied even when the screen
    //    size hasn't changed since the last fit.
    this.lastFitWidth = 0;
    this.lastFitHeight = 0;

    // eslint-disable-next-line no-console
    console.log(
      '[beatoraja-gameplay] skin replaced',
      JSON.stringify({
        canvas: { w: this.view.width, h: this.view.height },
        name: opts.skin.name,
      }),
    );
  }

  /**
   * Resolver for `bpmgraph` segment data. The skin view's spec-faithful `bpmgraph` painter
   * needs the full segment timeline + `mainBpm`/`min`/`max` to color-code each segment by
   * BPM identity (mainbpm = green, min = blue, max = red, other = yellow, stop = magenta).
   *
   * Returns `undefined` for charts with no BPM history yet (lets the view fall back to the
   * legacy points-based path that paints a flat polyline).
   */
  private bpmGraphDataForCurrentChart() {
    if (this.chartAnalysis.bpmSegments.length === 0 || this.chartAnalysis.totalMs <= 0) {
      return undefined;
    }
    return {
      segments: this.chartAnalysis.bpmSegments,
      mainBpm: this.chartAnalysis.mainBpm,
      minBpm: this.chartAnalysis.minBpm,
      maxBpm: this.chartAnalysis.maxBpm,
      totalMs: this.chartAnalysis.totalMs,
    };
  }

  /**
   * Resolver for `notes-graph` / `judgegraph type=0` per-second × per-category histogram. The
   * skin view paints stacked chips per second bucket using the spec's seven categories.
   *
   * Returns `undefined` for an empty chart (no notes / no BPM transitions); the view then
   * leaves the graph empty rather than rendering a single zero-height baseline.
   */
  private noteDistributionForCurrentChart() {
    if (this.chartAnalysis.buckets.length === 0) return undefined;
    return {
      buckets: this.chartAnalysis.buckets,
      maxCount: this.chartAnalysis.maxCount,
      totalMs: this.chartAnalysis.totalMs,
    };
  }

  /**
   * Resolve the current playhead position in ms for graph cursor overlays
   * (`bpmgraph` / `notes-graph`). Reads `currentFrame.currentSeconds` (the latest UI
   * frame published by the engine driver) and converts to ms. Returns `undefined`
   * before the first frame lands so the cursor stays hidden during the initial paint.
   */
  private currentTimeMsForCursor(): number | undefined {
    const frame = this.currentFrame;
    if (frame === null) return undefined;
    if (typeof frame.currentSeconds !== 'number' || !Number.isFinite(frame.currentSeconds)) return undefined;
    return Math.max(0, frame.currentSeconds * 1000);
  }

  /**
   * Push the user's `BeatorajaSkinConfig.customOffset` picks into the runtime adapter's
   * offset table, keyed by the matching `header.offset[].id`. Each axis flagged on the
   * schema gets forwarded; unflagged axes default to 0 (no shift).
   *
   * Called at construction and from `replaceSkin` so a config edit (or a skin swap that
   * changes the schema) lands the new values without restarting the chart.
   */
  private applyCustomOffsets(
    schema: ReadonlyArray<BeatorajaSkinCustomOffset> | undefined,
    picks: BeatorajaSkinConfig['customOffset'],
  ): void {
    if (schema === undefined || schema.length === 0 || picks === undefined) return;
    for (const slot of schema) {
      const axes = picks[slot.name];
      if (axes === undefined) continue;
      // `setOffset` does a partial merge — we send only the flagged axes, leaving the
      // rest untouched (so a subsequent unrelated `setOffset` for the same id doesn't
      // wipe these). Unflagged values stay at the slot's authored defaults.
      const next: Partial<{ x: number; y: number; w: number; h: number; r: number; a: number }> = {};
      if (slot.x && axes.x !== undefined) next.x = axes.x;
      if (slot.y && axes.y !== undefined) next.y = axes.y;
      if (slot.w && axes.w !== undefined) next.w = axes.w;
      if (slot.h && axes.h !== undefined) next.h = axes.h;
      if (slot.r && axes.r !== undefined) next.r = axes.r;
      if (slot.a && axes.a !== undefined) next.a = axes.a;
      this.adapter.setOffset(slot.id, next);
    }
  }

  /**
   * Route a skin-authored cover-button click (`act = LANECOVER (330) / LIFT (331) / HIDDEN
   * (332)`) into the matching adapter setter. Each click steps the ratio by `0.05`; the
   * `shift` modifier reverses direction. Hidden cover toggles between disabled and a
   * stepped-up ratio so the player can flip it on with a single click and tap-to-cycle
   * through finer adjustments.
   *
   * Other `act` codes (PLAY / AUTOPLAY / etc.) are no-ops here — those are select-scene
   * concerns. Beatoraja's reference engine routes the same act codes through different
   * handlers depending on the active scene.
   */
  private handleCoverButton(act: number, modifiers?: { shift: boolean; ctrl: boolean; alt: boolean }): void {
    const direction = modifiers?.shift === true ? -1 : 1;
    const STEP = 0.05;
    switch (act) {
      case 330: // LANECOVER
        this.adapter.adjustLanecover(direction * STEP);
        return;
      case 331: // LIFT
        this.adapter.adjustLift(direction * STEP);
        return;
      case 332: // HIDDEN
        // Toggle off → on at ratio 0.05; subsequent clicks step the ratio. Shift-click
        // steps down and disables when crossing 0.
        if (!this.adapter.isHiddenCoverEnabled()) {
          this.adapter.setHiddenCover(STEP, true);
          return;
        }
        const next = this.adapter.getHiddenCover() + direction * STEP;
        if (next <= 0) {
          this.adapter.setHiddenCover(0, false);
        } else {
          this.adapter.setHiddenCover(Math.min(1, next), true);
        }
        return;
    }
  }

  /**
   * Show a transient overlay text on the gameplay canvas. Used by the cover-toggle keys
   * (H / J / K) so the user gets visual feedback without dropping eyes from the lane.
   * Fades out after {@link COVER_INDICATOR_FADE_MS}; re-firing while the previous fade is
   * in flight resets the timer + replaces the text.
   */
  private flashCoverIndicator(text: string): void {
    if (this.coverIndicatorText === undefined) {
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
      this.coverIndicatorText = node;
    }
    this.coverIndicatorText.text = text;
    // Position recomputed each fire — root.scale changes as the user resizes the window;
    // anchoring at canvas-centre via the live `view.width / height` keeps the indicator
    // visually centred regardless of scale.
    this.coverIndicatorText.x = this.view.width / 2;
    this.coverIndicatorText.y = this.view.height * 0.2;
    this.coverIndicatorText.alpha = 1;
    this.coverIndicatorText.visible = true;
    this.coverIndicatorShownAtMs = performance.now();
  }
  private coverIndicatorText: Text | undefined;
  private coverIndicatorShownAtMs = 0;

  private tick(): void {
    if (this.disposed) return;
    // Re-fit on every tick. The Pixi `Application`'s `resizeTo` may have changed `app.screen` after our
    // last fit (mount-time layout, window resize, dev-tools open). Cheap when nothing changed — the
    // setter early-outs when `(width, height)` matches the cached values.
    this.fitToStage();
    // Cover indicator fade — emitted when the user taps H / J / K. Lingers fully visible for
    // 800ms then fades over the next 600ms. Single-Text node, cheap to update per frame.
    if (this.coverIndicatorText !== undefined && this.coverIndicatorText.visible) {
      const elapsed = performance.now() - this.coverIndicatorShownAtMs;
      if (elapsed < 800) {
        this.coverIndicatorText.alpha = 1;
      } else if (elapsed < 1400) {
        this.coverIndicatorText.alpha = 1 - (elapsed - 800) / 600;
      } else {
        this.coverIndicatorText.visible = false;
      }
    }
    if (this.uiSignals) {
      const result = drainWebUiSignals(
        this.uiSignals,
        {
          onFrame: (frame) => {
            this.adapter.applyFrame(frame);
            this.currentFrame = frame;
          },
          onCommand: (command) => this.adapter.applyCommand(command),
          onJudgeCombo: (state) => this.adapter.applyJudgeCombo(state),
        },
        { stateSignals: this.stateSignals, lastJudgeComboTick: this.lastJudgeComboTick },
      );
      this.lastJudgeComboTick = result.lastJudgeComboTick;
      // Hispeed lives on `stateSignals.highSpeed` — read it into a local instead of polling the signal
      // every note draw. The signal is a function; calling it without an argument returns the latest.
      if (this.stateSignals) {
        const hs = this.stateSignals.highSpeed();
        if (Number.isFinite(hs) && hs > 0) this.hiSpeed = hs;
        this.adapter.setHiSpeed(this.hiSpeed);
      }
    }
    const ctx = this.adapter.getRenderContext();
    const skinAudio = this.options.skinAudio;
    this.view.update(
      skinAudio === undefined
        ? ctx
        : {
            ...ctx,
            audioPlay: (path, vol) => skinAudio.play(path, vol),
            audioLoop: (path, vol) => skinAudio.loop(path, vol),
            audioStop: (path) => skinAudio.stop(path),
          },
    );
    if (this.currentFrame) {
      this.noteLayer.update(this.currentFrame, this.hiSpeed, ctx.activeOps, (channel) =>
        this.adapter.isLaneLnHeld(channel),
      );
      // Marker layer scrolls with the same hispeed math as notes, anchored to the same lane
      // bounds (the active dst block resolves to the lane top + judgement Y). When no lane
      // matched, fall back to skin-canvas defaults so any markers still render at sane Ys.
      const laneBounds = this.noteLayer.getLaneBounds(ctx.activeOps) ?? { topY: 0, bottomY: this.view.height };
      this.markerLayer.update({
        currentBeat: this.currentFrame.currentBeat,
        judgementY: laneBounds.bottomY,
        laneTopY: laneBounds.topY,
        pixelsPerBeat: BEATORAJA_MARKER_PIXELS_PER_BEAT * this.hiSpeed,
        markers: this.chartMarkers,
      });
      this.bgaLayer?.update(this.currentFrame.currentSeconds, ctx, this.adapter.isPoorBgaActive());
    }

    // Periodic state snapshot — every 300 frames (≈ 5 s at 60 fps). `JSON.stringify` so the payload
    // is selectable / copy-pasteable from devtools (vs the collapsible tree the bare object form
    // would render). Direct `console.log` so the source link points at this exact line.
    this.debugFrameCounter += 1;
    if (this.debugFrameCounter % 300 === 0 && this.currentFrame) {
      const summary = this.currentFrame.summary;
      // eslint-disable-next-line no-console
      console.log(
        '[beatoraja-gameplay] frame snapshot',
        JSON.stringify({
          seconds: +this.currentFrame.currentSeconds.toFixed(2),
          beat: +this.currentFrame.currentBeat.toFixed(2),
          notesInFlight: this.currentFrame.notes.length,
          score: summary.score,
          judges: {
            perfect: summary.perfect,
            great: summary.great,
            good: summary.good,
            bad: summary.bad,
            poor: summary.poor,
          },
          hiSpeed: this.hiSpeed,
          activeOps: ctx.activeOps.size,
          timers: this.adapter.timerSnapshot().length,
          poorBga: this.adapter.isPoorBgaActive(),
        }),
      );
    }
  }

  private fitToStage(): void {
    const host = this.host;
    if (!host) return;
    const { width, height } = host.app.screen;
    if (width === this.lastFitWidth && height === this.lastFitHeight) return;
    if (width <= 0 || height <= 0) return;
    this.lastFitWidth = width;
    this.lastFitHeight = height;
    const scaleX = width / this.view.width;
    const scaleY = height / this.view.height;
    const scale = Math.min(scaleX, scaleY);
    if (!Number.isFinite(scale) || scale <= 0) return;
    const container = this.view.container;
    container.scale.set(scale, scale);
    container.x = (width - this.view.width * scale) / 2;
    container.y = (height - this.view.height * scale) / 2;
    // Repaint the full-canvas backdrop. Drawn in stage coordinates (not skin space) so the rectangle
    // is independent of the skin's scale transform.
    this.backdrop.clear().rect(0, 0, width, height).fill(0x000000);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.requestExit();
      return;
    }
    // Lanecover position — `PageUp` / `PageDown` step the cover by 1% per press, holding `Shift`
    // bumps it to 5% for coarse adjustment. Mirrors beatoraja's lanecover hotkey behaviour;
    // `PageUp` raises the cover (more lane visible), `PageDown` lowers it (more cover).
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      const step = (event.shiftKey ? 0.05 : 0.01) * (event.key === 'PageUp' ? -1 : 1);
      this.adapter.adjustLanecover(step);
      this.flashCoverIndicator(`Lanecover ${Math.round(this.adapter.getLanecover() * 100)}%`);
      return;
    }
    // Lift slider — `Home` / `End` step the lift edge by 1% per press, Shift to 5%. The lift
    // slider is independent of lanecover; it controls hidden-cover (the lower-edge mask used in
    // hidden-mode play). `End` raises lift (cover opens further down the lane), `Home` lowers
    // it (cover collapses back toward the bottom edge).
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const step = (event.shiftKey ? 0.05 : 0.01) * (event.key === 'End' ? 1 : -1);
      this.adapter.adjustLift(step);
      this.flashCoverIndicator(`Lift ${Math.round(this.adapter.getLift() * 100)}%`);
      return;
    }
    // Hidden cover — `H` toggles enable/disable; `J` / `K` adjust the ratio when enabled
    // (J = lower / less coverage, K = raise / more coverage). Mirrors `LaneRenderer`'s
    // OFFSET_HIDDEN_COVER block: disabled emits `a = -255` (cover invisible), enabled
    // shifts the cover edge by `ratio × laneHeight` (with `(1 - lift)` factor when lift
    // is also active). Without this hotkey the only way to toggle hidden was via the
    // skin's authored HIDDEN button (act 332) — most skins don't expose one.
    if (event.key === 'h' || event.key === 'H') {
      event.preventDefault();
      const enabled = this.adapter.isHiddenCoverEnabled();
      this.adapter.setHiddenCover(this.adapter.getHiddenCover() || 0.25, !enabled);
      this.flashCoverIndicator(
        !enabled
          ? `Hidden cover ON (${Math.round((this.adapter.getHiddenCover() || 0.25) * 100)}%)`
          : 'Hidden cover OFF',
      );
      return;
    }
    if (event.key === 'j' || event.key === 'J' || event.key === 'k' || event.key === 'K') {
      event.preventDefault();
      const direction = event.key === 'k' || event.key === 'K' ? 1 : -1;
      const step = (event.shiftKey ? 0.05 : 0.01) * direction;
      const next = Math.max(0, Math.min(1, this.adapter.getHiddenCover() + step));
      // Auto-enable when adjusting upward from a disabled state — saves one keypress
      // for the common "I want a 25% hidden cover" interaction.
      const enable = this.adapter.isHiddenCoverEnabled() || (direction > 0 && next > 0);
      this.adapter.setHiddenCover(next, enable);
      this.flashCoverIndicator(
        enable ? `Hidden cover ${Math.round(next * 100)}%` : 'Hidden cover OFF',
      );
      return;
    }
    // Hi-speed (note scroll multiplier) — `ArrowUp` / `ArrowDown` step by 0.1 per press, Shift
    // to 0.5 for coarse adjustment. Same convention as the LR2 gameplay scene so muscle memory
    // carries between the two paths. The engine's "Option + lane key" hispeed convention still
    // works in parallel (it's wired through the player input runtime → state signals), but the
    // arrow keys give a discoverable / non-conflicting alternative.
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const step = (event.shiftKey ? 0.5 : 0.1) * (event.key === 'ArrowUp' ? 1 : -1);
      this.adjustHiSpeed(step);
    }
  };

  /**
   * Adjust the visual scroll multiplier and propagate to the engine's state signal so the
   * hispeed digit display + duration / green readouts pick the new value up on the next
   * frame. Snapped to a 1/1000 grid to absorb float-rounding noise (0.1 has no exact IEEE-754
   * representation; pressing 13 times in a row would otherwise drift to 1.300000000000001).
   * Clamped to [HISPEED_MIN, HISPEED_MAX] so users can't soft-lock with hispeed=0 or runaway.
   */
  private adjustHiSpeed(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) return;
    const next = Math.max(HISPEED_MIN, Math.min(HISPEED_MAX, Math.round((this.hiSpeed + delta) * 1000) / 1000));
    if (next === this.hiSpeed) return;
    this.hiSpeed = next;
    // Push back through `stateSignals` when present so any downstream consumer (engine
    // playback support, the LR2-shared `applyPlaybackHighSpeedAction` path, future remote
    // surfaces) sees the same value. The next tick reads it back into `this.hiSpeed` from
    // the same signal, so no fight between sources.
    this.stateSignals?.setHighSpeed(next);
    // Reuse the cover-indicator overlay for hispeed feedback — same fade timing, same
    // anchor position. Single transient overlay node serves multiple key actions.
    this.flashCoverIndicator(`Hi-Speed ×${next.toFixed(2)}`);
  }

  /**
   * Mouse-wheel input adjusts the lanecover ratio — gives players a quick way to dial cover
   * during play without leaving the keyboard. `deltaY > 0` (scroll down) extends the cover;
   * `deltaY < 0` (scroll up) retracts it. The 0.005-per-tick step is intentionally fine —
   * trackpads emit dozens of small deltas; on a wheel mouse the per-detent unit is enough to
   * notice. Holding Shift accelerates by 5x.
   */
  private readonly handleWheel = (event: WheelEvent): void => {
    if (event.deltaY === 0) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? 1 : -1;
    const magnitude = event.shiftKey ? 0.025 : 0.005;
    this.adapter.adjustLanecover(direction * magnitude);
  };
}

/**
 * Insert the marker + note layers into the play view's container at `view.noteLayerInsertIndex`
 * — the position where the skin's `{id = noteSection.id}` z-anchor was found. Markers go BELOW
 * notes (notes overlay measure / BPM / STOP / time markers in beatoraja's reference layering)
 * but BOTH go above any skin destination authored before the anchor and below any after.
 *
 * Pixi `addChildAt(index, child)` shifts `children[index..]` one slot right, so calling it with
 * the same index twice (markers, then notes) yields `[..., marker, note, ...post-anchor sprites]`,
 * which is the required order: markers behind notes, both ahead of pre-anchor sprites, both
 * behind post-anchor sprites. Refreshing `noteLayerInsertIndex` between calls would also work
 * — using the cached index plus the +1 offset is just less branchy.
 */
function insertNoteAndMarkerLayers(
  view: BeatorajaPlaySkinView,
  markerLayer: BeatorajaMarkerLayer,
  noteLayer: BeatorajaNoteLayer,
): void {
  const index = view.noteLayerInsertIndex;
  view.container.addChildAt(markerLayer.container, index);
  view.container.addChildAt(noteLayer.container, index + 1);
}

/**
 * Map a synthetic chart-image id (`-100` STAGEFILE / `-101` BACKBMP / `-102` BANNER) onto
 * the host-supplied texture. Returns `undefined` for unknown ids OR when the host didn't
 * supply a texture for that slot — the renderer hides the destination in that case. Same
 * shape as the resolver in `pixi-beatoraja-decide.ts`; lifted here so play scenes that
 * authored chart-image destinations (ModernChic's lane-cover backing, default's loading
 * panel) render correctly.
 */
/**
 * Read the per-side combo-digit metrics needed to compute the judge-word-shift amount.
 * Mirrors upstream's `nowCount.getLength()` formula at `SkinNumber.java:185`:
 *
 *     length = (region.width + space) * (currentImages.length - shiftbase)
 *
 * For the shift's purposes we need `region.width + space` as the per-digit pitch — that's
 * what we capture here. Two skin sources contribute:
 *
 *   - `skin.judge[i].numbers[0].dst[0].w` — the per-digit cell width (= `region.width` at
 *     runtime, before any offsets[].w grows it).
 *   - `skin.value[id == numbers[0].id].space` — the inter-digit space (`SkinNumber.space`),
 *     authored on the matching `value[]` declaration. Most skins author 0; some banner-style
 *     digit fonts use small positive values.
 *
 * Default `(width = 40, space = 0)` covers default skin's `play5.json` / `play7main.lua`
 * which both author `numbers[i].dst.w = 40` and the matching `value` block doesn't author
 * a non-zero space.
 */
function readJudgeComboMetrics(
  skin: BeatorajaSkin,
): { 1: { width: number; space: number }; 2: { width: number; space: number } } {
  const result = {
    1: { width: 40, space: 0 },
    2: { width: 40, space: 0 },
  };
  const judges = (skin as { judge?: unknown }).judge;
  if (!Array.isArray(judges)) return result;
  // Build a quick `value[].id → value` map so we can look up the `space` field for each
  // judge.numbers[0].id without re-scanning value[] for every judge.
  const valuesById = new Map<string | number, { space?: number }>();
  const values = (skin as { value?: unknown }).value;
  if (Array.isArray(values)) {
    for (const v of values) {
      if (v === null || typeof v !== 'object') continue;
      const obj = v as Readonly<Record<string, unknown>>;
      const id = obj.id;
      if (typeof id === 'string' || typeof id === 'number') {
        valuesById.set(id, obj as { space?: number });
      }
    }
  }
  for (const judge of judges) {
    if (judge === null || typeof judge !== 'object') continue;
    const obj = judge as Readonly<Record<string, unknown>>;
    const index = typeof obj.index === 'number' ? obj.index : 0;
    const side: 1 | 2 = index === 1 ? 2 : 1;
    const numbers = Array.isArray(obj.numbers) ? obj.numbers : [];
    const first = numbers[0];
    if (first === null || typeof first !== 'object') continue;
    const firstObj = first as Readonly<Record<string, unknown>>;
    const dst = firstObj.dst;
    if (Array.isArray(dst) && dst.length > 0) {
      const kf = dst[0];
      if (kf !== null && typeof kf === 'object') {
        const w = (kf as Readonly<Record<string, unknown>>).w;
        if (typeof w === 'number' && Number.isFinite(w) && w > 0) {
          result[side].width = w;
        }
      }
    }
    // `numbers[0].id` references a `value[]` declaration — pull its `space` field.
    const valueId = firstObj.id;
    if (typeof valueId === 'string' || typeof valueId === 'number') {
      const valueDef = valuesById.get(valueId);
      const space = valueDef?.space;
      if (typeof space === 'number' && Number.isFinite(space)) {
        result[side].space = space;
      }
    }
  }
  return result;
}

function resolveChartImage(
  images: PixiBeatorajaGameplayViewOptions['chartImages'] | undefined,
  syntheticId: number,
): Texture | undefined {
  if (images === undefined) return undefined;
  switch (syntheticId) {
    case -100:
      return images.stageFile;
    case -101:
      return images.backBmp;
    case -102:
      return images.banner;
    default:
      return undefined;
  }
}

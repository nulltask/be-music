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

import { Container, Graphics, type Ticker } from 'pixi.js';
import type { BeMusicJson } from '@be-music/json';
import type {
  BeatorajaImageElement,
  BeatorajaImageId,
  BeatorajaSkin,
  BeatorajaSkinConfig,
} from '@be-music/beatoraja-skin';
import { buildBaseOpSet, normalizeBeatorajaImages, normalizeBeatorajaNote } from '@be-music/beatoraja-skin';
import type { BeatorajaPlayableVariant } from './beatoraja-theme.ts';
import { BeatorajaNoteLayer } from './pixi-beatoraja-notes.ts';
import { BeatorajaMarkerLayer, BEATORAJA_MARKER_PIXELS_PER_BEAT } from './pixi-beatoraja-markers.ts';
import { computeBeatorajaChartMarkers } from './beatoraja-chart-markers.ts';
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
    },
  ) => void;
  /** Called if the engine rejects (interrupt or fatal) — the host can branch on the error type. */
  onError?: (error: unknown) => void;
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
   * Last screen size we ran `fitToStage` against. The Pixi `Application` is `resizeTo: container`, which
   * means the canvas can resize asynchronously after `enter()` (e.g. when the demo's gameplay scene
   * mounts before the layout settles, or when the user resizes the window mid-chart). We re-fit on every
   * tick when the screen has actually changed; same idiom the LR2 path uses.
   */
  private lastFitWidth = 0;
  private lastFitHeight = 0;

  constructor(options: PixiBeatorajaGameplayViewOptions) {
    this.options = options;

    // Adapter is constructed first so the skin view can route ref/text resolvers through it. The clock
    // captures `getNowMs` as a closure that reads `this.startMs`, which is set at `enter()` time — until
    // then, `getNowMs()` returns negative values. That's fine; the skin view only samples after `enter()`.
    this.adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: options.variant,
      baseOps: buildBaseOpSet(options.skinConfig?.option),
      getNowMs: () => performance.now() - this.startMs,
      autoPlay: options.mode === 'auto',
      chart: options.chart,
      // Surface skin / directory metadata so `BEATORAJA_TEXT.SKIN_NAME` / `SKIN_AUTHOR` /
      // `DIRECTORY` resolve to real strings on the play scene's chrome panels.
      skinHeaderName: options.skin.name,
      skinHeaderAuthor: options.skin.author,
      directoryLabel: options.directoryLabel,
    });

    this.view = new BeatorajaPlaySkinView({
      skin: options.skin,
      textures: options.textures,
      resolveRefValue: (ref) => this.adapter.resolveRefValue(ref),
      resolveTextContent: (ref) => this.adapter.resolveTextContent(ref),
      resolveNumberValue: (ref) => this.adapter.resolveNumberValue(ref),
      resolveFontFamily: options.fonts ? (id) => options.fonts!.family(id) : undefined,
      resolveFontKind: options.fonts ? (id) => options.fonts!.kind(id) : undefined,
      resolveGraphValue: (type) => this.adapter.resolveGraphValue(type),
      resolveSliderValue: (type) => this.adapter.resolveSliderValue(type),
      resolveGaugePercent: () => this.adapter.resolveGaugePercent(),
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
    });
    this.chartMarkers = computeBeatorajaChartMarkers(options.chart, {
      // 1-second time ticks when the skin authors `time[]` markers. Disabled when the skin
      // doesn't author them — the marker layer culls the empty list anyway.
      timeIntervalSec: noteSection.time.length > 0 ? 1 : undefined,
      totalSeconds: undefined,
    });
    this.view.container.addChild(this.markerLayer.container);
    this.view.container.addChild(this.noteLayer.container);

    log.info('beatoraja gameplay mounted', {
      variant: options.variant,
      skin: { w: this.view.width, h: this.view.height, name: options.skin.name },
      autoPlay: options.mode === 'auto',
      bga: options.bgaTextures !== undefined && options.bgaCues !== undefined,
      fontsLoaded: options.fonts ? options.fonts.values().length : 0,
    });

    // BGA layer mounts UNDER notes so scrolling notes draw on top of the BGA video; the LR2 default
    // skin's chart-area chrome paints on top of both via its own destination z-order. Only construct
    // the layer when both texture map and cues are supplied — otherwise the chart has no BGA / the
    // host hasn't decoded the bitmaps yet, and skipping the sprite avoids a black rect over the chrome.
    if (options.bgaTextures !== undefined && options.bgaCues !== undefined) {
      this.bgaLayer = new BeatorajaBgaLayer({
        skin: options.skin,
        textures: options.bgaTextures,
        cues: options.bgaCues,
      });
      this.view.container.addChildAt(this.bgaLayer.container, 0);
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
    this.bgaLayer?.dispose();
    this.noteLayer.dispose();
    this.markerLayer.dispose();
    this.view.dispose();
    if (!this.root.destroyed) {
      this.root.destroy({ children: false });
    }
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
    this.adapter.setBaseOps(buildBaseOpSet(opts.skinConfig?.option));

    // 2. Tear down the old visual layers. Textures live on the per-entry cache and survive disposal
    // (we never destroy them through the cache by design — see `beatoraja-textures.ts`).
    this.bgaLayer?.dispose();
    this.bgaLayer = undefined;
    this.noteLayer.dispose();
    this.markerLayer.dispose();
    this.view.dispose();

    // 3. Rebuild against the new skin.
    this.view = new BeatorajaPlaySkinView({
      skin: opts.skin,
      textures: opts.textures,
      resolveRefValue: (ref) => this.adapter.resolveRefValue(ref),
      resolveTextContent: (ref) => this.adapter.resolveTextContent(ref),
      resolveNumberValue: (ref) => this.adapter.resolveNumberValue(ref),
      resolveFontFamily: opts.fonts ? (id) => opts.fonts!.family(id) : undefined,
      resolveFontKind: opts.fonts ? (id) => opts.fonts!.kind(id) : undefined,
      resolveGraphValue: (type) => this.adapter.resolveGraphValue(type),
      resolveSliderValue: (type) => this.adapter.resolveSliderValue(type),
      resolveGaugePercent: () => this.adapter.resolveGaugePercent(),
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
    });
    this.markerLayer = new BeatorajaMarkerLayer({
      group: noteSection.group,
      bpm: noteSection.bpm,
      stop: noteSection.stop,
      time: noteSection.time,
      images: noteImageMap,
      textures: opts.textures,
    });
    if (this.options.bgaTextures !== undefined && this.options.bgaCues !== undefined) {
      this.bgaLayer = new BeatorajaBgaLayer({
        skin: opts.skin,
        textures: this.options.bgaTextures,
        cues: this.options.bgaCues,
      });
    }

    // 4. Re-attach in the original z-order: backdrop → skin → (BGA at the back of skin) → markers → notes.
    this.view.container.addChild(this.markerLayer.container);
    this.view.container.addChild(this.noteLayer.container);
    if (this.bgaLayer !== undefined) {
      this.view.container.addChildAt(this.bgaLayer.container, 0);
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

  private tick(): void {
    if (this.disposed) return;
    // Re-fit on every tick. The Pixi `Application`'s `resizeTo` may have changed `app.screen` after our
    // last fit (mount-time layout, window resize, dev-tools open). Cheap when nothing changed — the
    // setter early-outs when `(width, height)` matches the cached values.
    this.fitToStage();
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
    this.view.update(ctx);
    if (this.currentFrame) {
      this.noteLayer.update(this.currentFrame, this.hiSpeed, ctx.activeOps);
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
    }
  };
}

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

import { Container, type Ticker } from 'pixi.js';
import type { BeMusicJson } from '@be-music/json';
import type { BeatorajaSkin, BeatorajaSkinConfig } from '@be-music/beatoraja-skin';
import { buildBaseOpSet, normalizeBeatorajaNote } from '@be-music/beatoraja-skin';
import type { BeatorajaPlayableVariant } from './beatoraja-theme.ts';
import { BeatorajaNoteLayer } from './pixi-beatoraja-notes.ts';
import { BeatorajaBgaLayer } from './pixi-beatoraja-bga.ts';
import type { BgaCue } from './pixi-gameplay-bga.ts';
import type { Texture } from 'pixi.js';
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
  inputTarget?: EventTarget;
  shouldSkipKey?: (event: KeyboardEvent) => boolean;
  engineOptions?: Omit<PlayerOptions, 'createAudioSession' | 'createInputRuntime' | 'createUiRuntime' | 'auto'>;

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
  /** Called once the engine resolves with a chart-end summary. */
  onComplete?: (summary: PlayerSummary) => void;
  /** Called if the engine rejects (interrupt or fatal) — the host can branch on the error type. */
  onError?: (error: unknown) => void;
}

export class PixiBeatorajaGameplayView implements PixiScene {
  readonly root = new Container();
  private readonly view: BeatorajaPlaySkinView;
  private readonly noteLayer: BeatorajaNoteLayer;
  private readonly bgaLayer: BeatorajaBgaLayer | undefined;
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
    });

    this.view = new BeatorajaPlaySkinView({
      skin: options.skin,
      textures: options.textures,
      resolveRefValue: (ref) => this.adapter.resolveRefValue(ref),
      resolveTextContent: (ref) => this.adapter.resolveTextContent(ref),
    });
    this.root.addChild(this.view.container);

    // Note layer paints inside the skin's coordinate system so it scales / positions with the skin chrome.
    // Mounting onto `view.container` (rather than `this.root` directly) means `fitToStage`'s scale +
    // translation cascade applies to notes too, keeping the lane geometry in sync without a duplicate
    // transform.
    this.noteLayer = new BeatorajaNoteLayer({
      noteSection: normalizeBeatorajaNote(options.skin.note),
      variant: options.variant,
    });
    this.view.container.addChild(this.noteLayer.container);

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
          this.options.onComplete?.(summary);
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

  private tick(): void {
    if (this.disposed) return;
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
      }
    }
    const ctx = this.adapter.getRenderContext();
    this.view.update(ctx);
    if (this.currentFrame) {
      this.noteLayer.update(this.currentFrame, this.hiSpeed, ctx.activeOps);
      this.bgaLayer?.update(this.currentFrame.currentSeconds, ctx, this.adapter.isPoorBgaActive());
    }
  }

  private fitToStage(): void {
    const host = this.host;
    if (!host) return;
    const screen = host.app.screen;
    const scaleX = screen.width / this.view.width;
    const scaleY = screen.height / this.view.height;
    const scale = Math.min(scaleX, scaleY);
    const container = this.view.container;
    container.scale.set(scale, scale);
    container.x = (screen.width - this.view.width * scale) / 2;
    container.y = (screen.height - this.view.height * scale) / 2;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.requestExit();
    }
  };
}

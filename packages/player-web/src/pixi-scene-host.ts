import { Application, type ApplicationOptions, Container, RendererType } from 'pixi.js';
import { logger } from './logger.ts';

const log = logger('scene-host');

/**
 * A single PixiJS scene that lives inside a {@link PixiSceneHost}. Each scene owns a `root` Container and is
 * responsible for adding its own children to it; the host attaches/detaches that root from the shared `app.stage` on
 * transitions.
 *
 * Implementation contract:
 *
 * - `enter(host)` is called once when the scene becomes active. Allocate per-scene resources (textures / event
 *   listeners / ticker callbacks) here.
 * - `exit()` is called when another scene takes over. Stop ticker callbacks and detach window-level event listeners.
 *   Heavy GPU resources can stay alive if the scene is meant to be re-entered later (see {@link
 *   PixiSceneHost.setScene}'s `keepAlive` option).
 * - `dispose()` is the permanent cleanup. After this call the scene must not be re-entered.
 *
 * Scenes do **not** call `Application.destroy()` — that's the host's job, and only at process / page shutdown. This is
 * the central idea behind the multi-scene refactor: keeping a single Application (and therefore a single WebGL context)
 * alive across the whole session avoids Pixi v8's module-shared `batchPool` race that bit us when two `Application`
 * instances ran side-by-side.
 */
export interface PixiScene {
  /**
   * Container the host attaches to its `app.stage` when this scene is active. Scenes build their own scene graph as
   * children of this `root`.
   */
  readonly root: Container;
  enter(host: PixiSceneHost): Promise<void> | void;
  exit(): Promise<void> | void;
  dispose(): void;
}

export interface PixiSceneHostMountOptions {
  /**
   * Optional override for the underlying `Application.init` options. The host fills in opinionated defaults (no
   * antialias, nearest sampling, devicePixelRatio resolution, transparent BG) that match the LR2 pixel-art aesthetic;
   * pass an override to swap any subset for a specific deployment.
   */
  appOptions?: Partial<ApplicationOptions>;
}

/**
 * Owns the single PixiJS `Application` (and therefore the single WebGL context) for the whole player session. Scenes
 * are attached via {@link setScene}; only one scene is "active" (visible + receiving ticker callbacks via its own
 * scope) at a time.
 *
 * Why this exists: PixiJS v8 keeps a module-level `batchPool` that's destroyed when **any** `Application.destroy()` is
 * called with the `releaseGlobalResources` flag (which the boolean `app.destroy(true, ...)` shorthand sets implicitly).
 * With two `Application`s alive at once, tearing one of them down nulls out shared `Batch` instances that the other
 * app's renderer then crashes on at `_DefaultBatcher.break`. Funnelling everything through one `Application` instance
 * dodges that landmine entirely — and matches the official "use a single Application for the lifetime of your app"
 * guidance in the PixiJS docs.
 */
export class PixiSceneHost {
  /** The shared `Application`. Scenes read `host.app` for the ticker, screen size, canvas, etc. */
  public readonly app: Application = new Application();
  /** The currently-active scene, or `undefined` between transitions. */
  private current: PixiScene | undefined;
  /** Set after the first `mount` so re-mount calls are a no-op. */
  private mounted = false;
  /** Set when {@link dispose} runs so subsequent calls short-circuit. */
  private disposed = false;
  /**
   * Serializes in-flight `setScene` calls. Without it a fast-double-toggle (e.g. ESC-then-immediate-song-pick) could
   * interleave a new scene's `enter()` with a previous scene's `exit()`, leaving both attached to the stage.
   */
  private transitionLock: Promise<void> = Promise.resolve();

  public async mount(container: HTMLElement, options?: PixiSceneHostMountOptions): Promise<void> {
    if (this.mounted) {
      return;
    }
    this.mounted = true;
    // Renderer preference. Defaults to WebGPU per the project's perf goals (lower per-frame CPU on dense charts, room
    // for future compute-shader BGA effects). PixiJS auto-falls-back to WebGL2 when the browser doesn't expose WebGPU,
    // so this is safe to leave on for old browsers — `app.renderer.type` logged below confirms which path actually came
    // up.
    //
    // The `?renderer=webgl` URL flag forces WebGL2 for A/B testing (regression triage on devices where WebGPU happens
    // to be slower or buggier). Anything else falls through to the default. `?renderer=webgpu` is accepted as the
    // explicit form even though it's the default, useful for documenting the intent in deployed URLs.
    const preference = resolveRendererPreference();
    // Pre-create the WebGPU device with the adapter's MAX texture-dimension limit when WebGPU is
    // the requested backend. The default `requestDevice()` call grants only 8192×8192 textures
    // — too small for some authored beatoraja skins (e.g. GdbG_Skin's `fonts/bitmap/Title_*.png`
    // is 8000×12000). When the adapter advertises a higher limit (16384 on most modern GPUs),
    // we ask for it explicitly so those textures upload without the fallback chain emitting a
    // cascade of "Invalid Texture" / "BindGroup invalid" errors that black out the chrome.
    // Failures here fall through to Pixi's stock device-creation path so we don't break boot on
    // older hardware.
    const gpu = preference === 'webgpu' ? await tryCreateMaxLimitsGpu() : undefined;
    await this.app.init({
      preference,
      backgroundAlpha: 0,
      resizeTo: container,
      ...(gpu !== undefined ? { gpu } : {}),
      // LR2 skins and BGA frames are pixel-art; bilinear filtering and MSAA blur them visibly. Combined with
      // `roundPixels: true` and per-texture nearest sampling on each loaded asset, this gives a fully-crisp
      // pixel-art-style render.
      antialias: false,
      autoDensity: true,
      // Cap the render-buffer multiplier at 2× the CSS resolution. LR2 / BMS art is pixel-art rendered through
      // `roundPixels: true` + nearest sampling — a 3× DPR Retina display brings no perceptual benefit but multiplies
      // the GPU's fillrate cost by ~9× compared to the 1× CSS pixel grid. The cap drops a 3× DPR display to 56 % of
      // the previous fragment count; 1× / 2× displays (the common case) are unaffected.
      resolution: Math.min(2, globalThis.devicePixelRatio || 1),
      roundPixels: true,
      // Force the discrete GPU on hybrid systems (every modern laptop with switchable graphics). Rhythm-game
      // input-to-display latency is critical, and the integrated-GPU path adds variable frame-time on top of the
      // base 60 Hz tick. The `'high-performance'` hint makes the browser request the dGPU at context creation,
      // which on macOS / Windows pins the renderer to the powerful adapter for the rest of the session. Pixi v8
      // forwards this option to both the WebGPU and WebGL2 backends.
      powerPreference: 'high-performance',
      // Tighten Pixi's TextureGCSystem windows. Defaults are 30 s check / 60 s idle-eviction; that's too lax for BMS
      // playback where the BGA prepass loads dozens of frames that may be referenced exactly once and then never
      // again (animated layered BGAs cycle through a frame band; a #BGA-defined freeze frame fires once and is dead
      // for the rest of the chart). Halving both windows lets the GPU reclaim those one-shot textures within ~30 s
      // of their last reference, smoothing peak texture-memory across long sessions. The CPU cost is the GC
      // walk itself, which is a single pass over the texture cache every 15 s — negligible next to a per-frame
      // render pass.
      gcMaxUnusedTime: 30_000,
      gcFrequency: 15_000,
      ...options?.appOptions,
    });
    // Surface the actual renderer type — the `preference` field is a *hint*, and the real backend may differ if WebGPU
    // init failed silently or if the override flag was used.
    log.info('renderer ready', {
      requested: preference,
      actual: rendererTypeLabel(this.app.renderer.type),
    });
    this.app.canvas.tabIndex = 0;
    this.app.canvas.setAttribute('aria-label', 'be-music stage');
    // Compositor isolation. `contain: content` (= `layout paint style`) tells the browser the canvas's visual
    // contents can't affect — and aren't affected by — anything outside its box. The compositor can then skip
    // walking siblings / ancestors when the canvas repaints (= every frame), trimming a few hundred μs of
    // main-thread work per repaint on dense pages. We deliberately omit the `size` containment that the stricter
    // `strict` value would add — Pixi sets `<canvas>` width/height explicitly via `resizeTo`, but `contain: size`
    // ignores intrinsic content size during layout, which can interact poorly with the host's ResizeObserver
    // path on some browsers. `pointer-events` is intentionally left at `auto` so Pixi's hit-testing
    // (song-select buttons, debug menu, result-screen actions) keeps working.
    this.app.canvas.style.contain = 'content';
    this.app.stage.label = 'host/stage';
    container.appendChild(this.app.canvas);
  }

  /**
   * Replaces the active scene. Awaitable so callers can chain follow-up work (loading a song, etc.) once the new
   * scene's `enter()` has resolved. Idempotent — passing the already-active scene returns immediately.
   */
  public setScene(scene: PixiScene | undefined): Promise<void> {
    const next = (async () => {
      await this.transitionLock;
      if (this.disposed || this.current === scene) {
        return;
      }
      const previous = this.current;
      this.current = scene;
      if (previous) {
        try {
          await previous.exit();
        } catch (error) {
          log.warn('previous scene.exit threw', error);
        }
        if (previous.root.parent === this.app.stage) {
          this.app.stage.removeChild(previous.root);
        }
      }
      if (scene && !this.disposed) {
        try {
          await scene.enter(this);
        } catch (error) {
          log.warn('next scene.enter threw', error);
        }
        if (!this.disposed) {
          this.app.stage.addChild(scene.root);
        }
      }
    })();
    this.transitionLock = next.catch(() => undefined);
    return next;
  }

  public getCurrentScene(): PixiScene | undefined {
    return this.current;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.current) {
      try {
        this.current.dispose();
      } catch (error) {
        log.warn('scene.dispose threw', error);
      }
      this.current = undefined;
    }
    try {
      // With only ONE Application owned by the process, releasing the module-shared `batchPool` here is safe — no other
      // live Application can be tripped up by the cleared pool. (See the class doc-block above for the
      // multi-Application landmine we used to hit.)
      this.app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
    } catch (error) {
      log.warn('app.destroy threw', error);
    }
  }
}

/**
 * Pre-create a `(adapter, device)` pair with the adapter's MAX texture-dimension and texture-
 * size limits, then hand it to Pixi via `app.init({ gpu })`. Returns `undefined` when WebGPU
 * isn't available or the request fails — Pixi falls back to its stock device-creation path
 * with default 8192-px limits in that case.
 *
 * Background: WebGPU's default `maxTextureDimension2D` is 8192 even on adapters that advertise
 * 16384 (or more); the higher limit must be requested explicitly via `requiredLimits`. Some
 * authored beatoraja skins ship enormous bitmap-font atlases (GdbG_Skin's `Title_*.png` is
 * 8000×12000), which fail to upload at the default limit and surface as a cascade of
 * "Invalid Texture" / "BindGroup invalid" errors blacking out the chrome.
 *
 * The function asks for the adapter's full advertised limits — the browser clamps to whatever
 * the GPU actually supports, so this is safe across hardware. Limits requested:
 *   - `maxTextureDimension1D` / `maxTextureDimension2D` / `maxTextureDimension3D`
 *   - `maxBufferSize` (some skins ship large atlases that imply correspondingly large buffers)
 *
 * Errors are caught and logged so a single oddball adapter doesn't break boot.
 */
async function tryCreateMaxLimitsGpu(): Promise<{ adapter: GPUAdapter; device: GPUDevice } | undefined> {
  if (typeof globalThis === 'undefined') return undefined;
  const navGpu = (globalThis.navigator as { gpu?: GPU } | undefined)?.gpu;
  if (navGpu === undefined) return undefined;
  try {
    const adapter = await navGpu.requestAdapter({ powerPreference: 'high-performance' });
    if (adapter === null) return undefined;
    // Pixi's own `_createDeviceAndAdaptor` path requests these features iff the adapter has
    // them. Mirror that here so we don't downgrade compression-format support when we take
    // over device creation.
    const requiredFeatures = (
      ['texture-compression-bc', 'texture-compression-astc', 'texture-compression-etc2'] as GPUFeatureName[]
    ).filter((feature) => adapter.features.has(feature));
    const limits: Record<string, number> = {};
    const maxDim2D = adapter.limits.maxTextureDimension2D;
    const maxDim1D = adapter.limits.maxTextureDimension1D;
    const maxDim3D = adapter.limits.maxTextureDimension3D;
    const maxBuf = adapter.limits.maxBufferSize;
    if (Number.isFinite(maxDim2D) && maxDim2D > 0) limits.maxTextureDimension2D = maxDim2D;
    if (Number.isFinite(maxDim1D) && maxDim1D > 0) limits.maxTextureDimension1D = maxDim1D;
    if (Number.isFinite(maxDim3D) && maxDim3D > 0) limits.maxTextureDimension3D = maxDim3D;
    if (Number.isFinite(maxBuf) && maxBuf > 0) limits.maxBufferSize = maxBuf;
    const device = await adapter.requestDevice({ requiredFeatures, requiredLimits: limits });
    log.info('webgpu device requested with adapter-max limits', {
      maxTextureDimension2D: maxDim2D,
      maxBufferSize: maxBuf,
      features: requiredFeatures,
    });
    return { adapter, device };
  } catch (error) {
    log.warn('failed to pre-create webgpu device with adapter-max limits — falling back to defaults', error);
    return undefined;
  }
}

/**
 * Reads `?renderer=...` from `window.location.search` and maps it onto a PixiJS `preference` value. Defaults to
 * `'webgpu'`; only the explicit `webgl` form opts out (any other value, missing window object, or unrecognized input
 * falls through to the default). PixiJS auto-falls-back to WebGL2 if WebGPU isn't available, so the default is safe
 * across the entire browser matrix.
 *
 * Exported for testability — callers should normally let {@link PixiSceneHost.mount} resolve this internally.
 */
export function resolveRendererPreference(rawSearch?: string): 'webgl' | 'webgpu' {
  const search =
    rawSearch ??
    (typeof globalThis !== 'undefined' && typeof globalThis.location !== 'undefined' ? globalThis.location.search : '');
  if (!search) return 'webgpu';
  const params = new URLSearchParams(search);
  const flag = params.get('renderer');
  if (flag === 'webgl') return 'webgl';
  return 'webgpu';
}

/**
 * Maps a PixiJS `RendererType` enum value to a human-readable label for the post-init console log. Falls back to the
 * numeric tag if the enum gets a new variant we haven't accounted for.
 */
function rendererTypeLabel(type: RendererType): string {
  switch (type) {
    case RendererType.WEBGL:
      return 'webgl';
    case RendererType.WEBGPU:
      return 'webgpu';
    case RendererType.CANVAS:
      return 'canvas';
    case RendererType.BOTH:
      return 'both';
    default:
      return `unknown(${type})`;
  }
}

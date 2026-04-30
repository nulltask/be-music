import { Application, type ApplicationOptions, Container, RendererType } from 'pixi.js';

/**
 * A single PixiJS scene that lives inside a {@link PixiSceneHost}.
 * Each scene owns a `root` Container and is responsible for adding
 * its own children to it; the host attaches/detaches that root from
 * the shared `app.stage` on transitions.
 *
 * Implementation contract:
 *
 * - `enter(host)` is called once when the scene becomes active.
 *   Allocate per-scene resources (textures / event listeners /
 *   ticker callbacks) here.
 * - `exit()` is called when another scene takes over. Stop ticker
 *   callbacks and detach window-level event listeners. Heavy GPU
 *   resources can stay alive if the scene is meant to be re-entered
 *   later (see {@link PixiSceneHost.setScene}'s `keepAlive` option).
 * - `dispose()` is the permanent cleanup. After this call the
 *   scene must not be re-entered.
 *
 * Scenes do **not** call `Application.destroy()` — that's the host's
 * job, and only at process / page shutdown. This is the central
 * idea behind the multi-scene refactor: keeping a single Application
 * (and therefore a single WebGL context) alive across the whole
 * session avoids Pixi v8's module-shared `batchPool` race that bit
 * us when two `Application` instances ran side-by-side.
 */
export interface PixiScene {
  /**
   * Container the host attaches to its `app.stage` when this scene
   * is active. Scenes build their own scene graph as children of
   * this `root`.
   */
  readonly root: Container;
  enter(host: PixiSceneHost): Promise<void> | void;
  exit(): Promise<void> | void;
  dispose(): void;
}

export interface PixiSceneHostMountOptions {
  /**
   * Optional override for the underlying `Application.init` options.
   * The host fills in opinionated defaults (no antialias, nearest
   * sampling, devicePixelRatio resolution, transparent BG) that
   * match the LR2 pixel-art aesthetic; pass an override to swap any
   * subset for a specific deployment.
   */
  appOptions?: Partial<ApplicationOptions>;
}

/**
 * Owns the single PixiJS `Application` (and therefore the single
 * WebGL context) for the whole player session. Scenes are attached
 * via {@link setScene}; only one scene is "active" (visible +
 * receiving ticker callbacks via its own scope) at a time.
 *
 * Why this exists: PixiJS v8 keeps a module-level `batchPool`
 * that's destroyed when **any** `Application.destroy()` is called
 * with the `releaseGlobalResources` flag (which the boolean
 * `app.destroy(true, ...)` shorthand sets implicitly). With two
 * `Application`s alive at once, tearing one of them down nulls out
 * shared `Batch` instances that the other app's renderer then
 * crashes on at `_DefaultBatcher.break`. Funnelling everything
 * through one `Application` instance dodges that landmine entirely
 * — and matches the official "use a single Application for the
 * lifetime of your app" guidance in the PixiJS docs.
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
   * Serialises in-flight `setScene` calls. Without it a
   * fast-double-toggle (e.g. ESC-then-immediate-song-pick) could
   * interleave a new scene's `enter()` with a previous scene's
   * `exit()`, leaving both attached to the stage.
   */
  private transitionLock: Promise<void> = Promise.resolve();

  public async mount(container: HTMLElement, options?: PixiSceneHostMountOptions): Promise<void> {
    if (this.mounted) {
      return;
    }
    this.mounted = true;
    // Renderer preference. Defaults to WebGPU per the project's
    // perf goals (lower per-frame CPU on dense charts, room for
    // future compute-shader BGA effects). PixiJS auto-falls-back
    // to WebGL2 when the browser doesn't expose WebGPU, so this is
    // safe to leave on for old browsers — `app.renderer.type`
    // logged below confirms which path actually came up.
    //
    // The `?renderer=webgl` URL flag forces WebGL2 for A/B testing
    // (regression triage on devices where WebGPU happens to be
    // slower or buggier). Anything else falls through to the
    // default. `?renderer=webgpu` is accepted as the explicit form
    // even though it's the default, useful for documenting the
    // intent in deployed URLs.
    const preference = resolveRendererPreference();
    await this.app.init({
      preference,
      backgroundAlpha: 0,
      resizeTo: container,
      // LR2 skins and BGA frames are pixel-art; bilinear filtering
      // and MSAA blur them visibly. Combined with `roundPixels: true`
      // and per-texture nearest sampling on each loaded asset, this
      // gives a fully-crisp pixel-art-style render.
      antialias: false,
      autoDensity: true,
      resolution: globalThis.devicePixelRatio || 1,
      roundPixels: true,
      ...options?.appOptions,
    });
    // Surface the actual renderer type — the `preference` field is
    // a *hint*, and the real backend may differ if WebGPU init
    // failed silently or if the override flag was used.
    // eslint-disable-next-line no-console
    console.log('[scene-host] renderer ready', {
      requested: preference,
      actual: rendererTypeLabel(this.app.renderer.type),
    });
    this.app.canvas.tabIndex = 0;
    this.app.canvas.setAttribute('aria-label', 'be-music stage');
    this.app.stage.label = 'host/stage';
    container.appendChild(this.app.canvas);
  }

  /**
   * Replaces the active scene. Awaitable so callers can chain
   * follow-up work (loading a song, etc.) once the new scene's
   * `enter()` has resolved. Idempotent — passing the already-active
   * scene returns immediately.
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
          // eslint-disable-next-line no-console
          console.warn('[scene-host] previous scene.exit threw', error);
        }
        if (previous.root.parent === this.app.stage) {
          this.app.stage.removeChild(previous.root);
        }
      }
      if (scene && !this.disposed) {
        try {
          await scene.enter(this);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn('[scene-host] next scene.enter threw', error);
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
        // eslint-disable-next-line no-console
        console.warn('[scene-host] scene.dispose threw', error);
      }
      this.current = undefined;
    }
    try {
      // With only ONE Application owned by the process, releasing
      // the module-shared `batchPool` here is safe — no other live
      // Application can be tripped up by the cleared pool. (See the
      // class doc-block above for the multi-Application landmine
      // we used to hit.)
      this.app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[scene-host] app.destroy threw', error);
    }
  }
}

/**
 * Reads `?renderer=...` from `window.location.search` and maps it
 * onto a PixiJS `preference` value. Defaults to `'webgpu'`; only
 * the explicit `webgl` form opts out (any other value, missing
 * window object, or unrecognised input falls through to the
 * default). PixiJS auto-falls-back to WebGL2 if WebGPU isn't
 * available, so the default is safe across the entire browser
 * matrix.
 *
 * Exported for testability — callers should normally let
 * {@link PixiSceneHost.mount} resolve this internally.
 */
export function resolveRendererPreference(rawSearch?: string): 'webgl' | 'webgpu' {
  const search =
    rawSearch ??
    (typeof globalThis !== 'undefined' && typeof globalThis.location !== 'undefined'
      ? globalThis.location.search
      : '');
  if (!search) return 'webgpu';
  const params = new URLSearchParams(search);
  const flag = params.get('renderer');
  if (flag === 'webgl') return 'webgl';
  return 'webgpu';
}

/**
 * Maps a PixiJS `RendererType` enum value to a human-readable
 * label for the post-init console log. Falls back to the numeric
 * tag if the enum gets a new variant we haven't accounted for.
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

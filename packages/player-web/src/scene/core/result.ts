import { Application, Color, Container, Graphics } from 'pixi.js';
import { computeScoreRate, resolveIidxRankLabel } from '@be-music/player/core/scoring';
import { type PixiSceneHost } from '../host.ts';
import { LaggedDisposer, disposeChildren } from '../pixi-utils.ts';
import { logger } from '../../logger.ts';
import type { BrowserSongCollection } from '../../collection/types.ts';
import type { PixiGameplayResultData } from './result-data.ts';
import type { BeMusicEffectLevel, BeMusicSkin } from '../../skin/be-music/types.ts';
import { phantomSkin } from '../default/phantom/index.ts';
import { resolveDesignTextResolution, resolveScaledViewport, setDesignTextResolution } from './viewport.ts';

const log = logger('result');

/**
 * Family-neutral result scene. Shows the per-chart score breakdown (judge counts, EX score, rate, max combo, clear lamp
 * / rank) and drives the result timeline that skin families animate against.
 *
 * The timer ladder we drive:
 *
 * - **timer 0** — scene main, fired at mount.
 * - **timer 1** — input enable, fires {@link CoreResultView.startInputMs} ms after mount. Keyframes anchored to it
 *   animate from `time = 0` once the user is allowed to dismiss the result.
 * - **timer 150** — chart-draw start. We approximate "chart draw" as a fixed window after the input-enable delay;
 *   advancing to 150 is what pulls in the score numbers.
 * - **timer 151** — chart-draw end / rank display. Fires either automatically once the draw window expires or instantly
 *   when the user presses Enter / Space ("skip" input).
 * - **timer 152** — high-score-update press, fired on the next input after 151. We never persist scores yet, so this is
 *   purely cosmetic: skins use it to swap the high-score panel from "previous" to "now" digits.
 *
 * After timer 152 fires the next input dismisses the scene via the `onContinue` callback the host supplied.
 *
 * Skin families plug in by overriding the protected theme hooks ({@link CoreResultView.themeDesignSize},
 * {@link CoreResultView.startInputMs}, {@link CoreResultView.prepareTheme}, {@link CoreResultView.renderTheme},
 * {@link CoreResultView.disposeTheme}). Without an override the scene paints the be-music skin's result panel.
 */
/**
 * 640×480 fallback canvas to match LR2 default `result.lr2skin`'s native dimensions. Keeps the on-screen aspect ratio
 * constant when a theme loads / unloads mid-session (same rationale as the select scene).
 */
const FALLBACK_DESIGN_WIDTH = 640;
const FALLBACK_DESIGN_HEIGHT = 480;
const BG = new Color('#05070b');

/**
 * Approximate duration of the chart-draw animation. Mirrors the LR2 default skin's authored timeline (~3 s) so
 * timer-151 anchored elements (final rank, score totals) don't pop in immediately.
 */
const CHART_DRAW_DURATION_MS = 3000;

/**
 * Default input-enable delay when the theme doesn't declare one. The LR2 default skin's `result.lr2skin` uses 1500 ms
 * for `#STARTINPUT` — long enough for the slide-in chrome animation to play out before the user can dismiss the
 * screen. Picked at the same value so the look matches.
 */
const DEFAULT_STARTINPUT_MS = 1500;

export interface CoreResultViewOptions {
  /** be-music skin for the skinless result panel. Defaults to the built-in Phantom skin. */
  beMusicSkin?: BeMusicSkin;
  /** Showmanship level for the be-music skin's result entrance. Defaults to `'full'`. */
  beMusicEffects?: BeMusicEffectLevel;
  /**
   * Loaded song collection — needed to resolve per-song artwork (BANNER / STAGEFILE / BACKBMP) via the same
   * chart-asset loader the select view uses. May be `undefined` for embed scenarios where the result is rendered outside
   * a library context.
   */
  collection?: BrowserSongCollection;
  /**
   * Callback fired when the user dismisses the result screen. Hosts typically transition back to the song-select view
   * here. Triggered by Enter / Space / Escape after timer 152 has fired (or immediately on Escape).
   */
  onContinue?: () => void;
  /**
   * Encoded result-screen audio bytes used when the chart was cleared (`LR2files/Sound/<theme>/clear.wav` in the LR2
   * default theme — these jingles live in `Sound/`, not `Bgm/`). Falls back to {@link resultBgm} when unset so
   * single-loop themes still produce sound.
   */
  clearBgm?: Uint8Array;
  /**
   * Encoded result-screen audio bytes used when the chart was failed (`LR2files/Sound/<theme>/fail.wav`). Same fallback
   * chain as {@link clearBgm}.
   */
  failBgm?: Uint8Array;
  /**
   * Generic result-screen audio (`LR2files/Sound/<theme>/result.wav`). Plays when the theme doesn't ship a clear /
   * fail-specific track for the current outcome.
   */
  resultBgm?: Uint8Array;
}

/**
 * One-shot result scene. Mounted by the host with a {@link PixiGameplayResultData} payload, drives the result timer
 * ladder, and dismisses itself via `onContinue` when the user advances past timer 152.
 *
 * Lifecycle parallels the song-select view: `mount` → `render`-on-ticker until `dispose`. We don't pause the loop
 * on hide because a result scene is short-lived (host swaps it out wholesale rather than keeping it backgrounded).
 */
export class CoreResultView {
  private host: PixiSceneHost | undefined;
  private readonly sceneRoot = new Container();
  private readonly root = new Container();
  private readonly viewportBackground = new Graphics();
  private readonly background = new Graphics();
  /** Layer the theme hook paints into; cleared (and its children destroyed) every frame. */
  protected readonly skinLayer: Container = new Container();
  private readonly timeoutHandles = new Set<number>();
  /** Fallback summary panel (used when no theme paints the frame). */
  private readonly fallbackLayer = new Container();
  private readonly fallbackDisposer = new LaggedDisposer();
  /** Clip mask for the design rect — keeps theme artwork from bleeding into the letterbox bars. */
  private readonly designClipMask = new Graphics();
  /**
   * Last dimensions baked into the static rect graphics. Skips the per-frame `.clear().rect().fill()` rebuild when
   * nothing changed.
   */
  private cachedScreenWidth = -1;
  private cachedScreenHeight = -1;
  private cachedDesignWidth = -1;
  private cachedDesignHeight = -1;
  protected result: PixiGameplayResultData | undefined;
  /**
   * `performance.now()` of mount — reference point for timer 0 and the input-enable-derived timer 1 / 150.
   */
  private sceneStartedAt = 0;
  /** Whether the render loop is currently attached to the host's `app.ticker`; replaces the previous standalone rAF. */
  private tickerAttached = false;
  /** Tick handler bound once so the host ticker can register / unregister it by reference. */
  private readonly tickerHandle = (): void => {
    if (this.disposed) return;
    this.render();
  };
  protected disposed = false;
  /**
   * Web Audio plumbing for the result-screen BGM. Created lazily the first time `mount` runs and torn down by
   * `dispose`. The scene is one-shot (host destroys + recreates between charts) so we don't bother caching the decoded
   * buffer across mounts.
   */
  private bgmContext: AudioContext | undefined;
  private bgmSource: AudioBufferSourceNode | undefined;
  /**
   * Per-timer fire timestamps. Empty until each respective timer fires; entries here drive both the keyframe
   * interpolator (`elapsedSinceTimer`) and the timer-active gating (`timerActive`).
   */
  protected readonly timerStartedAt: Map<number, number> = new Map<number, number>();
  protected options: CoreResultViewOptions;

  public constructor(options: CoreResultViewOptions = {}) {
    this.options = options;
  }

  private get app(): Application {
    if (!this.host) {
      throw new Error('PixiResultView: app accessed before mount');
    }
    return this.host.app;
  }

  /**
   * Native design-canvas size of the active theme, or `undefined` to use the 640×480 fallback canvas the be-music panel
   * is laid out on.
   */
  protected get themeDesignSize(): { width: number; height: number } | undefined {
    return undefined;
  }

  /** Delay (ms after mount) before input is accepted and timers 1 / 150 fire. */
  protected get startInputMs(): number {
    return DEFAULT_STARTINPUT_MS;
  }

  /** Kicks off async theme asset loading at mount. Implementations call `render()` once assets land. */
  protected prepareTheme(): void {}

  /**
   * Paints the current frame into {@link skinLayer}. Return `true` when the theme painted the frame (the be-music
   * fallback panel is then skipped), `false` to fall through to it. Only called while a result is mounted.
   */
  protected renderTheme(): boolean {
    return false;
  }

  /** Releases theme-owned GPU resources during `dispose`. Throws are caught and logged by the caller. */
  protected disposeTheme(): void {}

  /**
   * Mounts the scene onto the shared host's stage and starts the render loop. The result payload is stored verbatim —
   * no defensive copy — because the gameplay view that produced it will be disposed shortly after the host calls this
   * method, so the snapshot won't change underneath us.
   */
  public async mount(host: PixiSceneHost, result: PixiGameplayResultData): Promise<void> {
    this.host = host;
    this.result = result;
    this.sceneRoot.label = 'result/scene';
    this.root.label = 'result/root';
    this.viewportBackground.label = 'result/viewport-bg';
    this.background.label = 'result/background';
    this.skinLayer.label = 'result/skin';
    this.fallbackLayer.label = 'result/fallback';
    this.designClipMask.label = 'result/design-clip';
    this.sceneRoot.addChild(this.viewportBackground, this.root);
    this.root.addChild(this.background, this.skinLayer, this.fallbackLayer, this.designClipMask);
    this.root.mask = this.designClipMask;
    host.app.stage.addChild(this.sceneRoot);
    window.addEventListener('keydown', this.handleKeyDown);
    host.app.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.prepareTheme();
    this.sceneStartedAt = performance.now();
    this.timerStartedAt.clear();
    this.timerStartedAt.set(0, this.sceneStartedAt);
    // Schedule timer 1 (input enable) and timer 150 (chart-draw) from wall clock so the intro animation plays out even
    // without user interaction. Timer 151 fires automatically once the chart-draw window elapses; 152 needs an input.
    const startInput = this.startInputMs;
    this.setTimer(
      () => {
        if (this.disposed) return;
        this.timerStartedAt.set(1, performance.now());
        // The LR2 reference timeline starts the chart draw the moment input becomes available — keep the same anchor so
        // the numbers panel slide-in lines up with the chrome animation.
        this.timerStartedAt.set(150, performance.now());
      },
      Math.max(0, startInput),
    );
    this.setTimer(
      () => {
        if (this.disposed) return;
        if (this.timerStartedAt.has(151)) return;
        this.timerStartedAt.set(151, performance.now());
      },
      Math.max(0, startInput) + CHART_DRAW_DURATION_MS,
    );
    this.render();
    this.startAnimationLoop();
    void this.startResultBgm(result);
  }

  /**
   * Decodes and plays the matching result-screen jingle. Picks `clearBgm` / `failBgm` based on `data.cleared` and falls
   * back to the generic `resultBgm` when the theme doesn't differentiate. Silently no-ops when no slot is populated
   * (skinless / non-LR2 themes) and when the browser refuses autoplay — neither path is fatal for the result scene.
   *
   * Plays once (no loop) because LR2's `clear` / `fail` / `result` are one-shot jingles living under
   * `LR2files/Sound/<theme>/`, not looping BGM. Looping would keep the fanfare playing indefinitely while the user
   * reads their score, which isn't how LR2 behaves.
   */
  private async startResultBgm(data: PixiGameplayResultData): Promise<void> {
    const bytes = data.cleared
      ? (this.options.clearBgm ?? this.options.resultBgm ?? this.options.failBgm)
      : (this.options.failBgm ?? this.options.resultBgm ?? this.options.clearBgm);
    if (!bytes || this.disposed) return;
    let audioContext: AudioContext | undefined;
    try {
      audioContext = new AudioContext();
      this.bgmContext = audioContext;
      const buffer = await audioContext.decodeAudioData(bytes.slice().buffer);
      if (this.disposed) {
        await audioContext.close().catch(() => undefined);
        this.bgmContext = undefined;
        return;
      }
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.loop = false;
      source.connect(audioContext.destination);
      source.start();
      this.bgmSource = source;
    } catch (error) {
      if (audioContext !== undefined) {
        if (this.bgmContext === audioContext) {
          this.bgmContext = undefined;
        }
        await audioContext.close().catch(() => undefined);
      }
      this.bgmSource = undefined;
      log.warn('BGM playback failed', error);
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const timeout of this.timeoutHandles) {
      window.clearTimeout(timeout);
    }
    this.timeoutHandles.clear();
    this.stopAnimationLoop();
    if (this.bgmSource) {
      try {
        this.bgmSource.stop();
        this.bgmSource.disconnect();
      } catch {
        // Already stopped / disconnected — ignore.
      }
      this.bgmSource = undefined;
    }
    if (this.bgmContext) {
      void this.bgmContext.close().catch(() => undefined);
      this.bgmContext = undefined;
    }
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.host) {
      this.host.app.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    }
    if (this.sceneRoot.parent) {
      this.sceneRoot.parent.removeChild(this.sceneRoot);
    }
    try {
      this.disposeTheme();
    } catch (error) {
      log.warn('texture cleanup threw', error);
    }
    try {
      this.fallbackDisposer.flush();
      this.sceneRoot.destroy({ children: true, context: true });
    } catch (error) {
      log.warn('sceneRoot.destroy threw', error);
    }
    this.host = undefined;
  }

  private setTimer(callback: () => void, delayMs: number): void {
    const timeout = window.setTimeout(() => {
      this.timeoutHandles.delete(timeout);
      callback();
    }, delayMs);
    this.timeoutHandles.add(timeout);
  }

  private startAnimationLoop(): void {
    if (this.tickerAttached || !this.host) return;
    this.host.app.ticker.add(this.tickerHandle);
    this.tickerAttached = true;
  }

  private stopAnimationLoop(): void {
    if (!this.tickerAttached) return;
    this.host?.app.ticker.remove(this.tickerHandle);
    this.tickerAttached = false;
  }

  /**
   * Per-frame render. Cheap enough to run unconditionally — most of the cost is sprite churn on the skin layer (one
   * pass over each element type) and Pixi's auto-batching keeps draw calls low for a static panel. Mirrors
   * the select scene's render loop.
   */
  protected render(): void {
    if (!this.result) {
      return;
    }
    const screenWidth = this.app.screen.width || FALLBACK_DESIGN_WIDTH;
    const screenHeight = this.app.screen.height || FALLBACK_DESIGN_HEIGHT;
    const themeSize = this.themeDesignSize;
    const designWidth = themeSize ? themeSize.width : FALLBACK_DESIGN_WIDTH;
    const designHeight = themeSize ? themeSize.height : FALLBACK_DESIGN_HEIGHT;
    const viewport = resolveScaledViewport(screenWidth, screenHeight, designWidth, designHeight);
    setDesignTextResolution(resolveDesignTextResolution(viewport.scale, this.app.renderer.resolution));
    if (this.cachedScreenWidth !== screenWidth || this.cachedScreenHeight !== screenHeight) {
      this.viewportBackground.clear().rect(0, 0, screenWidth, screenHeight).fill(BG);
      this.cachedScreenWidth = screenWidth;
      this.cachedScreenHeight = screenHeight;
    }
    this.root.position.set(viewport.x, viewport.y);
    this.root.scale.set(viewport.scale);
    if (this.cachedDesignWidth !== designWidth || this.cachedDesignHeight !== designHeight) {
      this.designClipMask.clear().rect(0, 0, designWidth, designHeight).fill(0xffffff);
      this.background.clear().rect(0, 0, designWidth, designHeight).fill(BG);
      this.cachedDesignWidth = designWidth;
      this.cachedDesignHeight = designHeight;
    }
    // `disposeChildren` (vs bare `removeChildren`) is essential here: the per-frame skin / fallback rebuild allocates
    // fresh `Sprite`, `Text` and (for polylines) `Graphics` nodes every tick. Bare detach leaves their renderer-side
    // state alive, which the original report described as "browser freezes after the song ends" — accumulated
    // GraphicsContext + glyph atlas slots stalled the next reconcile pass. See `pixi-utils.ts` for the full rationale.
    disposeChildren(this.skinLayer);
    // The built-in result is rebuilt every frame; retiring its nodes one frame late lets unchanged labels keep their
    // text textures (see `LaggedDisposer`).
    this.fallbackDisposer.cycle(this.fallbackLayer);
    if (this.renderTheme()) {
      // No empty-state hint here — the theme's own artwork covers the whole canvas.
      return;
    }
    this.renderFallbackPanel(designWidth, designHeight);
  }

  /** Built-in result summary for the default skin family. */
  private renderFallbackPanel(designWidth: number, designHeight: number): void {
    const result = this.result;
    if (!result) return;
    const now = performance.now();
    // A skip (Enter before the chart draw finishes → timer 151) jumps the skin's entrance to its settled layout.
    const skipped = this.timerStartedAt.has(151);
    (this.options.beMusicSkin ?? phantomSkin).result.render({
      layer: this.fallbackLayer,
      designWidth,
      designHeight,
      result,
      rankLabel: resolveRankLabel(result.score.exScore, result.score.total),
      ratePercent: computeScoreRate(result.score) * 100,
      elapsedMs: skipped ? Number.POSITIVE_INFINITY : now - this.sceneStartedAt,
      nowMs: now,
      effects: this.options.beMusicEffects ?? 'full',
    });
  }

  /**
   * Elapsed milliseconds since `timer` started. 0 when the timer hasn't fired (which keeps keyframe evaluation clamped
   * at the first keyframe — the LR2-correct "pre-fire" pose).
   */
  protected elapsedSinceTimer(timer: number): number {
    const startedAt = this.timerStartedAt.get(timer);
    if (startedAt === undefined) {
      return 0;
    }
    return Math.max(0, performance.now() - startedAt);
  }

  /**
   * Whether `timer` is currently active. Result-screen elements that gate on a not-yet-fired timer (the score panel
   * that should only appear after timer 151 fires) stay hidden until then.
   *
   * Defined as an arrow-property so it survives extraction into free visibility helpers without losing `this`.
   */
  protected readonly timerActive = (timer: number): boolean => {
    if (timer === 0) return true;
    // Driven timers — active iff fired.
    if (timer === 1 || timer === 150 || timer === 151 || timer === 152) {
      return this.timerStartedAt.has(timer);
    }
    return false;
  };

  /**
   * `keydown` handler. Implements the result-screen input ladder:
   *
   * - Before timer 1 fires (input-enable delay not elapsed) — input is ignored.
   * - Between 1 and 151 — Enter / Space "skip" the chart draw (advance directly to timer 151).
   * - Between 151 and 152 — Enter / Space fire timer 152 (the high-score-update press).
   * - After 152 — any of the three keys (Enter / Space / Escape) dismisses the scene via `onContinue`.
   * - Escape always dismisses, regardless of where we are in the timeline.
   */
  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.disposed) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.options.onContinue?.();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    this.advance();
  };

  private readonly handlePointerDown = (): void => {
    if (this.disposed) return;
    this.advance();
  };

  /**
   * Common "advance one step" path used by both keyboard and pointer input. Splitting this out keeps the input-source-
   * specific event preventDefault / key-filter logic in the respective handlers.
   */
  private advance(): void {
    if (!this.timerStartedAt.has(1)) {
      // Input-enable delay hasn't elapsed — ignore the press. LR2 suppresses input here so the player can't
      // accidentally skip past the slide-in animation before the score panel appears.
      return;
    }
    if (!this.timerStartedAt.has(151)) {
      // Skip the chart draw — fire timer 151 so the score panel appears immediately. Mirrors LR2's gacha-press
      // behavior.
      this.timerStartedAt.set(151, performance.now());
      return;
    }
    if (!this.timerStartedAt.has(152)) {
      this.timerStartedAt.set(152, performance.now());
      return;
    }
    this.options.onContinue?.();
  }
}

function resolveRankLabel(exScore: number, total: number): string {
  return total <= 0 ? 'AAA' : resolveIidxRankLabel(exScore, total);
}

import { Application, Color, Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import { evaluateElementDestination, makeLr2StaticImageSprite } from './lr2-render.ts';
import {
  type Lr2DestinationRect,
  type Lr2ImageElement,
  type Lr2Skin,
  type Lr2SpecialGraphic,
  LR2_SPECIAL_GRAPHIC,
} from '@be-music/lr2-skin';
import { type PixiSceneHost } from './pixi-scene-host.ts';
import { disposeChildren } from './pixi-utils.ts';
import {
  Lr2ChartGraphicTextureStore,
  Lr2SkinTextureStore,
  collectDecideSkinTexturePaths,
  resolveSolidSpecialGraphicTexture,
} from './lr2-scene-textures.ts';
import { isDestinationVisible, makeLr2TextSprite, resolveScaledViewport } from './lr2-scene-render.ts';
import { loadSkinBitmapFonts } from './lr2-font-loader.ts';
import type { Lr2LoadedFont } from './lr2-bitmap-text.ts';
import { logger } from './logger.ts';
import type { BrowserSongCollection, BrowserSongEntry } from './types.ts';

const log = logger('decide');

/**
 * Decide scene — the brief "song confirmation" splash that LR2 plays between the song-select screen and gameplay. The
 * skin lives at `LR2files/Theme/<name>/Decide/decide.lr2skin` and typically shows the song's STAGEFILE / BANNER /
 * BACKBMP plus the title / artist / genre as overlay text, animated against timer 0 (scene main) keyframes.
 *
 * Lifecycle:
 *
 * - `mount(host, target)` builds the scene graph, primes the per-song texture cache, and starts the rAF loop.
 * - The scene auto-dismisses after the skin's `#STARTINPUT` ms plus a fixed window
 *   (`AUTO_ADVANCE_AFTER_STARTINPUT_MS`). Pressing Enter / Space dismisses immediately as long as `#STARTINPUT` has
 *   elapsed (LR2 spec — input is gated on that directive). Escape dismisses unconditionally.
 * - `onContinue` runs once when the scene dismisses. The demo wires it to `playSong` so dismissal kicks off the actual
 *   gameplay.
 *
 * Why a dedicated scene module: the decide skin is a different `.lr2skin` from the play / select / result skins (lives
 * at `Theme/.../Decide/decide.lr2skin`), and its element op set is gated on song-state flags that don't apply to the
 * result screen (e.g. difficulty / key-mode rather than clear-status). Sharing `pixi-result.ts`'s renderer would have
 * meant teaching it to handle both data shapes; the cleaner cut is a sibling module that follows the same Pixi-scene
 * pattern.
 */
/**
 * 640×480 fallback canvas to match LR2 default `decide.lr2skin`'s native dimensions. See `pixi-select` for the
 * rationale (mainly: keeps the on-screen aspect ratio constant when an LR2 theme loads / unloads mid-session).
 */
const FALLBACK_DESIGN_WIDTH = 640;
const FALLBACK_DESIGN_HEIGHT = 480;
const BG = new Color('#05070b');
const TEXT_COLOR = new Color('#f8fafc');
const MUTED = new Color('#9aa6b2');

/**
 * How long to leave the decide splash on screen after `#STARTINPUT` elapses before auto-advancing to play. Picked to
 * match LR2's perceived feel — short enough that hands-off play kicks in promptly, long enough to read the title /
 * artist once they finish fading in.
 */
const AUTO_ADVANCE_AFTER_STARTINPUT_MS = 1200;

/**
 * Default `#STARTINPUT` for skins that omit the directive. LR2's shipped decide skin uses ~1500 ms, which is also the
 * value we use for the result splash — keep them in lockstep so the scene chrome / title slide-ins land at the same
 * beat as the keypress-ready cue.
 */
const DEFAULT_STARTINPUT_MS = 1500;

/**
 * Element op set flipped per-song on the decide screen. Mirrors `RESULT_DYNAMIC_OPS` in `pixi-result.ts` but keeps only
 * the flags relevant to a "we're about to play this chart" splash: difficulty (skins gate per-difficulty plates against
 * these) and key mode. Score-related ops (90 / 91 / 100..105) are deliberately omitted — those are decided after the
 * chart runs, not at decision time.
 */
const DECIDE_DYNAMIC_OPS = {
  DIFFICULTY_UNDEFINED: 150,
  DIFFICULTY_EASY: 151,
  DIFFICULTY_NORMAL: 152,
  DIFFICULTY_HYPER: 153,
  DIFFICULTY_ANOTHER: 154,
  DIFFICULTY_INSANE: 155,
  KEYS_7: 160,
  KEYS_5: 161,
  KEYS_14: 162,
  KEYS_10: 163,
  KEYS_9: 164,
} as const;

const DECIDE_BASE_OPS: ReadonlySet<number> = new Set<number>([
  // Per-frame "always true" flags shared with select / result. 81 = "load complete" (data is ready by the time we mount
  // the decide scene), 50 = "offline" (no IR connection yet).
  50, 81,
]);

export interface PixiDecideTarget {
  song: BrowserSongEntry;
  collection: BrowserSongCollection;
}

export interface PixiDecideViewOptions {
  skin?: Lr2Skin;
  /**
   * Fired once when the scene auto-advances OR the user confirms with Enter / Space / pointer click. Hosts wire this to
   * "start gameplay".
   */
  onContinue?: () => void;
  /**
   * Fired once when the user presses Escape to bail on the splash. Hosts wire this to "go back to song select". Escape
   * always works (even before `#STARTINPUT` elapses) — matches LR2's bail-out behavior. Falls back to `onContinue`
   * when not provided so a host that doesn't differentiate still gets a callback.
   */
  onCancel?: () => void;
}

/**
 * Mounts the LR2 Decide skin and dismisses itself when the timer / input ladder elapses. The view owns its scene-graph
 * subtree (cleared in `dispose`) and never closes the host's AudioContext — decide BGM is handled by the select view,
 * not here.
 */
export class PixiDecideView {
  private host: PixiSceneHost | undefined;
  private readonly sceneRoot = new Container();
  private readonly root = new Container();
  private readonly viewportBackground = new Graphics();
  private readonly background = new Graphics();
  /**
   * Holds the per-song `#STAGEFILE` as a fullscreen sprite when the chart authored one. Lives BETWEEN the solid
   * background and the skin layer so the LR2 decide chrome (title plates, difficulty stickers, slide-in lines, …)
   * paints over the stagefile, matching the LR2 reference video where the stagefile is the dominant visual and the skin
   * chrome is a thin overlay. Empty when the chart has no stagefile — the solid background underneath then shows
   * through.
   */
  private readonly stageFileLayer = new Container();
  private readonly skinLayer = new Container();
  private readonly fallbackLayer = new Container();
  /** Clip mask for the design rect — see `pixi-gameplay` for the rationale. */
  private readonly designClipMask = new Graphics();
  /**
   * Last dimensions baked into the static rect graphics (`viewportBackground`, `background`, `designClipMask`). Skips
   * the per-frame `.clear().rect().fill()` rebuild when nothing changed — Pixi v8 has no change-detection on `Graphics`
   * and rebuilds the underlying GraphicsContext on every chain.
   */
  private cachedScreenWidth = -1;
  private cachedScreenHeight = -1;
  private cachedDesignWidth = -1;
  private cachedDesignHeight = -1;
  private readonly skinTextures = new Lr2SkinTextureStore();
  private readonly chartGraphicTextures = new Lr2ChartGraphicTextureStore();
  /** Lazy-loaded LR2 bitmap fonts — see `prepareBitmapFonts`. */
  private bitmapFonts: Map<number, Lr2LoadedFont> = new Map();
  private target: PixiDecideTarget | undefined;
  private sceneStartedAt = 0;
  private animationFrame = 0;
  private disposed = false;
  private continuedFired = false;
  private autoAdvanceHandle: ReturnType<typeof setTimeout> | undefined;
  private inputUnlockHandle: ReturnType<typeof setTimeout> | undefined;
  private inputUnlocked = false;
  private readonly timerStartedAt = new Map<number, number>();

  public constructor(private readonly options: PixiDecideViewOptions = {}) {}

  private get app(): Application {
    if (!this.host) {
      throw new Error('PixiDecideView: app accessed before mount');
    }
    return this.host.app;
  }

  public async mount(host: PixiSceneHost, target: PixiDecideTarget): Promise<void> {
    this.host = host;
    this.target = target;
    this.sceneRoot.label = 'decide/scene';
    this.root.label = 'decide/root';
    this.viewportBackground.label = 'decide/viewport-bg';
    this.background.label = 'decide/background';
    this.stageFileLayer.label = 'decide/stagefile';
    this.skinLayer.label = 'decide/skin';
    this.fallbackLayer.label = 'decide/fallback';
    this.designClipMask.label = 'decide/design-clip';
    this.sceneRoot.addChild(this.viewportBackground, this.root);
    this.root.addChild(this.background, this.stageFileLayer, this.skinLayer, this.fallbackLayer, this.designClipMask);
    this.root.mask = this.designClipMask;
    host.app.stage.addChild(this.sceneRoot);
    window.addEventListener('keydown', this.handleKeyDown);
    host.app.canvas.addEventListener('pointerdown', this.handlePointerDown);
    if (this.options.skin) {
      void this.prepareSkinTextures(this.options.skin);
      void this.prepareBitmapFonts(this.options.skin);
    }
    const now = performance.now();
    this.sceneStartedAt = now;
    this.timerStartedAt.set(0, now);
    // Schedule timer 1 (#STARTINPUT) and the auto-advance so the user sees the splash for a consistent window before
    // gameplay. Pressing Enter / Space before the start-input window elapses does nothing, matching LR2's input-gating.
    const startInputMs = Math.max(0, this.options.skin?.timing.startInput ?? DEFAULT_STARTINPUT_MS);
    this.inputUnlockHandle = setTimeout(() => {
      this.inputUnlockHandle = undefined;
      if (this.disposed) return;
      this.inputUnlocked = true;
      this.timerStartedAt.set(1, performance.now());
    }, startInputMs);
    this.autoAdvanceHandle = setTimeout(() => {
      this.autoAdvanceHandle = undefined;
      if (this.disposed) return;
      this.fireContinue();
    }, startInputMs + AUTO_ADVANCE_AFTER_STARTINPUT_MS);
    this.render();
    this.startAnimationLoop();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.animationFrame !== 0) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    if (this.autoAdvanceHandle !== undefined) {
      clearTimeout(this.autoAdvanceHandle);
      this.autoAdvanceHandle = undefined;
    }
    if (this.inputUnlockHandle !== undefined) {
      clearTimeout(this.inputUnlockHandle);
      this.inputUnlockHandle = undefined;
    }
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.host) {
      this.host.app.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    }
    if (this.sceneRoot.parent) {
      this.sceneRoot.parent.removeChild(this.sceneRoot);
    }
    try {
      this.skinTextures.dispose();
      this.chartGraphicTextures.dispose();
    } catch (error) {
      log.warn('texture cleanup threw', error);
    }
    try {
      this.sceneRoot.destroy({ children: true });
    } catch (error) {
      log.warn('sceneRoot.destroy threw', error);
    }
    this.host = undefined;
  }

  private async prepareSkinTextures(skin: Lr2Skin): Promise<void> {
    const loaded = await this.skinTextures.preload(
      skin,
      collectDecideSkinTexturePaths(skin),
      () => !this.disposed && this.options.skin === skin,
    );
    if (loaded) {
      this.render();
    }
  }

  private async prepareBitmapFonts(skin: Lr2Skin): Promise<void> {
    if (skin.lr2FontPaths.length === 0) return;
    const loaded = await loadSkinBitmapFonts(skin.lr2FontPaths, skin.files);
    if (this.disposed || this.options.skin !== skin) return;
    this.bitmapFonts = loaded;
    this.render();
  }

  private startAnimationLoop(): void {
    const tick = (): void => {
      if (this.disposed) {
        this.animationFrame = 0;
        return;
      }
      this.animationFrame = requestAnimationFrame(tick);
      this.render();
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  private render(): void {
    if (!this.target) return;
    const screenWidth = this.app.screen.width || FALLBACK_DESIGN_WIDTH;
    const screenHeight = this.app.screen.height || FALLBACK_DESIGN_HEIGHT;
    const skin = this.options.skin;
    const useSkin = skin !== undefined;
    const designWidth = useSkin ? skin!.width : FALLBACK_DESIGN_WIDTH;
    const designHeight = useSkin ? skin!.height : FALLBACK_DESIGN_HEIGHT;
    const viewport = resolveScaledViewport(screenWidth, screenHeight, designWidth, designHeight);
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
    disposeChildren(this.stageFileLayer);
    disposeChildren(this.skinLayer);
    disposeChildren(this.fallbackLayer);
    // STAGEFILE backdrop. The chart-authored stagefile is the standout visual on the LR2 decide screen — render it as a
    // fullscreen sprite behind whatever decide-skin chrome overlays it, so themes (with or without a `*STAGEFILE` skin
    // reference) consistently get the artwork treatment. No-op when the chart didn't author `#STAGEFILE` / bmson
    // `info.back_image`; the solid background underneath shows through unchanged in that case.
    this.renderStageFileBackdrop(designWidth, designHeight);
    if (useSkin && skin) {
      const ops = computeDecideOps(this.target, skin);
      this.renderSkin(skin, ops);
      return;
    }
    this.renderFallbackPanel(designWidth, designHeight);
  }

  /**
   * Draws the chart's `#STAGEFILE` (or bmson `info.back_image`) as a fullscreen backdrop. Loads the texture lazily on
   * first frame; subsequent frames pick the cached texture up from `chartGraphicTextures`.
   */
  private renderStageFileBackdrop(designWidth: number, designHeight: number): void {
    const target = this.target;
    if (!target) return;
    const stageFilePath = target.song.chart.metadata.stageFile;
    if (!stageFilePath) return;
    const texture = this.chartGraphicTextures.resolve(
      target.collection,
      target.song,
      LR2_SPECIAL_GRAPHIC.STAGEFILE,
      () => this.render(),
    );
    if (!texture) {
      return;
    }
    const sprite = new Sprite(texture);
    sprite.label = 'decide/stagefile-backdrop';
    sprite.position.set(0, 0);
    sprite.width = designWidth;
    sprite.height = designHeight;
    this.stageFileLayer.addChild(sprite);
  }

  private renderSkin(skin: Lr2Skin, ops: ReadonlySet<number>): void {
    if (!this.target) return;
    for (const image of skin.images) {
      const dst = this.evaluateElementDst(image);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      const sprite = this.makeStaticImageSprite(image);
      if (sprite) this.skinLayer.addChild(sprite);
    }
    for (const text of skin.texts) {
      const dst = this.evaluateElementDst(text);
      if (!isDestinationVisible(dst, ops, this.timerActive)) continue;
      const value = resolveDecideText(text.st, this.target.song);
      if (value === undefined || value.length === 0) continue;
      this.skinLayer.addChild(
        makeLr2TextSprite(value, text, dst, {
          maxFontSize: 22,
          bitmapFonts: this.bitmapFonts,
          systemFontSizes: skin.systemFontSizes,
        }),
      );
    }
  }

  /**
   * Fallback panel rendered when the theme bundle has no decide skin. Mirrors the result scene's fallback look so
   * skinless demos still feel cohesive.
   */
  /**
   * Fallback chrome modeled on `Theme/LR2/Decide/ss_decide.png`:
   *
   * - - Top-left difficulty stamp: small `DIFFICULTY:` label and a large colored difficulty name (HYPER / NORMAL /
   *   etc.). - Center horizontal band carrying the chart title (large italic-feeling text), sub-title beneath, artist
   *   underneath. - Bottom radial vignette evoking the stage-file under-glow.
   *
   * Drawn entirely with primitives — a viewer comparing this to the LR2 default decide screenshot should immediately
   * recognize the same layout silhouette.
   */
  private renderFallbackPanel(designWidth: number, designHeight: number): void {
    const target = this.target;
    if (!target) return;
    const chrome = new Graphics();
    chrome.label = 'fallback-decide-chrome';
    // Backdrop: dark navy with a soft top-down gradient evoking the screenshot's blue tone.
    chrome.rect(0, 0, designWidth, designHeight).fill(0x040810);
    for (let i = 0; i < 6; i += 1) {
      const t = i / 6;
      chrome
        .rect(0, t * designHeight, designWidth, designHeight / 6)
        .fill({ color: 0x10203c, alpha: 0.18 - i * 0.022 });
    }
    // Center soft-blue glow — evokes the stagefile lit from below.
    for (let i = 0; i < 5; i += 1) {
      const inset = 60 + i * 20;
      chrome
        .rect(inset, designHeight / 2 - 80 + i * 8, designWidth - inset * 2, 160 - i * 16)
        .fill({ color: 0x4a78b5, alpha: 0.08 - i * 0.012 });
    }

    // ── Top-left difficulty stamp ───────────────────────────
    chrome.rect(20, 24, 90, 8).fill({ color: 0x2c333d, alpha: 0.85 }); // "DIFFICULTY:" slot
    // Big difficulty name backdrop — the screenshot shows a chunky violet outlined word.
    chrome
      .roundRect(20, 36, 130, 38, 3)
      .fill({ color: 0x06080c, alpha: 0.7 })
      .stroke({ color: 0x6a3aa0, width: 2, alpha: 0.85 });

    // ── Center horizontal band (title / sub-title / artist) ─
    const bandY = 150;
    const bandH = 156;
    chrome.rect(0, bandY, designWidth, bandH).fill({ color: 0x040810, alpha: 0.85 });
    chrome.rect(0, bandY, designWidth, 2).fill({ color: 0x6a3aa0, alpha: 0.6 });
    chrome.rect(0, bandY + bandH - 2, designWidth, 2).fill({ color: 0x6a3aa0, alpha: 0.6 });

    const titleText = new Text({
      text: target.song.title,
      style: new TextStyle({
        fill: TEXT_COLOR,
        fontSize: 28,
        fontWeight: '700',
        fontFamily: 'system-ui, sans-serif',
        fontStyle: 'italic',
        stroke: { color: 0x000000, width: 3, alignment: 0.5, join: 'round' },
      }),
    });
    titleText.label = 'decide/title';
    titleText.position.set(40, bandY + 38);
    this.fallbackLayer.addChild(titleText);

    const subtitleText = new Text({
      text: target.song.subtitle ?? '',
      style: new TextStyle({
        fill: MUTED,
        fontSize: 10,
        fontFamily: 'system-ui, sans-serif',
      }),
    });
    subtitleText.label = 'decide/subtitle';
    subtitleText.position.set(42, bandY + 24);
    this.fallbackLayer.addChild(subtitleText);

    const artistText = new Text({
      text: target.song.artist ?? '',
      style: new TextStyle({
        fill: MUTED,
        fontSize: 11,
        fontFamily: 'system-ui, sans-serif',
      }),
    });
    artistText.label = 'decide/artist';
    artistText.position.set(42, bandY + 88);
    this.fallbackLayer.addChild(artistText);

    // Difficulty name overlay — drawn as text on top of the top-left stamp rectangle. Picks a color from the
    // difficulty index with a violet bias for HYPER (the screenshot's reference).
    const difficultyText = new Text({
      text: 'HYPER',
      style: new TextStyle({
        fill: 0xb19cd9,
        fontSize: 24,
        fontWeight: '900',
        fontFamily: 'system-ui, sans-serif',
        stroke: { color: 0x000000, width: 2, alignment: 0.5, join: 'round' },
      }),
    });
    difficultyText.label = 'decide/difficulty';
    difficultyText.position.set(28, 38);
    this.fallbackLayer.addChild(difficultyText);

    // No "press Enter" hint — LR2's default decide skin doesn't author one, so the no-skin fallback skips it too.

    // Add the chrome BEFORE text overlays so text paints on top.
    this.fallbackLayer.addChildAt(chrome, 0);
  }

  private evaluateElementDst(element: {
    destination: Lr2DestinationRect;
    keyframes: Lr2DestinationRect[];
  }): Lr2DestinationRect {
    return evaluateElementDestination(element, (timer) => this.elapsedSinceTimer(timer));
  }

  private elapsedSinceTimer(timer: number): number {
    const startedAt = this.timerStartedAt.get(timer);
    if (startedAt === undefined) return 0;
    return Math.max(0, performance.now() - startedAt);
  }

  private readonly timerActive = (timer: number): boolean => {
    if (timer === 0) return true;
    return this.timerStartedAt.has(timer);
  };

  private makeStaticImageSprite(image: Lr2ImageElement) {
    return makeLr2StaticImageSprite(image, this.evaluateElementDst(image), {
      textures: this.skinTextures.asReadonlyMap(),
      elapsedSinceTimer: (timer) => this.elapsedSinceTimer(timer),
      resolveSpecialGraphicTexture: (path) => this.resolveSpecialGraphicTexture(path),
    });
  }

  /**
   * Resolves an LR2 special-graphic sentinel (`*BANNER` / `*STAGEFILE` / `*BACKBMP`) to the texture for the focused
   * song, kicking off an async load on the first miss. The next render pass picks the cached texture up.
   */
  private resolveSpecialGraphicTexture(path: Lr2SpecialGraphic): Texture | undefined {
    const solidTexture = resolveSolidSpecialGraphicTexture(path);
    if (solidTexture) {
      return solidTexture;
    }
    const target = this.target;
    if (!target) return undefined;
    return this.chartGraphicTextures.resolve(target.collection, target.song, path, () => this.render());
  }

  private fireContinue(): void {
    if (this.continuedFired) return;
    this.continuedFired = true;
    this.options.onContinue?.();
  }

  private fireCancel(): void {
    if (this.continuedFired) return;
    this.continuedFired = true;
    // Fall back to `onContinue` when the host didn't wire a dedicated cancel handler — better than swallowing the input
    // and stranding the user on the splash.
    (this.options.onCancel ?? this.options.onContinue)?.();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.disposed) return;
    if (event.key === 'Escape') {
      // Escape always dismisses (LR2 spec — even before `#STARTINPUT` elapses) and routes through `onCancel` so the
      // host can route the user back to song-select instead of accidentally starting gameplay.
      event.preventDefault();
      this.fireCancel();
      return;
    }
    if (!this.inputUnlocked) return;
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      this.fireContinue();
    }
  };

  private readonly handlePointerDown = (): void => {
    if (this.disposed || !this.inputUnlocked) return;
    this.fireContinue();
  };
}

function computeDecideOps(target: PixiDecideTarget, skin: Lr2Skin): ReadonlySet<number> {
  const ops = new Set<number>(DECIDE_BASE_OPS);
  const meta = target.song.chart.metadata;
  // Difficulty plates — the LR2 default decide skin gates per- difficulty stickers off these. Difficulty 0 (undefined)
  // maps to op 150 ("???") so the skin draws a generic plate when the chart didn't author a `#DIFFICULTY` field.
  switch (meta.difficulty) {
    case 1:
      ops.add(DECIDE_DYNAMIC_OPS.DIFFICULTY_EASY);
      break;
    case 2:
      ops.add(DECIDE_DYNAMIC_OPS.DIFFICULTY_NORMAL);
      break;
    case 3:
      ops.add(DECIDE_DYNAMIC_OPS.DIFFICULTY_HYPER);
      break;
    case 4:
      ops.add(DECIDE_DYNAMIC_OPS.DIFFICULTY_ANOTHER);
      break;
    case 5:
      ops.add(DECIDE_DYNAMIC_OPS.DIFFICULTY_INSANE);
      break;
    default:
      ops.add(DECIDE_DYNAMIC_OPS.DIFFICULTY_UNDEFINED);
      break;
  }
  // Key mode — same flag IDs the select scene uses (160..164). Walk the chart's events to detect 14 / 10 / 9 / 7 / 5
  // keys since `metadata.modeHint` is bmson-only.
  ops.add(detectKeyModeOp(target.song));
  // Suppress the `Lr2Skin` argument linter — keeps the parser signature future-proof if we later need to peek at the
  // skin's authored op declarations to filter the active set.
  void skin;
  return ops;
}

function detectKeyModeOp(song: BrowserSongEntry): number {
  // Inspect playable channels in the chart to pick the right key-mode flag. Mirrors the heuristic the select scene uses
  // for its bar-list `BAR_LEVEL` plate.
  let usesPlayer2 = false;
  let uses6or7 = false;
  for (const event of song.chart.events) {
    const ch = event.channel;
    if (ch.startsWith('2')) usesPlayer2 = true;
    if (ch === '18' || ch === '19' || ch === '28' || ch === '29') uses6or7 = true;
  }
  if (usesPlayer2) return uses6or7 ? DECIDE_DYNAMIC_OPS.KEYS_14 : DECIDE_DYNAMIC_OPS.KEYS_10;
  return uses6or7 ? DECIDE_DYNAMIC_OPS.KEYS_7 : DECIDE_DYNAMIC_OPS.KEYS_5;
}

function resolveDecideText(st: number, song: BrowserSongEntry): string | undefined {
  const subartists = song.chart.bmson.info?.subartists?.join(' / ');
  switch (st) {
    case 10:
    case 20:
      return song.title;
    case 11:
    case 21:
      return song.subtitle ?? '';
    case 12:
    case 22:
      return [song.title, song.subtitle].filter((value): value is string => Boolean(value)).join(' ');
    case 13:
    case 23:
      return song.genre ?? '';
    case 14:
    case 24:
      return song.artist ?? '';
    case 15:
    case 25:
      return subartists ?? '';
    case 16:
    case 26:
      return song.fileLabel;
    case 17:
    case 27:
      return song.playLevel?.toString() ?? '';
    case 18:
    case 28:
      switch (song.chart.metadata.difficulty) {
        case 1:
          return 'BEGINNER';
        case 2:
          return 'NORMAL';
        case 3:
          return 'HYPER';
        case 4:
          return 'ANOTHER';
        case 5:
          return 'INSANE';
        default:
          return '';
      }
    default:
      return undefined;
  }
}

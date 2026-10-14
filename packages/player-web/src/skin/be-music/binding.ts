import { CanvasSource, Container, RenderTexture, Sprite, Texture, TextureSource, type Renderer } from 'pixi.js';
import { getDesignPixelRatio } from '../../scene/core/viewport.ts';
import { ChildPool } from '../../scene/pixi-utils.ts';
import {
  resolveBeMusicSkinSettings,
  resolveBeMusicStage,
  resolveStageOrientation,
  wideStage,
} from '@be-music/skin-sdk';
import { logger } from '../../logger.ts';
import { PIXI_HOST_TARGET, rendersOnPixiHost, type PixiHostTarget } from '../../skins/pixi-kit/host-render.ts';
import type {
  BeMusicBgaFrame,
  BeMusicBomb,
  BeMusicDecideFrame,
  BeMusicGameplayFrame,
  BeMusicGameplayLayout,
  BeMusicGameplayRuntime,
  BeMusicLaneFrame,
  BeMusicLongNote,
  BeMusicMine,
  BeMusicNote,
  BeMusicResultFrame,
  BeMusicMeasureLine,
  BeMusicSelectFrame,
  BeMusicSkin,
  BeMusicSkinSettingValues,
  BeMusicSongImageLookup,
  BeMusicSongRecord,
  BeMusicStage,
  BeMusicSurface,
  BeMusicSurfaceContextMap,
} from './types.ts';

/**
 * The player's side of a be-music skin: each screen gets a canvas sized to the screen pixels the stage covers, the skin
 * draws it with whatever it likes, and the canvas is shown in the Pixi scene as one texture. Skins never see Pixi —
 * except Pixi-kit skins, which draw through the player's own renderer into the texture (see `PIXI_HOST_RENDER`),
 * so the frame stays on the GPU.
 */

const log = logger('be-music-skin');

/** Hosts that hand no song images report every image as unavailable. */
const NO_SONG_IMAGE: BeMusicSongImageLookup = () => undefined;

/** Hosts that keep no play records report every song as never played. */
const NO_SONG_RECORD = (): BeMusicSongRecord | undefined => undefined;

/**
 * The player's stored values for a skin's settings, keyed by setting id, as a host persisted them. Bindings check them
 * against the skin's schema with `resolveBeMusicSkinSettings` before a skin sees them.
 */
export type BeMusicStoredSkinSettings = Readonly<Record<string, unknown>>;

/** How long the decide screen shows when the skin doesn't say (`BeMusicDecideSkin.durationMs`). */
const DEFAULT_DECIDE_DURATION_MS = 2000;

/** Largest canvas edge a surface allocates, whatever the window size. */
const MAX_CANVAS_EDGE = 4096;

/**
 * The design canvas `skin` draws on: its landscape stage (the 16:9 `wideStage` unless it declares another), or — given
 * the `screen` it is shown on — its portrait stage when the screen is upright and the skin has one (see
 * `resolveBeMusicStage`; `chart` keeps gameplay on the landscape stage for play modes too wide for portrait).
 */
export function resolveBeMusicSkinStage(
  skin: BeMusicSkin,
  screen?: { width: number; height: number },
  chart?: Parameters<typeof resolveBeMusicStage>[2],
): BeMusicStage {
  return screen ? resolveBeMusicStage(skin, screen, chart) : (skin.stage ?? wideStage);
}

/** The size of the stage a surface draws one frame on. */
type SurfaceSize = { width: number; height: number };

/**
 * One canvas + the texture showing it, sized to the screen pixels the stage covers (dot by dot). For a skin that draws
 * through the player's renderer the texture is a render texture the skin renders into, and the canvas only identifies
 * the surface (it never gets a context).
 */
class SkinSurface {
  private readonly canvas = document.createElement('canvas');
  private readonly source: TextureSource;
  readonly texture: Texture;
  /** The player's renderer when the skin draws through it; `undefined` when the skin draws on the canvas. */
  private readonly hostRenderer: Renderer | undefined;
  private context: BeMusicSurfaceContextMap[keyof BeMusicSurfaceContextMap] | undefined;
  private state: 'new' | 'pending' | 'ready' | 'failed' | 'destroyed' = 'new';
  private pixelRatio = 1;
  private readonly skin: BeMusicSkin;
  /** The stage size of the frame being drawn; follows the screen when the host switches between the skin's stages. */
  private stage: SurfaceSize;

  /** `renderer` is the player's; a Pixi-kit skin draws through it instead of on the canvas. */
  constructor(skin: BeMusicSkin, renderer: Renderer | undefined) {
    this.skin = skin;
    this.stage = resolveBeMusicSkinStage(skin);
    this.hostRenderer = renderer !== undefined && rendersOnPixiHost(skin) ? renderer : undefined;
    // Nearest sampling: the canvas is sized to the screen pixels it covers, so it is shown dot by dot, never filtered.
    // Dynamic: sprites showing the texture follow its size when the stage changes (a rotation between the skin's
    // landscape and portrait stages).
    if (this.hostRenderer) {
      // Multisampled, like the antialiased WebGL context the skin would otherwise draw on.
      this.source = new TextureSource({ scaleMode: 'nearest', antialias: true, autoGenerateMipmaps: false });
      this.texture = new RenderTexture({ source: this.source, dynamic: true });
    } else {
      this.source = new CanvasSource({ resource: this.canvas, scaleMode: 'nearest' });
      this.texture = new Texture({ source: this.source, dynamic: true });
    }
  }

  /** Whether the skin draws through the player's renderer, so a frame must be drawn outside the player's render. */
  get rendersOnHost(): boolean {
    return this.hostRenderer !== undefined;
  }

  /** Runs `paint` on the surface (once it is set up) sized to the stage `size`, and uploads the result. */
  draw(size: SurfaceSize, paint: (surface: BeMusicSurface) => void): void {
    if (size.width !== this.stage.width || size.height !== this.stage.height) {
      this.stage = { width: size.width, height: size.height };
    }
    this.resize();
    if (!this.ensureContext() || this.state !== 'ready') return;
    const surface = this.surface();
    if (this.skin.context === '2d') {
      const ctx = surface.context as CanvasRenderingContext2D;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    }
    try {
      paint(surface);
    } catch (error) {
      log.warn(`"${this.skin.id}": draw failed`, error);
    }
    // A render texture already holds the frame; a canvas is uploaded.
    if (!this.hostRenderer) this.source.update();
  }

  destroy(): void {
    if (this.state === 'destroyed') return;
    // Only a surface the skin set up is handed back to it.
    if (this.state === 'ready' || this.state === 'pending') {
      try {
        this.skin.teardown?.(this.surface());
      } catch (error) {
        log.warn(`"${this.skin.id}": teardown failed`, error);
      }
    }
    this.state = 'destroyed';
    this.texture.destroy(true);
  }

  private surface(): BeMusicSurface {
    const surface: BeMusicSurface = {
      canvas: this.canvas,
      context: this.context!,
      width: this.stage.width,
      height: this.stage.height,
      orientation: resolveStageOrientation(this.stage),
      pixelRatio: this.pixelRatio,
    };
    if (this.hostRenderer) {
      const target: PixiHostTarget = { renderer: this.hostRenderer, texture: this.texture };
      Object.defineProperty(surface, PIXI_HOST_TARGET, { value: target });
    }
    return surface;
  }

  /**
   * Sizes the canvas to the device pixels the stage covers on screen (viewport scale × devicePixelRatio), so one canvas
   * pixel is one screen pixel. Capped at {@link MAX_CANVAS_EDGE} on the long side.
   */
  private resize(): void {
    const { width, height } = this.stage;
    const pixelWidth = Math.max(1, Math.min(MAX_CANVAS_EDGE, Math.round(width * getDesignPixelRatio())));
    const ratio = pixelWidth / width;
    if (
      ratio === this.pixelRatio &&
      this.canvas.width > 0 &&
      this.source.width === width &&
      this.source.height === height
    ) {
      return;
    }
    this.pixelRatio = ratio;
    this.source.resize(width, height, ratio);
  }

  private ensureContext(): boolean {
    if (this.state === 'new') {
      if (this.hostRenderer) return this.setup();
      const context = this.canvas.getContext(this.skin.context, this.skin.contextAttributes) as
        | BeMusicSurfaceContextMap[keyof BeMusicSurfaceContextMap]
        | null;
      if (!context) {
        log.warn(`"${this.skin.id}": the browser offers no "${this.skin.context}" canvas context`);
        this.state = 'failed';
        return false;
      }
      this.context = context;
      return this.setup();
    }
    return this.state !== 'failed' && this.state !== 'destroyed';
  }

  /** Hands the surface to the skin's `setup`; the surface is ready once it returns (or its promise resolves). */
  private setup(): boolean {
    this.state = 'pending';
    let setup: void | Promise<void>;
    try {
      setup = this.skin.setup?.(this.surface());
    } catch (error) {
      log.warn(`"${this.skin.id}": setup failed`, error);
      this.state = 'failed';
      return false;
    }
    if (setup instanceof Promise) {
      setup.then(
        () => {
          if (this.state === 'pending') this.state = 'ready';
        },
        (error: unknown) => {
          log.warn(`"${this.skin.id}": setup failed`, error);
          if (this.state === 'pending') this.state = 'failed';
        },
      );
    } else {
      this.state = 'ready';
    }
    return true;
  }
}

/**
 * Gameplay for one scene: the scene reports lanes, notes, long notes, and hit effects as it walks them, and
 * {@link renderChrome} places the skin's canvas, which is drawn once — with everything collected — when Pixi renders,
 * or, for a skin drawing through the player's renderer, when the scene calls {@link flush}.
 */
export class BeMusicGameplayBinding {
  readonly bombDurationMs: number;
  /** Whether the skin draws mines from the frame; when false the scene draws them itself. */
  readonly drawsMines: boolean;
  /** Whether the skin draws the lane covers from `runtime.laneCovers`; when false the scene draws them itself. */
  readonly drawsLaneCover: boolean;
  /** Whether the skin draws measure lines from the frame; when false the scene draws them itself. */
  readonly drawsMeasureLines: boolean;
  /** Whether the skin composites the BGA from the frame; when false the scene shows it behind the skin. */
  readonly drawsBga: boolean;
  private readonly skin: BeMusicSkin;
  private settings: BeMusicSkinSettingValues;
  private readonly songImage: BeMusicSongImageLookup;
  private readonly surface: SkinSurface;
  private frame: BeMusicGameplayFrame | undefined;
  private lanes: BeMusicLaneFrame[] = [];
  private notes: BeMusicNote[] = [];
  private longNotes: BeMusicLongNote[] = [];
  private mines: BeMusicMine[] = [];
  private bombs: BeMusicBomb[] = [];
  private measureLines: BeMusicMeasureLine[] = [];
  private frameNumber = 0;
  private drawnFrame = -1;

  /**
   * `songImage` resolves the song's images for `frame.songImage`; without one every image reads as unavailable.
   * `settings` are the player's stored values for the skin's settings; without them the skin draws with its defaults.
   * `renderer` is the player's Pixi renderer: a Pixi-kit skin draws through it.
   */
  constructor(
    skin: BeMusicSkin,
    options: { songImage?: BeMusicSongImageLookup; settings?: BeMusicStoredSkinSettings; renderer?: Renderer } = {},
  ) {
    this.skin = skin;
    this.surface = new SkinSurface(skin, options.renderer);
    this.songImage = options.songImage ?? NO_SONG_IMAGE;
    this.bombDurationMs = skin.gameplay.bombDurationMs ?? 300;
    this.drawsMines = skin.gameplay.drawsMines === true;
    this.drawsLaneCover = skin.gameplay.drawsLaneCover === true;
    this.drawsMeasureLines = skin.gameplay.drawsMeasureLines === true;
    this.drawsBga = skin.gameplay.drawsBga === true;
    this.settings = resolveBeMusicSkinSettings(skin, options.settings);
  }

  /** Replaces the player's values for the skin's settings; the next frame draws with them. */
  setSettings(stored: BeMusicStoredSkinSettings | undefined): void {
    this.settings = resolveBeMusicSkinSettings(this.skin, stored);
  }

  /** Starts a frame and shows the skin's canvas in `layerPool` (the scene's chrome layer, above the BGA). */
  renderChrome(context: {
    layerPool: ChildPool;
    runtime: BeMusicGameplayRuntime;
    layout: BeMusicGameplayLayout;
  }): void {
    const { runtime, layout } = context;
    this.frameNumber += 1;
    this.lanes = [];
    this.notes = [];
    this.longNotes = [];
    this.mines = [];
    this.bombs = [];
    this.measureLines = [];
    this.frame = {
      nowMs: runtime.nowMs ?? 0,
      runtime,
      layout,
      lanes: this.lanes,
      notes: this.notes,
      longNotes: this.longNotes,
      mines: this.mines,
      bombs: this.bombs,
      measureLines: this.measureLines,
      // Filled by `setBga` for a skin that sets `drawsBga`.
      bga: undefined,
      beatPhase: runtime.beatPhase ?? 0,
      effects: runtime.effects ?? 'full',
      audio: runtime.audio,
      settings: this.settings,
      songImage: this.songImage,
    };
    const sprite = context.layerPool.acquireSprite();
    sprite.texture = this.surface.texture;
    // The texture's size is in design pixels already (its source carries the pixel ratio as its resolution).
    sprite.position.set(0, 0);
    sprite.scale.set(1);
    sprite.roundPixels = true;
    // A skin drawing through the player's renderer can't render inside the player's render; the scene flushes it.
    sprite.onRender = this.surface.rendersOnHost ? null : this.drawFrame;
  }

  /**
   * Draws the frame collected since {@link renderChrome} when the skin draws through the player's renderer; call it once
   * the frame is collected, before the player renders. A no-op for a canvas skin, which draws when its sprite renders.
   */
  flush(): void {
    if (this.surface.rendersOnHost) this.drawFrame();
  }

  addLanes(lanes: readonly BeMusicLaneFrame[]): void {
    for (const lane of lanes) this.lanes.push({ ...lane });
  }

  addNote(note: BeMusicNote): void {
    this.notes.push(note);
  }

  addLongNote(note: BeMusicLongNote): void {
    this.longNotes.push(note);
  }

  addMine(mine: BeMusicMine): void {
    this.mines.push(mine);
  }

  /** Collected only for a skin that sets `drawsMeasureLines`; the scene draws its own lines otherwise. */
  addMeasureLine(line: BeMusicMeasureLine): void {
    this.measureLines.push(line);
  }

  addBombs(bombs: readonly BeMusicBomb[]): void {
    for (const bomb of bombs) this.bombs.push({ ...bomb });
  }

  /** The BGA layers showing this frame; handed over only for a skin that sets `drawsBga`. */
  setBga(bga: BeMusicBgaFrame | undefined): void {
    if (this.frame && this.drawsBga) this.frame.bga = bga;
  }

  dispose(): void {
    this.surface.destroy();
  }

  private readonly drawFrame = (): void => {
    const frame = this.frame;
    if (!frame || this.drawnFrame === this.frameNumber) return;
    this.drawnFrame = this.frameNumber;
    this.surface.draw(frame.layout.stage, (surface) => this.skin.gameplay.draw(surface, frame));
  };
}

/**
 * The select frame the scene hands over; the binding adds `revision`, `audio`, `hit`, and the skin-facing extras
 * (`pointer`, `songRecord`, `songImage`, `settings`).
 */
export type BeMusicSelectSceneFrame = Omit<
  BeMusicSelectFrame,
  'revision' | 'audio' | 'hit' | 'pointer' | 'songRecord' | 'songImage' | 'settings'
>;

/**
 * Select for one scene: {@link render} records the latest state when the scene's input changes, and {@link tick} draws
 * the skin every frame with it. Hit areas the skin declares become transparent pointer targets in {@link frontLayer}.
 */
export class BeMusicSelectBinding {
  readonly outroMs: number;
  /** Shows the skin's canvas, behind the scene's list layer. */
  readonly backLayer = new Container();
  /** Holds the hit areas, in front of everything. */
  readonly frontLayer = new Container();
  private readonly skin: BeMusicSkin;
  private readonly surface: SkinSurface;
  private readonly hitPool: ChildPool;
  private settings: BeMusicSkinSettingValues;
  private readonly songRecord: BeMusicSelectFrame['songRecord'];
  private readonly songImage: BeMusicSongImageLookup;
  /** The pointer in design pixels, replaced (not mutated) when it moves so a skin may keep last frame's. */
  private pointer: BeMusicSelectFrame['pointer'] = undefined;
  private frame: BeMusicSelectSceneFrame | undefined;
  private revision = 0;
  /**
   * Where the skin's search box was on the last drawn frame, in design pixels: the hit area it bound to
   * `actions.activateSearch`. Undefined when the skin has none. The host lays its text field over it.
   */
  searchFieldRect: { x: number; y: number; width: number; height: number } | undefined;

  /**
   * `resolveSongRecord` looks up the player's best record on a song for `frame.songRecord`; without one every song
   * reads as never played. `songImage` resolves song images for `frame.songImage` (call {@link invalidate} when one
   * arrives); without one every image reads as unavailable. `settings` are the player's stored values for the skin's
   * settings; without them the skin draws with its defaults.
   * `renderer` is the player's Pixi renderer: a Pixi-kit skin draws through it.
   */
  constructor(
    skin: BeMusicSkin,
    options: {
      resolveSongRecord?: BeMusicSelectFrame['songRecord'];
      songImage?: BeMusicSongImageLookup;
      settings?: BeMusicStoredSkinSettings;
      renderer?: Renderer;
    } = {},
  ) {
    this.skin = skin;
    this.surface = new SkinSurface(skin, options.renderer);
    this.outroMs = skin.select.outroMs ?? 0;
    this.songRecord = options.resolveSongRecord ?? NO_SONG_RECORD;
    this.songImage = options.songImage ?? NO_SONG_IMAGE;
    this.settings = resolveBeMusicSkinSettings(skin, options.settings);
    this.backLayer.addChild(new Sprite({ texture: this.surface.texture, roundPixels: true }));
    this.hitPool = new ChildPool(this.frontLayer);
  }

  /** Records the select state after an input-driven change. Drawing happens in {@link tick}. */
  render(frame: BeMusicSelectSceneFrame): void {
    this.frame = frame;
    this.revision += 1;
  }

  /**
   * Replaces the player's values for the skin's settings and moves `frame.revision`, so a skin that caches its layout
   * per revision redraws with them on the next {@link tick}.
   */
  setSettings(stored: BeMusicStoredSkinSettings | undefined): void {
    this.settings = resolveBeMusicSkinSettings(this.skin, stored);
    this.revision += 1;
  }

  /** Moves `frame.revision` without a state change, e.g. when a song image the skin asked for has loaded. */
  invalidate(): void {
    this.revision += 1;
  }

  /**
   * Records where the pointer is, in the stage's design pixels, or `undefined` when it is off the stage. Read by the
   * next {@link tick} as `frame.pointer` and by `frame.hit`'s hover test.
   */
  setPointer(x: number | undefined, y: number | undefined): void {
    if (x === undefined || y === undefined) {
      this.pointer = undefined;
    } else if (this.pointer?.x !== x || this.pointer.y !== y) {
      this.pointer = { x, y };
    }
  }

  /** Draws the skin with the latest state, the current time, and what is playing. */
  tick(
    nowMs: number,
    focusedSong: BeMusicSelectFrame['focusedSong'],
    launchAt: number | undefined,
    audio: BeMusicSelectFrame['audio'],
  ): void {
    const base = this.frame;
    if (!base) return;
    const pool = this.hitPool;
    pool.begin();
    const pointer = this.pointer;
    let searchFieldRect: BeMusicSelectBinding['searchFieldRect'];
    const frame: BeMusicSelectFrame = {
      ...base,
      nowMs,
      focusedSong,
      launchAt,
      audio,
      revision: this.revision,
      pointer,
      songRecord: this.songRecord,
      songImage: this.songImage,
      settings: this.settings,
      hit: (x, y, w, h, action, cursor = 'pointer') => {
        const area = pool.acquireGraphics();
        area.rect(x, y, w, h).fill({ color: 0xffffff, alpha: 0.001 });
        area.eventMode = 'static';
        area.cursor = cursor;
        area.removeAllListeners('pointerdown');
        area.on('pointerdown', action);
        if (action === base.actions.activateSearch) searchFieldRect = { x, y, width: w, height: h };
        return pointer !== undefined && pointer.x >= x && pointer.x < x + w && pointer.y >= y && pointer.y < y + h;
      },
    };
    try {
      this.surface.draw({ width: frame.designWidth, height: frame.designHeight }, (surface) =>
        this.skin.select.draw(surface, frame),
      );
    } finally {
      pool.end();
      this.searchFieldRect = searchFieldRect;
    }
  }

  dispose(): void {
    this.hitPool.destroy();
    this.backLayer.destroy({ children: true });
    this.frontLayer.destroy({ children: true });
    this.surface.destroy();
  }
}

/** The result frame the scene hands over; the binding adds `songImage` and `settings`. */
export type BeMusicResultSceneFrame = Omit<BeMusicResultFrame, 'songImage' | 'settings'>;

/** Result for one scene: draws the skin every frame onto a canvas shown by {@link view}. */
export class BeMusicResultBinding {
  /** Persistent container showing the skin's canvas; the scene mounts it once. */
  readonly view = new Container();
  private readonly skin: BeMusicSkin;
  private readonly surface: SkinSurface;
  private settings: BeMusicSkinSettingValues;
  private readonly songImage: BeMusicSongImageLookup;

  /**
   * `songImage` resolves song images for `frame.songImage`; without one every image reads as unavailable. `settings`
   * are the player's stored values for the skin's settings; without them the skin draws with its defaults.
   * `renderer` is the player's Pixi renderer: a Pixi-kit skin draws through it.
   */
  constructor(
    skin: BeMusicSkin,
    options: { songImage?: BeMusicSongImageLookup; settings?: BeMusicStoredSkinSettings; renderer?: Renderer } = {},
  ) {
    this.skin = skin;
    this.surface = new SkinSurface(skin, options.renderer);
    this.settings = resolveBeMusicSkinSettings(skin, options.settings);
    this.songImage = options.songImage ?? NO_SONG_IMAGE;
    this.view.addChild(new Sprite({ texture: this.surface.texture, roundPixels: true }));
  }

  /** Replaces the player's values for the skin's settings; the next frame draws with them. */
  setSettings(stored: BeMusicStoredSkinSettings | undefined): void {
    this.settings = resolveBeMusicSkinSettings(this.skin, stored);
  }

  render(sceneFrame: BeMusicResultSceneFrame): void {
    const frame: BeMusicResultFrame = { ...sceneFrame, songImage: this.songImage, settings: this.settings };
    this.surface.draw({ width: frame.designWidth, height: frame.designHeight }, (surface) =>
      this.skin.result.draw(surface, frame),
    );
  }

  dispose(): void {
    this.view.destroy({ children: true });
    this.surface.destroy();
  }
}

/** The decide frame the scene hands over; the binding adds `songImage` and `settings`. */
export type BeMusicDecideSceneFrame = Omit<BeMusicDecideFrame, 'songImage' | 'settings'>;

/** Decide for one scene: draws the skin's `decide` every frame onto a canvas shown by {@link view}. */
export class BeMusicDecideBinding {
  /** Persistent container showing the skin's canvas; the scene mounts it once. */
  readonly view = new Container();
  /** How long (ms) the screen shows before the play starts (the skin's `decide.durationMs`, default 2000). */
  readonly durationMs: number;
  private readonly skin: BeMusicSkin;
  private readonly surface: SkinSurface;
  private settings: BeMusicSkinSettingValues;
  private readonly songImage: BeMusicSongImageLookup;

  /**
   * `songImage` resolves song images for `frame.songImage`; without one every image reads as unavailable. `settings`
   * are the player's stored values for the skin's settings; without them the skin draws with its defaults.
   * `renderer` is the player's Pixi renderer: a Pixi-kit skin draws through it.
   */
  constructor(
    skin: BeMusicSkin,
    options: { songImage?: BeMusicSongImageLookup; settings?: BeMusicStoredSkinSettings; renderer?: Renderer } = {},
  ) {
    this.skin = skin;
    this.surface = new SkinSurface(skin, options.renderer);
    this.settings = resolveBeMusicSkinSettings(skin, options.settings);
    this.songImage = options.songImage ?? NO_SONG_IMAGE;
    this.durationMs = Math.max(0, skin.decide?.durationMs ?? DEFAULT_DECIDE_DURATION_MS);
    this.view.addChild(new Sprite({ texture: this.surface.texture, roundPixels: true }));
  }

  /** Replaces the player's values for the skin's settings; the next frame draws with them. */
  setSettings(stored: BeMusicStoredSkinSettings | undefined): void {
    this.settings = resolveBeMusicSkinSettings(this.skin, stored);
  }

  /** Draws one frame; a no-op for a skin without a decide screen. */
  render(sceneFrame: BeMusicDecideSceneFrame): void {
    const decide = this.skin.decide;
    if (!decide) return;
    const frame: BeMusicDecideFrame = { ...sceneFrame, songImage: this.songImage, settings: this.settings };
    this.surface.draw({ width: frame.designWidth, height: frame.designHeight }, (surface) =>
      decide.draw(surface, frame),
    );
  }

  dispose(): void {
    this.view.destroy({ children: true });
    this.surface.destroy();
  }
}

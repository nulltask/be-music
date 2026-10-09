import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { getDesignPixelRatio } from '../../scene/core/viewport.ts';
import { ChildPool } from '../../scene/pixi-utils.ts';
import { wideStage } from '../../skin-sdk/stage.ts';
import { logger } from '../../logger.ts';
import type {
  BeMusicBomb,
  BeMusicGameplayFrame,
  BeMusicGameplayLayout,
  BeMusicGameplayRuntime,
  BeMusicLaneFrame,
  BeMusicLongNote,
  BeMusicNote,
  BeMusicResultFrame,
  BeMusicSelectFrame,
  BeMusicSkin,
  BeMusicStage,
  BeMusicSurface,
  BeMusicSurfaceContextMap,
} from './types.ts';

/**
 * The player's side of a be-music skin: each screen gets a canvas sized to the screen pixels the stage covers, the skin
 * draws it with whatever it likes, and the canvas is shown in the Pixi scene as one texture. Skins never see Pixi.
 */

const log = logger('be-music-skin');

/** Largest canvas edge a surface allocates, whatever the window size. */
const MAX_CANVAS_EDGE = 4096;

/** The design canvas `skin` draws on (the 16:9 `wideStage` unless it declares another). */
export function resolveBeMusicSkinStage(skin: BeMusicSkin): BeMusicStage {
  return skin.stage ?? wideStage;
}

/** One canvas + the texture showing it, sized to the screen pixels the stage covers (dot by dot). */
class SkinSurface {
  private readonly canvas = document.createElement('canvas');
  private readonly source: CanvasSource;
  readonly texture: Texture;
  private context: BeMusicSurfaceContextMap[keyof BeMusicSurfaceContextMap] | undefined;
  private state: 'new' | 'pending' | 'ready' | 'failed' | 'destroyed' = 'new';
  private pixelRatio = 1;
  private readonly skin: BeMusicSkin;
  private readonly stage: BeMusicStage;

  constructor(skin: BeMusicSkin) {
    this.skin = skin;
    this.stage = resolveBeMusicSkinStage(skin);
    // Nearest sampling: the canvas is sized to the screen pixels it covers, so it is shown dot by dot, never filtered.
    this.source = new CanvasSource({ resource: this.canvas, scaleMode: 'nearest' });
    this.texture = new Texture({ source: this.source });
  }

  /** Runs `paint` on the surface (once it is set up) and uploads the result. */
  draw(paint: (surface: BeMusicSurface) => void): void {
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
    this.source.update();
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
    return {
      canvas: this.canvas,
      context: this.context!,
      width: this.stage.width,
      height: this.stage.height,
      pixelRatio: this.pixelRatio,
    };
  }

  /**
   * Sizes the canvas to the device pixels the stage covers on screen (viewport scale × devicePixelRatio), so one canvas
   * pixel is one screen pixel. Capped at {@link MAX_CANVAS_EDGE} on the long side.
   */
  private resize(): void {
    const { width, height } = this.stage;
    const pixelWidth = Math.max(1, Math.min(MAX_CANVAS_EDGE, Math.round(width * getDesignPixelRatio())));
    const ratio = pixelWidth / width;
    if (ratio === this.pixelRatio && this.canvas.width > 0) return;
    this.pixelRatio = ratio;
    this.source.resize(width, height, ratio);
  }

  private ensureContext(): boolean {
    if (this.state === 'new') {
      const context = this.canvas.getContext(this.skin.context, this.skin.contextAttributes) as
        | BeMusicSurfaceContextMap[keyof BeMusicSurfaceContextMap]
        | null;
      if (!context) {
        log.warn(`"${this.skin.id}": the browser offers no "${this.skin.context}" canvas context`);
        this.state = 'failed';
        return false;
      }
      this.context = context;
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
    }
    return this.state !== 'failed' && this.state !== 'destroyed';
  }
}

/**
 * Gameplay for one scene: the scene reports lanes, notes, long notes, and hit effects as it walks them, and
 * {@link renderChrome} places the skin's canvas, which is drawn once — with everything collected — when Pixi renders.
 */
export class BeMusicGameplayBinding {
  readonly bombDurationMs: number;
  private readonly skin: BeMusicSkin;
  private readonly surface: SkinSurface;
  private frame: BeMusicGameplayFrame | undefined;
  private lanes: BeMusicLaneFrame[] = [];
  private notes: BeMusicNote[] = [];
  private longNotes: BeMusicLongNote[] = [];
  private bombs: BeMusicBomb[] = [];
  private frameNumber = 0;
  private drawnFrame = -1;

  constructor(skin: BeMusicSkin) {
    this.skin = skin;
    this.surface = new SkinSurface(skin);
    this.bombDurationMs = skin.gameplay.bombDurationMs ?? 300;
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
    this.bombs = [];
    this.frame = {
      nowMs: runtime.nowMs ?? 0,
      runtime,
      layout,
      lanes: this.lanes,
      notes: this.notes,
      longNotes: this.longNotes,
      bombs: this.bombs,
      beatPhase: runtime.beatPhase ?? 0,
      effects: runtime.effects ?? 'full',
      audio: runtime.audio,
    };
    const sprite = context.layerPool.acquireSprite();
    sprite.texture = this.surface.texture;
    // The texture's size is in design pixels already (its source carries the pixel ratio as its resolution).
    sprite.position.set(0, 0);
    sprite.scale.set(1);
    sprite.roundPixels = true;
    sprite.onRender = this.drawFrame;
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

  addBombs(bombs: readonly BeMusicBomb[]): void {
    for (const bomb of bombs) this.bombs.push({ ...bomb });
  }

  dispose(): void {
    this.surface.destroy();
  }

  private readonly drawFrame = (): void => {
    const frame = this.frame;
    if (!frame || this.drawnFrame === this.frameNumber) return;
    this.drawnFrame = this.frameNumber;
    this.surface.draw((surface) => this.skin.gameplay.draw(surface, frame));
  };
}

/** The select frame the scene hands over; the binding adds `revision`, `audio`, and `hit`. */
export type BeMusicSelectSceneFrame = Omit<BeMusicSelectFrame, 'revision' | 'audio' | 'hit'>;

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
  private frame: BeMusicSelectSceneFrame | undefined;
  private revision = 0;

  constructor(skin: BeMusicSkin) {
    this.skin = skin;
    this.surface = new SkinSurface(skin);
    this.outroMs = skin.select.outroMs ?? 0;
    this.backLayer.addChild(new Sprite({ texture: this.surface.texture, roundPixels: true }));
    this.hitPool = new ChildPool(this.frontLayer);
  }

  /** Records the select state after an input-driven change. Drawing happens in {@link tick}. */
  render(frame: BeMusicSelectSceneFrame): void {
    this.frame = frame;
    this.revision += 1;
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
    const frame: BeMusicSelectFrame = {
      ...base,
      nowMs,
      focusedSong,
      launchAt,
      audio,
      revision: this.revision,
      hit: (x, y, w, h, action, cursor = 'pointer') => {
        const area = pool.acquireGraphics();
        area.rect(x, y, w, h).fill({ color: 0xffffff, alpha: 0.001 });
        area.eventMode = 'static';
        area.cursor = cursor;
        area.removeAllListeners('pointerdown');
        area.on('pointerdown', action);
      },
    };
    try {
      this.surface.draw((surface) => this.skin.select.draw(surface, frame));
    } finally {
      pool.end();
    }
  }

  dispose(): void {
    this.hitPool.destroy();
    this.backLayer.destroy({ children: true });
    this.frontLayer.destroy({ children: true });
    this.surface.destroy();
  }
}

/** Result for one scene: draws the skin every frame onto a canvas shown by {@link view}. */
export class BeMusicResultBinding {
  /** Persistent container showing the skin's canvas; the scene mounts it once. */
  readonly view = new Container();
  private readonly skin: BeMusicSkin;
  private readonly surface: SkinSurface;

  constructor(skin: BeMusicSkin) {
    this.skin = skin;
    this.surface = new SkinSurface(skin);
    this.view.addChild(new Sprite({ texture: this.surface.texture, roundPixels: true }));
  }

  render(frame: BeMusicResultFrame): void {
    this.surface.draw((surface) => this.skin.result.draw(surface, frame));
  }

  dispose(): void {
    this.view.destroy({ children: true });
    this.surface.destroy();
  }
}

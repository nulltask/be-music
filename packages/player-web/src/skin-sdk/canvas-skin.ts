import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { getDesignTextResolution } from '../scene/core/viewport.ts';
import type {
  BeMusicAudioFrame,
  BeMusicBomb,
  BeMusicEffectLevel,
  BeMusicGameplayLayout,
  BeMusicLaneFrame,
  BeMusicLaneKind,
  BeMusicResultFrame,
  BeMusicSelectFrame,
  BeMusicSelectLayout,
  BeMusicSkin,
  BeMusicStage,
} from '../skin/be-music/types.ts';
import type { SkinlessGameplayChromeRuntime } from '../scene/gameplay-chrome.ts';
import { defineBeMusicSkin } from './define.ts';
import { addHitArea } from './skin-text.ts';
import { wideStage } from './stage.ts';
import { logger } from '../logger.ts';

/**
 * Canvas skins: draw every screen yourself onto a plain `<canvas>` — with the 2D API, WebGL, or WebGPU — instead of
 * building Pixi display objects. The player shows the canvas as one texture per screen, so a canvas skin needs no
 * Pixi knowledge at all.
 *
 * Each frame the player collects what is on screen (layout, lanes, notes, long notes, hit effects, HUD values) and
 * calls your `draw` once, right before it renders. With the `'2d'` context the canvas is already cleared and scaled,
 * so you draw in design pixels (854×480 on the default stage); with `'webgl'` / `'webgl2'` / `'webgpu'` you own the
 * whole canvas (`surface.pixelRatio` tells you its scale) and can prepare devices or pipelines in `setup`.
 */

const log = logger('canvas-skin');

/** Canvas rendering contexts a canvas skin can draw with. */
export interface CanvasContextMap {
  '2d': CanvasRenderingContext2D;
  webgl: WebGLRenderingContext;
  webgl2: WebGL2RenderingContext;
  webgpu: GPUCanvasContext;
}

export type CanvasContextKind = keyof CanvasContextMap;

/** The canvas a skin draws one screen on. */
export interface CanvasSurface<K extends CanvasContextKind = CanvasContextKind> {
  canvas: HTMLCanvasElement;
  context: CanvasContextMap[K];
  /** Size in design pixels (the stage size). */
  width: number;
  height: number;
  /** Canvas pixels per design pixel. `'2d'` surfaces are pre-scaled by it; other contexts apply it themselves. */
  pixelRatio: number;
}

/** A tap note as drawn this frame: its lane rect and the y its bottom edge sits at. */
export interface CanvasNote {
  kind: BeMusicLaneKind;
  x: number;
  w: number;
  y: number;
}

/** A long note as drawn this frame: its lane rect, tail (top) and head (bottom). */
export interface CanvasLongNote {
  kind: BeMusicLaneKind;
  x: number;
  w: number;
  top: number;
  bottom: number;
}

/** Everything on the gameplay screen this frame. */
export interface CanvasGameplayFrame {
  nowMs: number;
  /** HUD values: score, combo, gauge, judgements, song, loading, … */
  runtime: SkinlessGameplayChromeRuntime;
  /** Stage, lanes, playfield bounds, judgement line, and the BGA rect (leave it transparent: the video is behind). */
  layout: BeMusicGameplayLayout;
  /** Every lane with its key-beam intensity. */
  lanes: readonly BeMusicLaneFrame[];
  notes: readonly CanvasNote[];
  longNotes: readonly CanvasLongNote[];
  /** Live hit effects with their age. */
  bombs: readonly BeMusicBomb[];
  /** Fractional beat position in [0, 1). */
  beatPhase: number;
  effects: BeMusicEffectLevel;
  audio: BeMusicAudioFrame | undefined;
}

/** The select frame, plus a way to make parts of the canvas clickable. */
export interface CanvasSelectFrame extends BeMusicSelectFrame {
  /** Makes the rect (design pixels) run `action` when clicked — e.g. `frame.hit(x, y, w, h, frame.actions.play)`. */
  hit(x: number, y: number, w: number, h: number, action: () => void): void;
}

export interface CanvasSkinDefinition<K extends CanvasContextKind> extends Omit<
  BeMusicSkin,
  'stage' | 'gameplay' | 'select' | 'result'
> {
  /** Which context to draw with. */
  context: K;
  /** Attributes passed to `canvas.getContext` (e.g. `{ alpha: true }`, `{ antialias: true }`). */
  contextAttributes?: CanvasRenderingContext2DSettings | WebGLContextAttributes;
  /** Design canvas; defaults to the 16:9 {@link wideStage}. */
  stage?: BeMusicStage;
  /**
   * Called once for every new surface before its first draw — compile shaders, request a GPU device, configure a
   * WebGPU context. Drawing waits until a returned promise settles.
   */
  setup?: (surface: CanvasSurface<K>) => void | Promise<void>;
  gameplay: {
    draw(surface: CanvasSurface<K>, frame: CanvasGameplayFrame): void;
    /** How long a hit effect lives (ms). Default 300. */
    bombDurationMs?: number;
  };
  select: {
    /** Where the song list sits (the player hit-tests the rows with it). */
    layout: BeMusicSelectLayout;
    /** Length of the launch outro (ms) the select screen keeps drawing after a chart is picked. Default 0. */
    outroMs?: number;
    /** Return `true` while something is still animating, to be drawn again next frame. */
    draw(surface: CanvasSurface<K>, frame: CanvasSelectFrame): boolean | void;
  };
  result: {
    draw(surface: CanvasSurface<K>, frame: BeMusicResultFrame): void;
  };
}

/** Largest canvas edge a surface allocates, whatever the window size. */
const MAX_CANVAS_EDGE = 4096;

/** One canvas + the texture showing it. Sized to the stage at the screen's current density. */
class Surface<K extends CanvasContextKind> {
  private readonly canvas = document.createElement('canvas');
  private readonly source: CanvasSource;
  readonly texture: Texture;
  private context: CanvasContextMap[K] | undefined;
  private state: 'new' | 'pending' | 'ready' | 'failed' = 'new';
  private pixelRatio = 1;
  private readonly definition: CanvasSkinDefinition<K>;
  private readonly stage: BeMusicStage;

  constructor(definition: CanvasSkinDefinition<K>, stage: BeMusicStage) {
    this.definition = definition;
    this.stage = stage;
    this.source = new CanvasSource({ resource: this.canvas });
    this.texture = new Texture({ source: this.source });
  }

  /** Runs `paint` on the surface (once it is set up) and uploads the result. */
  draw(paint: (surface: CanvasSurface<K>) => void): void {
    this.resize();
    const context = this.ensureContext();
    if (!context || this.state !== 'ready') return;
    const surface: CanvasSurface<K> = {
      canvas: this.canvas,
      context,
      width: this.stage.width,
      height: this.stage.height,
      pixelRatio: this.pixelRatio,
    };
    if (this.definition.context === '2d') {
      const ctx = context as CanvasRenderingContext2D;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    }
    paint(surface);
    this.source.update();
  }

  destroy(): void {
    this.texture.destroy(true);
  }

  private resize(): void {
    const { width, height } = this.stage;
    const ratio = Math.min(Math.max(1, getDesignTextResolution()), MAX_CANVAS_EDGE / Math.max(width, height));
    if (ratio === this.pixelRatio && this.canvas.width > 0) return;
    this.pixelRatio = ratio;
    this.source.resize(width, height, ratio);
  }

  private ensureContext(): CanvasContextMap[K] | undefined {
    if (this.state === 'new') {
      const context = this.canvas.getContext(this.definition.context, this.definition.contextAttributes) as
        | CanvasContextMap[K]
        | null;
      if (!context) {
        log.warn(`"${this.definition.id}": the browser offers no "${this.definition.context}" canvas context`);
        this.state = 'failed';
        return undefined;
      }
      this.context = context;
      this.state = 'pending';
      const setup = this.definition.setup?.({
        canvas: this.canvas,
        context,
        width: this.stage.width,
        height: this.stage.height,
        pixelRatio: this.pixelRatio,
      });
      if (setup instanceof Promise) {
        setup.then(
          () => (this.state = 'ready'),
          (error: unknown) => {
            log.warn(`"${this.definition.id}": setup failed`, error);
            this.state = 'failed';
          },
        );
      } else {
        this.state = 'ready';
      }
    }
    return this.context;
  }
}

/**
 * Turns a {@link CanvasSkinDefinition} into a regular `BeMusicSkin` (validated like {@link defineBeMusicSkin}).
 *
 * ```ts
 * export default defineCanvasSkin({
 *   apiVersion: BE_MUSIC_SKIN_API_VERSION,
 *   id: 'plain', label: 'Plain', version: '1.0.0', author: { name: 'Jane Doe' }, fontLoads: [],
 *   context: '2d',
 *   gameplay: { draw: ({ context: ctx }, frame) => { … } },
 *   select: { layout, draw: ({ context: ctx }, frame) => { … } },
 *   result: { draw: ({ context: ctx }, frame) => { … } },
 * });
 * ```
 */
export function defineCanvasSkin<K extends CanvasContextKind>(definition: CanvasSkinDefinition<K>): BeMusicSkin {
  const {
    context: _context,
    contextAttributes: _attributes,
    setup: _setup,
    gameplay,
    select,
    result,
    ...meta
  } = definition;
  const stage = definition.stage ?? wideStage;

  // Gameplay: the hooks below only collect this frame's content; the canvas is drawn once, when Pixi renders it.
  let gameplaySurface: Surface<K> | undefined;
  let frame: CanvasGameplayFrame | undefined;
  let frameNumber = 0;
  let drawnFrame = -1;
  const drawGameplay = (): void => {
    if (!frame || !gameplaySurface || drawnFrame === frameNumber) return;
    drawnFrame = frameNumber;
    const current = frame;
    gameplaySurface.draw((surface) => gameplay.draw(surface, current));
  };

  // Result: its frame layer is rebuilt every frame, so one surface is kept here and shown by a fresh sprite.
  let resultSurface: Surface<K> | undefined;

  return defineBeMusicSkin({
    ...meta,
    stage,
    gameplay: {
      bombDurationMs: gameplay.bombDurationMs ?? 300,
      renderChrome: ({ layerPool, runtime, layout }) => {
        gameplaySurface ??= new Surface(definition, stage);
        frameNumber += 1;
        frame = {
          nowMs: runtime.nowMs ?? 0,
          runtime,
          layout,
          lanes: [],
          notes: [],
          longNotes: [],
          bombs: [],
          beatPhase: runtime.beatPhase ?? 0,
          effects: runtime.effects ?? 'full',
          audio: runtime.audio,
        };
        const sprite = layerPool.acquireSprite();
        sprite.texture = gameplaySurface.texture;
        // The texture's size is in design pixels already (its source carries the pixel ratio as its resolution).
        sprite.position.set(0, 0);
        sprite.scale.set(1);
        sprite.onRender = drawGameplay;
      },
      renderLanes: ({ lanes }) => {
        if (frame) frame.lanes = lanes.map((lane) => ({ ...lane }));
      },
      renderNote: ({ kind, x, w, y }) => {
        (frame?.notes as CanvasNote[] | undefined)?.push({ kind, x, w, y });
      },
      renderLongNote: ({ kind, x, w, top, bottom }) => {
        (frame?.longNotes as CanvasLongNote[] | undefined)?.push({ kind, x, w, top, bottom });
      },
      renderBombs: ({ bombs }) => {
        if (frame) frame.bombs = bombs.map((bomb) => ({ ...bomb }));
      },
    },
    select: {
      layout: select.layout,
      createRenderer: () => {
        const surface = new Surface(definition, stage);
        const backLayer = new Container();
        const sprite = new Sprite(surface.texture);
        backLayer.addChild(sprite);
        return {
          outroMs: select.outroMs ?? 0,
          backLayer,
          frontLayer: new Container(),
          render: (selectFrame) => {
            const hits: Array<[number, number, number, number, () => void]> = [];
            let animating = false;
            surface.draw((canvas) => {
              animating = select.draw(canvas, { ...selectFrame, hit: (...rect) => hits.push(rect) }) === true;
            });
            for (const [x, y, w, h, action] of hits) addHitArea(selectFrame.layer, x, y, w, h, 'pointer', action);
            return animating;
          },
          tick: () => {},
          dispose: () => {
            backLayer.destroy({ children: true });
            surface.destroy();
          },
        };
      },
    },
    result: {
      render: (resultFrame) => {
        resultSurface ??= new Surface(definition, stage);
        const surface = resultSurface;
        surface.draw((canvas) => result.draw(canvas, resultFrame));
        resultFrame.layer.addChild(new Sprite(surface.texture));
      },
    },
  });
}

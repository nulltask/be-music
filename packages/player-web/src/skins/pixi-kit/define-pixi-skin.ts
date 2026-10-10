import { Container, Graphics, WebGLRenderer } from 'pixi.js';
import {
  defineBeMusicSkin,
  type BeMusicGameplayFrame,
  type BeMusicResultFrame,
  type BeMusicSelectFrame,
  type BeMusicSkin,
  type BeMusicSurface,
} from '@be-music/skin-sdk';
import { drawCautionMine } from './mine.ts';
import { ChildPool, LaggedDisposer } from './pools.ts';
import { setTextResolution } from './resolution.ts';
import { collectHitAreas, type PixiHitArea } from './skin-text.ts';
import type { PixiSelectFrame, PixiSelectRenderer, PixiSkinDefinition } from './types.ts';

/**
 * Turns a {@link PixiSkinDefinition} into a be-music skin. Every surface the player hands the skin gets its own Pixi
 * `WebGLRenderer` on the surface's WebGL 2 context; each frame replays the player's plain frame data into the skin's
 * Pixi renderer functions and renders the result into the canvas.
 */
export function definePixiSkin(definition: PixiSkinDefinition): BeMusicSkin<'webgl2'> {
  const { gameplay, select, result: _result, ...meta } = definition;
  const surfaces = new WeakMap<HTMLCanvasElement, PixiSurface>();
  const surfaceFor = (surface: BeMusicSurface<'webgl2'>): PixiSurface | undefined => surfaces.get(surface.canvas);

  return defineBeMusicSkin<BeMusicSkin<'webgl2'>>({
    ...meta,
    context: 'webgl2',
    // Pixi needs a stencil buffer for masks; the canvas is composited over the BGA, so it keeps (premultiplied) alpha.
    // The player uploads the canvas in the same frame it is drawn, so the drawing buffer needn't be preserved (keeping
    // it would cost a full-surface copy every frame).
    contextAttributes: {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      stencil: true,
      preserveDrawingBuffer: false,
    },
    async setup(surface) {
      const renderer = new WebGLRenderer();
      await renderer.init({
        canvas: surface.canvas,
        context: surface.context,
        width: surface.width,
        height: surface.height,
        resolution: surface.pixelRatio,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: false,
      });
      surfaces.set(surface.canvas, new PixiSurface(renderer));
    },
    teardown(surface) {
      surfaceFor(surface)?.destroy();
      surfaces.delete(surface.canvas);
    },
    gameplay: {
      bombDurationMs: gameplay.bombDurationMs,
      // Pixi skins always draw mines: their own `renderMine`, or the player's caution-striped bar.
      drawsMines: true,
      draw(surface, frame) {
        const target = surfaceFor(surface);
        if (!target) return;
        target.screen ??= new GameplayScreen(definition);
        if (!(target.screen instanceof GameplayScreen)) return;
        const screen = target.screen;
        target.render(surface, () => screen.build(frame));
      },
    },
    select: {
      layout: select.layout,
      outroMs: select.outroMs,
      draw(surface, frame) {
        const target = surfaceFor(surface);
        if (!target) return;
        target.screen ??= new SelectScreen(definition.select.createRenderer());
        if (!(target.screen instanceof SelectScreen)) return;
        const screen = target.screen;
        target.render(surface, () => screen.build(frame));
      },
    },
    result: {
      draw(surface, frame) {
        const target = surfaceFor(surface);
        if (!target) return;
        target.screen ??= new ResultScreen(definition);
        if (!(target.screen instanceof ResultScreen)) return;
        const screen = target.screen;
        target.render(surface, () => screen.build(frame));
      },
    },
  });
}

/** One surface's renderer and the screen it shows. */
class PixiSurface {
  screen: GameplayScreen | SelectScreen | ResultScreen | undefined;
  private readonly renderer: WebGLRenderer;

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
  }

  /** Matches the renderer to the surface's size and density, builds the frame, and renders it into the canvas. */
  render(surface: BeMusicSurface, build: () => Container): void {
    const renderer = this.renderer;
    setTextResolution(surface.pixelRatio);
    const root = build();
    // The canvas never sees the pointer (the player handles input), so skip Pixi's hit-testing tree entirely.
    root.eventMode = 'none';
    root.interactiveChildren = false;
    if (
      renderer.resolution !== surface.pixelRatio ||
      renderer.screen.width !== surface.width ||
      renderer.screen.height !== surface.height
    ) {
      renderer.resize(surface.width, surface.height, surface.pixelRatio);
    }
    renderer.render({ container: root, clear: true });
  }

  destroy(): void {
    this.screen?.destroy();
    this.screen = undefined;
    this.renderer.destroy();
  }
}

/** Gameplay: chrome behind, then lanes, notes, hit effects, and the chrome overlay — the player's old layer order. */
class GameplayScreen {
  private readonly definition: PixiSkinDefinition;
  private readonly root = new Container();
  private readonly layer = new Container();
  private readonly lanes = new Graphics();
  /** Every note and long note this frame, drawn into one Graphics (they only add geometry, in draw order). */
  private readonly notes = new Graphics();
  private readonly bombs = new Container();
  private readonly overlayLayer = new Container();
  private readonly layerPool = new ChildPool(this.layer);
  private readonly overlayLayerPool = new ChildPool(this.overlayLayer);
  private readonly bombPool = new ChildPool(this.bombs);

  constructor(definition: PixiSkinDefinition) {
    this.definition = definition;
    this.root.addChild(this.layer, this.lanes, this.notes, this.bombs, this.overlayLayer);
  }

  build(frame: BeMusicGameplayFrame): Container {
    const skin = this.definition.gameplay;
    const { runtime, nowMs, effects, audio } = frame;
    const combo = runtime.combo;

    // Chrome renderers may shake or scale their layers; every frame starts from rest.
    this.layer.position.set(0, 0);
    this.layer.scale.set(1);
    this.overlayLayer.position.set(0, 0);
    this.overlayLayer.scale.set(1);
    this.layerPool.begin();
    this.overlayLayerPool.begin();
    try {
      skin.renderChrome({
        layer: this.layer,
        overlayLayer: this.overlayLayer,
        layerPool: this.layerPool,
        overlayLayerPool: this.overlayLayerPool,
        runtime,
        layout: frame.layout,
      });
    } finally {
      this.layerPool.end();
      this.overlayLayerPool.end();
    }

    this.lanes.clear();
    skin.renderLanes({
      graphics: this.lanes,
      lanes: frame.lanes,
      beatPhase: frame.beatPhase,
      nowMs,
      combo,
      effects,
      audio,
    });

    const notes = this.notes;
    notes.clear();
    for (const note of frame.longNotes) {
      skin.renderLongNote({
        graphics: notes,
        kind: note.kind,
        x: note.x,
        w: note.w,
        top: note.top,
        bottom: note.bottom,
        nowMs,
      });
    }
    for (const note of frame.notes) {
      skin.renderNote({ graphics: notes, kind: note.kind, x: note.x, w: note.w, y: note.y, nowMs });
    }
    // Mines after the notes, so a mine sharing a beat with a note paints on top.
    for (const mine of frame.mines) {
      if (skin.renderMine)
        skin.renderMine({ graphics: notes, kind: mine.kind, x: mine.x, w: mine.w, y: mine.y, nowMs });
      else drawCautionMine(notes, mine.x, mine.w, mine.y);
    }

    this.bombPool.begin();
    try {
      skin.renderBombs({ pool: this.bombPool, bombs: frame.bombs, nowMs, combo, effects, audio });
    } finally {
      this.bombPool.end();
    }
    return this.root;
  }

  destroy(): void {
    for (const pool of [this.layerPool, this.overlayLayerPool, this.bombPool]) pool.destroy();
    this.root.destroy({ children: true });
  }
}

/**
 * Select: the renderer's persistent back / front layers around a layer rebuilt whenever the select state changes (or
 * while the renderer asks for it). Hit areas declared during the rebuild are handed to the player on every frame.
 */
class SelectScreen {
  private readonly renderer: PixiSelectRenderer;
  private readonly root = new Container();
  private readonly layer = new Container();
  /** Retires the previous rebuild a frame late, so unchanged labels keep their text textures. */
  private readonly disposer = new LaggedDisposer();
  private revision = -1;
  private needsFrame = false;
  private hits: PixiHitArea[] = [];

  constructor(renderer: PixiSelectRenderer) {
    this.renderer = renderer;
    this.root.addChild(renderer.backLayer, this.layer, renderer.frontLayer);
  }

  build(frame: BeMusicSelectFrame): Container {
    if (frame.revision !== this.revision || this.needsFrame || frame.launchAt !== undefined) {
      this.revision = frame.revision;
      this.disposer.cycle(this.layer);
      // The Pixi renderer declares its click targets through `addHitArea`; they are replayed into `frame.hit` below.
      const pixiFrame: PixiSelectFrame = { ...frame, layer: this.layer };
      this.hits = collectHitAreas(() => {
        this.needsFrame = this.renderer.render(pixiFrame);
      });
    }
    for (const area of this.hits) frame.hit(area.x, area.y, area.w, area.h, area.action, area.cursor);
    this.renderer.tick(frame.nowMs, frame.focusedSong, frame.launchAt, frame.audio);
    return this.root;
  }

  destroy(): void {
    this.disposer.flush();
    this.renderer.dispose();
    this.root.destroy({ children: true });
  }
}

/** Result: one layer rebuilt every frame, its nodes retired a frame late so unchanged labels keep their textures. */
class ResultScreen {
  private readonly definition: PixiSkinDefinition;
  private readonly root = new Container();
  private readonly backdrop = new Container();
  private readonly layer = new Container();
  private readonly disposer = new LaggedDisposer();

  constructor(definition: PixiSkinDefinition) {
    this.definition = definition;
    this.root.addChild(this.backdrop, this.layer);
  }

  build(frame: BeMusicResultFrame): Container {
    this.disposer.cycle(this.layer);
    this.definition.result.render({ ...frame, layer: this.layer, backdrop: this.backdrop });
    return this.root;
  }

  destroy(): void {
    this.disposer.flush();
    this.root.destroy({ children: true });
  }
}

import type { Container, Graphics } from 'pixi.js';
import type {
  BeMusicAudioFrame,
  BeMusicBomb,
  BeMusicEffectLevel,
  BeMusicGameplayLayout,
  BeMusicGameplayRuntime,
  BeMusicLaneFrame,
  BeMusicLaneKind,
  BeMusicResultFrame,
  BeMusicSelectFrame,
  BeMusicSelectLayout,
  BeMusicSkin,
  BrowserSongEntry,
} from '@be-music/skin-sdk';
import type { ChildPool } from './pools.ts';

/**
 * A be-music skin written with PixiJS display objects. {@link definePixiSkin} runs it on its own Pixi renderer over the
 * canvas the player hands the skin, so the player never sees Pixi: the gameplay frame is replayed into the renderer
 * functions below (chrome, lanes, each note, hit effects), the select screen into a retained renderer, and the result
 * into a layer rebuilt every frame.
 */
export interface PixiSkinDefinition extends Omit<
  BeMusicSkin,
  'context' | 'contextAttributes' | 'setup' | 'teardown' | 'gameplay' | 'select' | 'result'
> {
  readonly gameplay: PixiGameplaySkin;
  readonly select: PixiSelectSkin;
  readonly result: PixiResultSkin;
}

/** What {@link PixiGameplaySkin.renderChrome} receives: its layers and pools, the runtime values, and the layout. */
export interface PixiChromeContext {
  /** Chrome behind the lanes. */
  layer: Container;
  /** Chrome in front of the notes and hit effects. */
  overlayLayer: Container;
  layerPool: ChildPool;
  overlayLayerPool: ChildPool;
  runtime: BeMusicGameplayRuntime;
  layout: BeMusicGameplayLayout;
}

export interface PixiGameplaySkin {
  /** HUD chrome around the playfield (header, gauge, score, BGA frame, judgement / combo text). */
  readonly renderChrome: (context: PixiChromeContext) => void;
  /** Lane beds, key beams, judgement line and key caps for every lane, drawn into one cleared `Graphics`. */
  renderLanes(context: PixiLanesContext): void;
  /** One tap note; `context.graphics` is a fresh pooled `Graphics` owned by this note. */
  renderNote(context: PixiNoteContext): void;
  /** One long note body plus its head / tail caps; `context.graphics` is a fresh pooled `Graphics`. */
  renderLongNote(context: PixiLongNoteContext): void;
  /** Every live hit effect for this frame. Acquire children from `context.pool` (Graphics / Sprite / Text). */
  renderBombs(context: PixiBombsContext): void;
  /** How long a hit effect lives (ms) before the player retires it. */
  readonly bombDurationMs: number;
}

export interface PixiLanesContext {
  graphics: Graphics;
  lanes: readonly BeMusicLaneFrame[];
  /** Fractional beat position in [0, 1). */
  beatPhase: number;
  nowMs: number;
  /** Current combo — lets skins escalate the playfield as a run builds. */
  combo?: number;
  effects?: BeMusicEffectLevel;
  audio?: BeMusicAudioFrame;
}

export interface PixiNoteContext {
  graphics: Graphics;
  kind: BeMusicLaneKind;
  /** Lane rect x / width. Skins choose their own inset. */
  x: number;
  w: number;
  /** Just-timing y: the note's bottom edge. */
  y: number;
  nowMs: number;
}

export interface PixiLongNoteContext {
  graphics: Graphics;
  kind: BeMusicLaneKind;
  x: number;
  w: number;
  /** Tail just-timing y (upper). */
  top: number;
  /** Head just-timing y (lower), clamped to the judgement line while held. */
  bottom: number;
  nowMs: number;
}

export interface PixiBombsContext {
  pool: ChildPool;
  bombs: readonly BeMusicBomb[];
  nowMs: number;
  /** Current combo — lets skins escalate hit effects as a run builds. */
  combo?: number;
  effects?: BeMusicEffectLevel;
  audio?: BeMusicAudioFrame;
}

/** The select frame, with the layer rebuilt on each state change. Declare click targets with `addHitArea`. */
export interface PixiSelectFrame extends Omit<BeMusicSelectFrame, 'hit'> {
  /** Rebuilt whenever the select state changes: the renderer adds its chrome and rows here. */
  layer: Container;
}

export interface PixiSelectRenderer {
  /** Persistent layer behind the rebuilt `frame.layer` (ambient backgrounds). */
  readonly backLayer: Container;
  /** Persistent layer in front of `frame.layer` (cursor, glints). */
  readonly frontLayer: Container;
  /**
   * Rebuilds the input-driven chrome into `frame.layer`. Returns `true` while a transition is still in flight, asking
   * to be rebuilt again next frame.
   */
  render(frame: PixiSelectFrame): boolean;
  /** Per-frame, transform-only animation of the persistent layers. */
  tick(nowMs: number, focusedSong: BrowserSongEntry | undefined, launchAt?: number, audio?: BeMusicAudioFrame): void;
  dispose(): void;
}

export interface PixiSelectSkin {
  readonly layout: BeMusicSelectLayout;
  /** Length of the launch outro (ms) the select screen keeps drawing after a chart is picked. */
  readonly outroMs?: number;
  /** Creates the renderer for one select screen. */
  createRenderer(): PixiSelectRenderer;
}

export interface PixiResultFrame extends BeMusicResultFrame {
  /** Rebuilt every frame. */
  layer: Container;
  /**
   * Persistent layer behind {@link layer}, kept across frames for what needn't be rebuilt (a static ground, a particle
   * field updated in place). Its children are destroyed with the screen.
   */
  backdrop: Container;
}

export interface PixiResultSkin {
  render(frame: PixiResultFrame): void;
}

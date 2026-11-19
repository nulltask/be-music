import type { Container, Graphics } from 'pixi.js';
import type {
  BeMusicAudioFrame,
  BeMusicBomb,
  BeMusicDecideFrame,
  BeMusicEffectLevel,
  BeMusicGameplayLayout,
  BeMusicGameplayRuntime,
  BeMusicLaneFrame,
  BeMusicLaneKind,
  BeMusicLongNoteState,
  BeMusicResultFrame,
  BeMusicSelectFrame,
  BeMusicSelectLayout,
  BeMusicSkin,
  BeMusicSkinSettingValues,
  LibraryChart,
} from '@be-music/player-skin-sdk';
import type { ChildPool } from './pools.ts';

/**
 * A Be-Music Skin written with PixiJS display objects. {@link definePixiSkin} runs it on its own Pixi renderer over the
 * canvas the player hands the skin, so the player never sees Pixi: the gameplay frame is replayed into the renderer
 * functions below (chrome, lanes, each note, hit effects), the select screen into a retained renderer, and the result
 * into a layer rebuilt every frame.
 */
export interface PixiSkinDefinition extends Omit<
  BeMusicSkin,
  'context' | 'contextAttributes' | 'setup' | 'teardown' | 'gameplay' | 'select' | 'result' | 'decide'
> {
  readonly gameplay: PixiGameplaySkin;
  readonly select: PixiSelectSkin;
  readonly result: PixiResultSkin;
  /** The decide screen between select and play; without one the player goes straight to the play. */
  readonly decide?: PixiDecideSkin;
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
  /** The player's values for the skin's settings. */
  settings: BeMusicSkinSettingValues;
}

export interface PixiGameplaySkin {
  /** HUD chrome around the playfield (header, gauge, score, BGA frame, judgement / combo text). */
  readonly renderChrome: (context: PixiChromeContext) => void;
  /** Lane beds, key beams, judgement line and key caps for every lane, drawn into one cleared `Graphics`. */
  renderLanes(context: PixiLanesContext): void;
  /** One tap note; `context.graphics` is a fresh pooled `Graphics` owned by this note. */
  renderNote(context: PixiNoteContext): void;
  /**
   * One mine note, to be read as something to avoid. Optional: without it the kit draws the player's caution-striped
   * bar ({@link drawCautionMine}).
   */
  renderMine?(context: PixiNoteContext): void;
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
  /** The playfield's white-key lane width, which every note takes its height from (`resolveNoteHeight`). */
  whiteLaneWidth?: number;
}

export interface PixiLongNoteContext {
  graphics: Graphics;
  kind: BeMusicLaneKind;
  x: number;
  w: number;
  /** Tail just-timing y (upper). */
  top: number;
  /** Head just-timing y (lower), held on the judgement line once passed. */
  bottom: number;
  nowMs: number;
  /** The playfield's white-key lane width, which every note takes its height from (`resolveNoteHeight`). */
  whiteLaneWidth?: number;
  /**
   * How the long note is judged: `'ln'` judges only its head (LR2's LN; the tail just marks where to let go), `'cn'` /
   * `'hcn'` judge the release too. Lets a skin draw an LN's tail apart from a tail that is judged.
   */
  mode?: 'ln' | 'cn' | 'hcn';
  /** A back-spin scratch, whose tail is judged on a reverse spin (`BeMusicLongNote.backSpinScratch`). */
  backSpinScratch?: boolean;
  /** Where the long note is in its life (`BeMusicLongNote.state`): a held hell charge note is charging. */
  state?: BeMusicLongNoteState;
  /** Milliseconds since the player let go early and the note was judged dropped (`BeMusicLongNote.releasedElapsedMs`). */
  releasedElapsedMs?: number;
}

export interface PixiBombsContext {
  /** Persistent effects layer, available for skin-specific clipping. */
  layer?: Container;
  pool: ChildPool;
  bombs: readonly BeMusicBomb[];
  nowMs: number;
  /**
   * The lanes, for effects tied to a lane rather than a hit: `holding` / `holdStartedAtMs` say a long note is held
   * there. Drawn in this layer, above the notes.
   */
  lanes?: readonly BeMusicLaneFrame[];
  /** Current combo — lets skins escalate hit effects as a run builds. */
  combo?: number;
  settings?: BeMusicSkinSettingValues;
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
  tick(nowMs: number, focusedChart: LibraryChart | undefined, launchAt?: number, audio?: BeMusicAudioFrame): void;
  dispose(): void;
}

export interface PixiSelectSkin {
  readonly searchTextSize?: number;
  readonly portraitSearchTextSize?: number;
  readonly layout: BeMusicSelectLayout;
  /** The list's geometry on the skin's portrait stage (see `BeMusicSelectSkin.portraitLayout`). */
  readonly portraitLayout?: BeMusicSelectLayout;
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

export interface PixiDecideFrame extends BeMusicDecideFrame {
  /** Rebuilt every frame. */
  layer: Container;
  /**
   * Persistent layer behind {@link layer}, kept across frames for what needn't be rebuilt (a ground, a particle field
   * updated in place). Its children are destroyed with the screen.
   */
  backdrop: Container;
}

export interface PixiDecideSkin {
  /** How long (ms) the screen shows before the play starts (`BeMusicDecideSkin.durationMs`). */
  readonly durationMs?: number;
  render(frame: PixiDecideFrame): void;
}

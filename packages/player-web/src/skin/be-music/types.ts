import type { Container, Graphics } from 'pixi.js';
import type { BrowserBrowseEntry, BrowserSongEntry } from '../../collection/types.ts';
import type { SkinlessGameplayChromeRenderer } from '../../scene/gameplay-chrome.ts';
import type { PixiGameplayResultData } from '../../scene/lr2/gameplay.ts';
import type { ChildPool } from '../../scene/pixi-utils.ts';

/**
 * be-music skin format — the code-defined skins the built-in (default) family renders with when no LR2 / beatoraja
 * theme is loaded. Unlike LR2 / beatoraja themes (data files interpreted by a scene), a be-music skin is a set of
 * renderer functions over a fixed 640x480 design canvas: the shared scenes own input, timing, audio, and layout
 * contracts (lane geometry, select hit areas), and call into the active skin for every pixel of chrome.
 *
 * Hosts pick one with {@link BeMusicSkin.id} from a registry (`createBeMusicSkinRegistry`) and pass it to the default
 * scene classes via their `beMusicSkin` option. Swapping skins only needs the scenes to be rebuilt.
 */
export interface BeMusicSkin {
  /** Stable identifier (persisted by hosts, e.g. `'phantom'`). */
  readonly id: string;
  /** Human-readable name for pickers. */
  readonly label: string;
  /**
   * CSS font shorthands (`'400 24px "Anton"'`) the skin draws with. Hosts should load the faces (e.g. via Google Fonts)
   * and may `document.fonts.load` these before mounting so the first frame doesn't rasterize with a fallback face.
   */
  readonly fontLoads: readonly string[];
  readonly gameplay: BeMusicGameplaySkin;
  readonly select: BeMusicSelectSkin;
  readonly result: BeMusicResultSkin;
}

/** Visual class of a lane, resolved from its channel — skins pick colours per class. */
export type BeMusicLaneKind = 'white' | 'black' | 'scratch';

export interface BeMusicGameplaySkin {
  /** HUD chrome around the playfield (header, gauge, score, BGA frame, judgement / combo text). */
  readonly renderChrome: SkinlessGameplayChromeRenderer;
  /** Lane beds, key beams, judgement line and key caps for every lane, drawn into one cleared `Graphics`. */
  renderLanes(context: BeMusicLanesContext): void;
  /** One tap note; `context.graphics` is a fresh pooled `Graphics` owned by this note. */
  renderNote(context: BeMusicNoteContext): void;
  /** One long note body plus its head / tail caps; `context.graphics` is a fresh pooled `Graphics`. */
  renderLongNote(context: BeMusicLongNoteContext): void;
  /** Every live hit effect for this frame. Acquire children from `context.pool` (Graphics / Sprite / Text). */
  renderBombs(context: BeMusicBombsContext): void;
  /** How long a hit effect lives (ms) before the scene retires it. */
  readonly bombDurationMs: number;
}

export interface BeMusicLaneFrame {
  channel: string;
  kind: BeMusicLaneKind;
  x: number;
  w: number;
  top: number;
  /** Judgement line y — notes land with their bottom edge here. */
  bottom: number;
  /** Key-beam intensity in [0, 1]: 1 while held, decaying after release. */
  beam: number;
}

export interface BeMusicLanesContext {
  graphics: Graphics;
  lanes: readonly BeMusicLaneFrame[];
  /** Fractional beat position in [0, 1). */
  beatPhase: number;
  nowMs: number;
}

export interface BeMusicNoteContext {
  graphics: Graphics;
  kind: BeMusicLaneKind;
  /** Lane rect x / width. Skins choose their own inset. */
  x: number;
  w: number;
  /** Just-timing y: the note's bottom edge. */
  y: number;
  nowMs: number;
}

export interface BeMusicLongNoteContext {
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

export interface BeMusicBomb {
  channel: string;
  kind: BeMusicLaneKind;
  x: number;
  w: number;
  /** Judgement line y of the lane. */
  y: number;
  /** Milliseconds since the hit. */
  elapsedMs: number;
  /** Stable per-hit seed so particle scatter doesn't shimmer frame to frame. */
  seed: number;
}

export interface BeMusicBombsContext {
  pool: ChildPool;
  bombs: readonly BeMusicBomb[];
  nowMs: number;
}

/** Song-list geometry shared by the select renderer (drawing) and the scene (row hit-testing). */
export interface BeMusicSelectLayout {
  listX: number;
  listTop: number;
  /** Distance from the canvas bottom to the list's last row edge. */
  listBottomInset: number;
  rowHeight: number;
}

export interface BeMusicSelectSkin {
  readonly layout: BeMusicSelectLayout;
  /** Creates the per-scene renderer; called once per select scene instance. */
  createRenderer(): BeMusicSelectRenderer;
}

export interface BeMusicSelectActions {
  play: () => void;
  autoPlay: () => void;
  activateSearch: () => void;
}

export interface BeMusicSelectFrame {
  /** Rebuilt every render: the renderer adds its chrome, rows, and hit areas here. */
  layer: Container;
  designWidth: number;
  designHeight: number;
  nowMs: number;
  /** `performance.now()` when the scene was (re)shown — drives entrance animations. */
  sceneStartedAt: number;
  /** `performance.now()` of the last cursor move — drives focus transitions. */
  cursorChangedAt: number;
  entries: readonly BrowserBrowseEntry[];
  selectedIndex: number;
  /** First entry index drawn in the list window, and how many rows fit (see `resolveSelectListWindow`). */
  firstVisibleIndex: number;
  visibleRows: number;
  focusedSong: BrowserSongEntry | undefined;
  /** Current folder label (or search label), `undefined` at the library root. */
  folderLabel: string | undefined;
  searchQuery: string;
  totalCharts: number;
  actions: BeMusicSelectActions;
}

export interface BeMusicSelectRenderer {
  /** Persistent layer mounted behind the rebuilt `frame.layer` (ambient backgrounds). */
  readonly backLayer: Container;
  /** Persistent layer mounted in front of `frame.layer` (cursor, glints). */
  readonly frontLayer: Container;
  /**
   * Rebuilds the input-driven chrome into `frame.layer`. Returns `true` while a transition is still in flight, asking
   * the scene to render again next frame.
   */
  render(frame: BeMusicSelectFrame): boolean;
  /** Per-frame, transform-only animation of the persistent layers. */
  tick(nowMs: number, focusedSong: BrowserSongEntry | undefined): void;
  dispose(): void;
}

export interface BeMusicResultFrame {
  /** Rebuilt every frame. */
  layer: Container;
  designWidth: number;
  designHeight: number;
  result: PixiGameplayResultData;
  /** IIDX DJ level (`AAA` … `F`). */
  rankLabel: string;
  /** EX-score rate in percent. */
  ratePercent: number;
  /** Milliseconds since the scene mounted, or `Infinity` once the player skipped the entrance. */
  elapsedMs: number;
  nowMs: number;
}

export interface BeMusicResultSkin {
  render(frame: BeMusicResultFrame): void;
}

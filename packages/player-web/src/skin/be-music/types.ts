import type { Container, Graphics } from 'pixi.js';
import type { BrowserBrowseEntry, BrowserSongEntry } from '../../collection/types.ts';
import type { SkinlessGameplayChromeRenderContext } from '../../scene/gameplay-chrome.ts';
import type { PixiGameplayResultData } from '../../scene/core/result-data.ts';
import type { ChildPool } from '../../scene/pixi-utils.ts';
import type { AudioFeatures } from '../../runtime/audio-analysis.ts';

/**
 * be-music skin format — the code-defined skins the built-in (default) family renders with when no LR2 / beatoraja
 * theme is loaded. Unlike LR2 / beatoraja themes (data files interpreted by a scene), a be-music skin is a set of
 * renderer functions over a fixed design canvas ({@link BeMusicSkin.stage}, 640x480 unless the skin declares another): the shared scenes own input, timing, audio, and layout
 * contracts (lane geometry, select hit areas), and call into the active skin for every pixel of chrome.
 *
 * Hosts pick one with {@link BeMusicSkin.id} from a registry (`createBeMusicSkinRegistry`) and pass it to the default
 * scene classes via their `beMusicSkin` option. Swapping skins only needs the scenes to be rebuilt.
 *
 * Skins are written against the public `@be-music/player-web/skin-sdk` subpath (the built-in skins included) and
 * declared with its `defineBeMusicSkin`, which checks {@link BeMusicSkin.apiVersion} and the metadata.
 */
export interface BeMusicSkin {
  /**
   * The skin API revision the skin was written against (`BE_MUSIC_SKIN_API_VERSION` when it was built). Hosts refuse a
   * skin whose revision they don't support and fall back to a built-in one.
   */
  readonly apiVersion: number;
  /** Stable identifier (persisted by hosts, e.g. `'phantom'`). */
  readonly id: string;
  /** Human-readable name for pickers. */
  readonly label: string;
  /** The skin's own release, as a semantic version (`'1.2.0'`). */
  readonly version: string;
  /** Who made the skin. */
  readonly author: BeMusicSkinAuthor;
  /** One or two sentences for skin pickers. */
  readonly description?: string;
  /** Where to find the skin (project page, repository). */
  readonly homepage?: string;
  /** SPDX license identifier of the skin's code and assets (`'MIT'`). */
  readonly license?: string;
  /**
   * CSS font shorthands (`'400 24px "Anton"'`) the skin draws with. Hosts should load the faces (e.g. via Google Fonts)
   * and may `document.fonts.load` these before mounting so the first frame doesn't rasterize with a fallback face.
   */
  readonly fontLoads: readonly string[];
  /**
   * Design canvas the skin draws on and where its gameplay BGA sits. Omitted: the LR2-compatible 640x480 canvas with
   * the fixed 256 px BGA square.
   */
  readonly stage?: BeMusicStage;
  readonly gameplay: BeMusicGameplaySkin;
  readonly select: BeMusicSelectSkin;
  readonly result: BeMusicResultSkin;
}

/** A skin's maker, as shown in skin pickers and credits. */
export interface BeMusicSkinAuthor {
  readonly name: string;
  /** Profile, home page, or contact URL. */
  readonly url?: string;
}

/** Axis-aligned rectangle in design pixels. */
export interface BeMusicRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A skin's design canvas (see {@link BeMusicSkin.stage}). */
export interface BeMusicStage {
  readonly width: number;
  readonly height: number;
  /**
   * The gameplay BGA rect for a playfield whose rightmost lane ends at `playfieldRight`. The scene composites the BGA
   * here and the skin frames the same rect, so the BGA can make room for wide (double play / keyboard) playfields.
   */
  resolveBgaRect(playfieldRight: number): BeMusicRect;
}

/**
 * How much showmanship a skin should put on: `'full'` (everything), `'reduced'` (no screen shake / full-screen flashes,
 * lighter particle counts — also the sensible default for `prefers-reduced-motion`), or `'off'` (static chrome and a
 * plain hit flash only).
 */
export type BeMusicEffectLevel = 'full' | 'reduced' | 'off';

/** Visual class of a lane, resolved from its channel — skins pick colours per class. */
export type BeMusicLaneKind = 'white' | 'black' | 'scratch';

/**
 * Live analysis of what is playing, sampled once per frame: loudness (`level` / `peak` / `db`), `bass` / `mid` /
 * `high` energy, a 16-band log-spaced spectrum (`bands`, ≈ 30 Hz → 14 kHz), and an `onset` envelope that jumps to 1
 * on each detected transient. Gameplay taps the whole mix; select taps the BGM and chart preview. Absent when the
 * host has no Web Audio.
 */
export type BeMusicAudioFrame = AudioFeatures;

/** One lane of the gameplay layout, in design pixels. */
export interface BeMusicLayoutLane {
  channel: string | undefined;
  kind: BeMusicLaneKind;
  side: '1P' | '2P';
  x: number;
  w: number;
}

/**
 * Where everything sits on the gameplay stage this frame, as the host resolved it: the stage size, every lane, the
 * playfield's bounds and judgement line, and the BGA rect (from the skin's {@link BeMusicStage}). Skins place their
 * chrome from this instead of computing geometry themselves, so host-side layout changes (double play, keyboard
 * modes, new aspect ratios) reach every skin.
 */
export interface BeMusicGameplayLayout {
  stage: { width: number; height: number };
  lanes: readonly BeMusicLayoutLane[];
  playfield: {
    /** Left edge of the leftmost lane / right edge of the rightmost lane. */
    left: number;
    right: number;
    centerX: number;
    /** Top of the lanes, and the judgement line notes land on. */
    top: number;
    judgementY: number;
    /** Horizontal extent of each play side present (`2P` only in double play). */
    sides: Partial<Record<'1P' | '2P', { left: number; right: number }>>;
  };
  /** The BGA rect, or `undefined` when the playfield leaves no room for one. */
  bga: BeMusicRect | undefined;
}

/** What {@link BeMusicGameplaySkin.renderChrome} receives: the layers and runtime values, plus the frame's layout. */
export interface BeMusicChromeContext extends SkinlessGameplayChromeRenderContext {
  layout: BeMusicGameplayLayout;
}

export interface BeMusicGameplaySkin {
  /** HUD chrome around the playfield (header, gauge, score, BGA frame, judgement / combo text). */
  readonly renderChrome: (context: BeMusicChromeContext) => void;
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
  /** Current combo — lets skins escalate the playfield as a run builds. */
  combo?: number;
  effects?: BeMusicEffectLevel;
  /** What is playing right now (see {@link BeMusicAudioFrame}). */
  audio?: BeMusicAudioFrame;
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
  /** Current combo — lets skins escalate hit effects as a run builds. */
  combo?: number;
  effects?: BeMusicEffectLevel;
  /** What is playing right now (see {@link BeMusicAudioFrame}). */
  audio?: BeMusicAudioFrame;
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
  effects: BeMusicEffectLevel;
  /** `performance.now()` when a chart was launched and the skin's outro is playing, otherwise `undefined`. */
  launchAt: number | undefined;
}

export interface BeMusicSelectRenderer {
  /**
   * Length (ms) of the outro the renderer plays after a chart is launched, before the scene hands off to gameplay.
   * `0` / omitted launches immediately. The scene keeps rendering frames (with `frame.launchAt` set) until it elapses.
   */
  readonly outroMs?: number;
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
  tick(nowMs: number, focusedSong: BrowserSongEntry | undefined, launchAt?: number, audio?: BeMusicAudioFrame): void;
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
  effects: BeMusicEffectLevel;
}

export interface BeMusicResultSkin {
  render(frame: BeMusicResultFrame): void;
}

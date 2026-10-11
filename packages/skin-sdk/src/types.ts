import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import type { BeMusicAudioFrame } from './audio.ts';
import type { BeMusicResultData } from './result-data.ts';
import type { BrowserBrowseEntry, BrowserSongEntry } from './song.ts';

/**
 * be-music skin format — the code-defined skins the built-in (default) family renders with when no LR2 / beatoraja
 * theme is loaded. Unlike LR2 / beatoraja themes (data files interpreted by a scene), a be-music skin draws every
 * screen itself onto a canvas the player hands it, with whatever it likes: the Canvas 2D API, raw WebGL / WebGPU, or a
 * framework such as PixiJS or three.js that the skin brings along. The player owns input, timing, audio, judging, and
 * layout, collects what is on screen each frame as plain data, and shows the skin's canvas.
 *
 * Nothing here depends on a rendering framework. Skins are written against the public `@be-music/player-web/skin-sdk`
 * subpath and declared with its `defineBeMusicSkin`, which checks {@link BeMusicSkin.apiVersion} and the metadata.
 * Hosts pick one with {@link BeMusicSkin.id} from a registry (`createBeMusicSkinRegistry`) and pass it to the default
 * scene classes via their `beMusicSkin` option.
 */
export interface BeMusicSkin<K extends BeMusicSurfaceContextKind = BeMusicSurfaceContextKind> {
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
  /** Design canvas the skin draws on and where its gameplay BGA sits. Defaults to the 16:9 `wideStage`. */
  readonly stage?: BeMusicStage;
  /** Which canvas context the player creates for each surface. */
  readonly context: K;
  /** Attributes passed to `canvas.getContext` (e.g. `{ alpha: true }`, `{ antialias: true, stencil: true }`). */
  readonly contextAttributes?: CanvasRenderingContext2DSettings | WebGLContextAttributes;
  /**
   * Called once for every new surface before its first draw — create a framework renderer on the canvas, compile
   * shaders, request a GPU device. Drawing waits until a returned promise settles.
   */
  setup?(surface: BeMusicSurface<K>): void | Promise<void>;
  /** Called when the player is done with a surface — release what `setup` created (renderers, GPU resources). */
  teardown?(surface: BeMusicSurface<K>): void;
  readonly gameplay: BeMusicGameplaySkin<K>;
  readonly select: BeMusicSelectSkin<K>;
  readonly result: BeMusicResultSkin<K>;
}

/** A skin's maker, as shown in skin pickers and credits. */
export interface BeMusicSkinAuthor {
  readonly name: string;
  /** Profile, home page, or contact URL. */
  readonly url?: string;
}

/** Canvas rendering contexts a skin can draw with. */
export interface BeMusicSurfaceContextMap {
  '2d': CanvasRenderingContext2D;
  webgl: WebGLRenderingContext;
  webgl2: WebGL2RenderingContext;
  webgpu: GPUCanvasContext;
}

export type BeMusicSurfaceContextKind = keyof BeMusicSurfaceContextMap;

/**
 * The canvas a skin draws one screen on. It is sized to the device pixels the stage covers on screen, so drawing at
 * `pixelRatio` canvas pixels per design pixel shows dot by dot.
 */
export interface BeMusicSurface<K extends BeMusicSurfaceContextKind = BeMusicSurfaceContextKind> {
  canvas: HTMLCanvasElement;
  context: BeMusicSurfaceContextMap[K];
  /** Size in design pixels (the stage size). */
  width: number;
  height: number;
  /** Canvas pixels per design pixel. `'2d'` surfaces come cleared and pre-scaled by it; other contexts apply it. */
  pixelRatio: number;
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

/** One side's recent judgement. */
export interface BeMusicJudgeState {
  side: '1P' | '2P';
  /** PERFECT / GREAT / GOOD / BAD / POOR. Empty when no recent judge. */
  judge?: string;
  combo?: number;
}

/** Live gameplay values for the HUD. */
export interface BeMusicGameplayRuntime {
  songTitle?: string;
  songArtist?: string;
  bpm?: number;
  hiSpeed?: number;
  score?: number;
  exScore?: number;
  exScoreMax?: number;
  combo?: number;
  maxCombo?: number;
  perfect?: number;
  great?: number;
  good?: number;
  bad?: number;
  poor?: number;
  gauge?: number;
  clearThreshold?: number;
  laneCount?: number;
  laneChannels?: readonly string[];
  playVariant?: ChartPlayVariant;
  /** PERFECT / GREAT / GOOD / BAD / POOR. Empty when no recent judge. */
  lastJudge?: string;
  /** Per-side judgement snapshots. DP renderers can paint 1P / 2P independently from these values. */
  judgeSides?: readonly BeMusicJudgeState[];
  /** AAA / AA / A / B / C / D / E / F. */
  rank?: string;
  autoplay?: boolean;
  hasBga?: boolean;
  /** Monotonic play clock (ms) for animation. */
  nowMs?: number;
  /** Song progress in [0, 1] — drives a progress track. */
  progressRatio?: number;
  /** Fractional beat position in [0, 1) — drives beat-synced pulses. */
  beatPhase?: number;
  /** Active compat ruleset id (`lr2` / `beatoraja` / `iidx`). */
  rulesetLabel?: string;
  /** Ruleset-scoped gauge id (`GROOVE` / `HARD` / `HAZARD` / ...) labelling the gauge. */
  gaugeLabel?: string;
  /** True for survival gauges — no clear notch. */
  gaugeSurvival?: boolean;
  /** FAST (early GREAT/GOOD) count. */
  fast?: number;
  /** SLOW (late GREAT/GOOD) count. */
  slow?: number;
  /** Playable notes in the chart (0 while unknown). */
  totalNotes?: number;
  /**
   * Milliseconds since the chart's first beat: negative during the intro count-in, `undefined` before the play has
   * been scheduled. Lets chrome stage entrance cut-ins against the real start.
   */
  chartMs?: number;
  /** True while the chart's audio / BGA are still loading (or a BGA video is transcoding) before the play starts. */
  loading?: boolean;
  /** Play-clock ms of the most recent judgement — drives the judge / combo "punch". */
  judgeAtMs?: number;
  /** Play-clock ms and lane class of the most recent key press (or autoplay hit) — drives input-reactive visuals. */
  impulseAtMs?: number;
  impulseKind?: BeMusicLaneKind;
  /** Showmanship level to render at (defaults to `'full'`). */
  effects?: BeMusicEffectLevel;
  /** Live analysis of the mix for audio-reactive chrome (loudness, spectrum, onsets); absent without Web Audio. */
  audio?: BeMusicAudioFrame;
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

/** A tap note as drawn this frame: its lane rect and the y its bottom edge sits at. */
export interface BeMusicNote {
  kind: BeMusicLaneKind;
  x: number;
  w: number;
  y: number;
}

/**
 * A mine (landmine) note as drawn this frame: its lane rect and the y its bottom edge sits at. Pressing the lane as it
 * passes the judgement line costs a BAD, so draw it as something to avoid. Only handed to skins that set
 * {@link BeMusicGameplaySkin.drawsMines}.
 */
export interface BeMusicMine {
  kind: BeMusicLaneKind;
  x: number;
  w: number;
  y: number;
}

/** A long note as drawn this frame: its lane rect, tail (top) and head (bottom, clamped to the line while held). */
export interface BeMusicLongNote {
  kind: BeMusicLaneKind;
  x: number;
  w: number;
  top: number;
  bottom: number;
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

/** Everything on the gameplay screen this frame. */
export interface BeMusicGameplayFrame {
  nowMs: number;
  /** HUD values: score, combo, gauge, judgements, song, loading, … */
  runtime: BeMusicGameplayRuntime;
  /** Stage, lanes, playfield bounds, judgement line, and the BGA rect (leave it transparent: the video is behind). */
  layout: BeMusicGameplayLayout;
  /** Every lane with its key-beam intensity. */
  lanes: readonly BeMusicLaneFrame[];
  notes: readonly BeMusicNote[];
  longNotes: readonly BeMusicLongNote[];
  /** Mine notes still ahead of the player. Always empty unless the skin sets {@link BeMusicGameplaySkin.drawsMines}. */
  mines: readonly BeMusicMine[];
  /** Live hit effects with their age. */
  bombs: readonly BeMusicBomb[];
  /** Fractional beat position in [0, 1). */
  beatPhase: number;
  effects: BeMusicEffectLevel;
  audio: BeMusicAudioFrame | undefined;
}

export interface BeMusicGameplaySkin<K extends BeMusicSurfaceContextKind = BeMusicSurfaceContextKind> {
  /** Draws one gameplay frame. Called once per frame, right before the player renders. */
  draw(surface: BeMusicSurface<K>, frame: BeMusicGameplayFrame): void;
  /** How long a hit effect lives (ms) before the player retires it. Default 300. */
  readonly bombDurationMs?: number;
  /**
   * Set to `true` when the skin draws mine notes itself from `frame.mines`. Otherwise the player draws them over the
   * skin in its own built-in style, so a skin written before mines reached the frame still shows them.
   */
  readonly drawsMines?: boolean;
}

/** Song-list geometry shared by the skin (drawing) and the scene (row hit-testing). */
export interface BeMusicSelectLayout {
  listX: number;
  listTop: number;
  /** Distance from the canvas bottom to the list's last row edge. */
  listBottomInset: number;
  rowHeight: number;
}

export interface BeMusicSelectActions {
  play: () => void;
  autoPlay: () => void;
  activateSearch: () => void;
}

/** Everything on the select screen this frame. */
export interface BeMusicSelectFrame {
  designWidth: number;
  designHeight: number;
  nowMs: number;
  /**
   * Increases whenever the select state changes (cursor, folder, search, list contents). Skins that keep a scene graph
   * can rebuild it only when this moves.
   */
  revision: number;
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
  /** What is playing right now: the BGM or the chart preview (see {@link BeMusicAudioFrame}). */
  audio: BeMusicAudioFrame | undefined;
  /**
   * Makes the rect (design pixels) run `action` when clicked — e.g. `frame.hit(x, y, w, h, frame.actions.play)`. Hit
   * areas last for the frame they were declared in, so declare them on every draw. `cursor` is the CSS cursor shown
   * over the rect (`'pointer'` by default).
   */
  hit(x: number, y: number, w: number, h: number, action: () => void, cursor?: string): void;
}

export interface BeMusicSelectSkin<K extends BeMusicSurfaceContextKind = BeMusicSurfaceContextKind> {
  /** Where the song list sits (the player hit-tests the rows with it). */
  readonly layout: BeMusicSelectLayout;
  /** Length of the launch outro (ms) the select screen keeps drawing after a chart is picked. Default 0. */
  readonly outroMs?: number;
  /** Draws one select frame. Called every frame while the select screen is shown. */
  draw(surface: BeMusicSurface<K>, frame: BeMusicSelectFrame): void;
}

/** Everything on the result screen this frame. */
export interface BeMusicResultFrame {
  designWidth: number;
  designHeight: number;
  result: BeMusicResultData;
  /** IIDX DJ level (`AAA` … `F`). */
  rankLabel: string;
  /** EX-score rate in percent. */
  ratePercent: number;
  /** Milliseconds since the scene mounted, or `Infinity` once the player skipped the entrance. */
  elapsedMs: number;
  nowMs: number;
  effects: BeMusicEffectLevel;
}

export interface BeMusicResultSkin<K extends BeMusicSurfaceContextKind = BeMusicSurfaceContextKind> {
  /** Draws one result frame. Called every frame while the result screen is shown. */
  draw(surface: BeMusicSurface<K>, frame: BeMusicResultFrame): void;
}

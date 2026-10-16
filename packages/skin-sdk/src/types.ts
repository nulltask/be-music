import type { ChartPlayVariant } from '@be-music/chart';
import type { Judge, JudgeTiming, LaneCover, PlayOptionChoices, PlaySide } from '@be-music/scene-model';
import type { BeMusicAudioFrame } from './audio.ts';
import type { BeMusicPlayOptions } from './play-options.ts';
import type { BeMusicResultData, GaugeHistorySample, ScoreHistorySample } from './result-data.ts';
import type { BeMusicSkinSetting, BeMusicSkinSettingValues } from './settings.ts';
import type {
  BeMusicCourseRecord,
  BeMusicSongImageKind,
  BeMusicSongRecord,
  BrowserBrowseEntry,
  BrowserCourseEntry,
  BrowserSongEntry,
} from './song.ts';

/**
 * be-music skin format — the code-defined skins the built-in (default) family renders with when no LR2 / beatoraja
 * theme is loaded. Unlike LR2 / beatoraja themes (data files interpreted by a scene), a be-music skin draws every
 * screen itself onto a canvas the player hands it, with whatever it likes: the Canvas 2D API, raw WebGL / WebGPU, or a
 * framework such as PixiJS or three.js that the skin brings along. The player owns input, timing, audio, judging, and
 * layout, collects what is on screen each frame as plain data, and shows the skin's canvas.
 *
 * Nothing here depends on a rendering framework. Skins are written against the `@be-music/skin-sdk` package
 * and declared with its `defineBeMusicSkin`, which checks {@link BeMusicSkin.apiVersion} and the metadata.
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
  /**
   * Design canvas for screens taller than wide (a phone or tablet held upright), e.g. the 9:16 `tallStage`. Hosts draw
   * on it while the screen is portrait, and on {@link stage} otherwise; gameplay stays on {@link stage} for play modes
   * too wide for a portrait playfield (see `supportsPortraitLayout`). A skin without one is always drawn on
   * {@link stage}, scaled down to fit a portrait screen. Pick between the two with `resolveBeMusicStage`.
   */
  readonly portraitStage?: BeMusicStage;
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
  /**
   * The decide screen shown between picking a chart and the play (title card, stage file, the chosen options). Hosts
   * mount it only when a skin declares one, and go straight from select to gameplay otherwise.
   */
  readonly decide?: BeMusicDecideSkin<K>;
  /**
   * Options the player can tune for this skin (a colour theme, a judge-text offset, an effect toggle). Hosts build
   * their settings UI from this schema, persist the values per skin, and hand them back on every frame as `settings`,
   * already checked and filled in by {@link resolveBeMusicSkinSettings}. Ids must be unique.
   */
  readonly settings?: readonly BeMusicSkinSetting[];
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
  /**
   * Which of the skin's stages this surface is drawn on: `'portrait'` for {@link BeMusicSkin.portraitStage},
   * `'landscape'` otherwise. Absent means `'landscape'`. The stage (and with it the surface's size) can change between
   * draws when the screen rotates.
   */
  orientation?: BeMusicStageOrientation;
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

/** Whether a stage is wider than tall (`'landscape'`) or taller than wide (`'portrait'`). */
export type BeMusicStageOrientation = 'landscape' | 'portrait';

/** A skin's design canvas (see {@link BeMusicSkin.stage} and {@link BeMusicSkin.portraitStage}). */
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

/** A judgement grade, best first (`Judge` of `@be-music/scene-model`). */
export type BeMusicJudge = Judge;

/** A play side. `'2P'` only exists in double play (`PlaySide` of `@be-music/scene-model`). */
export type BeMusicSide = PlaySide;

/** An image the host hands a skin (song images, BGA layers): anything `drawImage` / `texImage2D` accepts. */
export type BeMusicImage = CanvasImageSource;

/**
 * Visual class of a lane, resolved from its channel — skins pick colours per class. `'wheel-up'` / `'wheel-down'` are
 * the 24 / 48 KEY modes' wheel lanes, on the outer edge of each side where the IIDX modes keep their scratch: draw them
 * apart from the keys (like a scratch) and show which way each one turns.
 */
export type BeMusicLaneKind = 'white' | 'black' | 'scratch' | 'wheel-up' | 'wheel-down';

/** One lane of the gameplay layout, in design pixels. */
export interface BeMusicLayoutLane {
  channel: string | undefined;
  kind: BeMusicLaneKind;
  side: BeMusicSide;
  x: number;
  w: number;
}

/**
 * Where everything sits on the gameplay stage this frame, as the host resolved it: the stage size, every lane, the
 * playfield's bounds and judgement line, and the BGA rect (from the skin's {@link BeMusicStage}). Skins place their
 * chrome from this instead of computing geometry themselves, so host-side layout changes (double play, keyboard
 * modes, new aspect ratios) reach every skin.
 */
/**
 * How the host lays out the gameplay screen. `'standard'` is the cabinet-style playfield; `'touch'` is for playing on a
 * touch screen: wide, equal-width lanes across most of the stage, a low judgement line, and (on a landscape stage) no
 * BGA.
 */
export type GameplayLayoutMode = 'standard' | 'touch';

export interface BeMusicGameplayLayout {
  /**
   * The layout mode the host resolved. Optional so a layout built by hand stays valid; absent means `'standard'`. In
   * `'touch'` the lanes and playfield bounds already describe the touch geometry and `bga` is `undefined` on a
   * landscape stage, so a skin placing its chrome from this layout needs no mode check — read it only to restyle
   * something for touch play.
   */
  mode?: GameplayLayoutMode;
  /**
   * The orientation of the stage the layout is for. Optional so a layout built by hand stays valid; absent means
   * `'landscape'`. On a portrait stage the lanes span the stage's width in its lower part and the BGA sits above them in
   * both layout modes.
   */
  orientation?: BeMusicStageOrientation;
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
    sides: Partial<Record<BeMusicSide, { left: number; right: number }>>;
  };
  /** The BGA rect, or `undefined` when the playfield leaves no room for one. */
  bga: BeMusicRect | undefined;
}

/** One side's recent judgement. */
export interface BeMusicJudgeState {
  side: BeMusicSide;
  /** PERFECT / GREAT / GOOD / BAD / POOR. Empty when no recent judge. */
  judge?: string;
  combo?: number;
}

/** Live gameplay values for the HUD. */
export interface BeMusicGameplayRuntime {
  songTitle?: string;
  songArtist?: string;
  songGenre?: string;
  /** BPM at the playhead: follows the chart's tempo changes (and holds through stops), not just its header BPM. */
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
  /**
   * The chart being played — level, difficulty, `#RANK`, `#TOTAL` and the rest of its header via
   * `song.chart.metadata`, plus the same images {@link BeMusicGameplayFrame.songImage} resolves.
   */
  song?: BrowserSongEntry;
  /**
   * Signed timing offset (ms) of the most recent timed judgement: positive when the press was late (SLOW), negative
   * when early (FAST), 0 dead on. Only judgements with a timing carry one — autoplay hits, mine BADs and missed notes
   * (POOR without a press) leave it unchanged.
   */
  lastJudgeDeltaMs?: number;
  /**
   * The most recent timed judgements (at most 64), oldest first — drives timing meters. Same rules as
   * {@link lastJudgeDeltaMs}.
   */
  judgeTimings?: readonly BeMusicJudgeTiming[];
  /** SUDDEN+ / HIDDEN+ / LIFT per play side, as fractions of the lane height. */
  laneCovers?: readonly BeMusicLaneCover[];
  /**
   * How long (ms) a note stays on screen, from the edge of the lane cover to the judgement line, at the current speed —
   * BPM, hi-speed and the chart's `#SCROLL` × `#SPEED` at the playhead. 0 while the chart scrolls backwards or stands
   * still, as beatoraja shows it.
   */
  visibleMs?: number;
  /** IIDX-style green number (`visibleMs × 0.6`): the note's on-screen time in frames at 60 Hz. */
  greenNumber?: number;
  /** Lowest, highest, and main (longest-held) BPM of the chart. */
  minBpm?: number;
  maxBpm?: number;
  mainBpm?: number;
  /**
   * Length of the song (ms) and how far the audio has played (ms), on the audio clock: it stops while paused and
   * starts at 0 when the song starts. Remaining time is `songLengthMs - songElapsedMs`. Unlike {@link chartMs}, which is
   * measured from the chart's first beat and runs negative through the count-in, this measures the song as heard.
   */
  songLengthMs?: number;
  songElapsedMs?: number;
  /**
   * Play-clock ms (the {@link nowMs} clock) of moments that happen at most once per play, latched when they occur and
   * `undefined` before: the gauge failing mid-play, the last playable note being judged, and the chart's end (the
   * outro).
   */
  failedAtMs?: number;
  allNotesDoneAtMs?: number;
  outroAtMs?: number;
  /**
   * Play-clock ms when the gauge first rose above its starting value, and when it first reached its maximum.
   * `undefined` until it happens.
   */
  gaugeRiseAtMs?: number;
  gaugeMaxAtMs?: number;
  /**
   * EX-score and gauge samples taken at every judgement so far, the same series the result screen receives. They are
   * the host's live arrays, shared by reference: read them, never mutate them.
   */
  scoreHistory?: readonly ScoreHistorySample[];
  gaugeHistory?: readonly GaugeHistorySample[];
  /**
   * The judge windows of the active ruleset, in ms. Resolved from the chart's `#RANK` when the play starts; a mid-chart
   * `#EXRANK` change is not reflected.
   */
  judgeWindows?: BeMusicJudgeWindows;
}

/**
 * One timed judgement: when it happened and how far off the press was. `deltaMs` is positive when late (SLOW) and
 * negative when early (FAST). See {@link binJudgeTimings} for a histogram. `JudgeTiming` of `@be-music/scene-model`.
 */
export type BeMusicJudgeTiming = JudgeTiming;

/** One play side's lane covers, as fractions (0..1) of the lane height (`LaneCover` of `@be-music/scene-model`). */
export type BeMusicLaneCover = LaneCover;

/** One judge window: how early and how late (both positive ms) a press still earns the grade. */
export interface BeMusicJudgeWindow {
  earlyMs: number;
  lateMs: number;
}

/** The windows of one note class; `emptyPoor` is the window for an empty POOR, when the ruleset has one. */
export type BeMusicJudgeWindowSet = Record<'perfect' | 'great' | 'good' | 'bad', BeMusicJudgeWindow> & {
  emptyPoor?: BeMusicJudgeWindow;
};

/** The active ruleset's judge windows per note class. */
export interface BeMusicJudgeWindows {
  note: BeMusicJudgeWindowSet;
  scratch: BeMusicJudgeWindowSet;
  /** The release of a long note that judges its end (charge / hell charge notes). */
  longNoteEnd: BeMusicJudgeWindowSet;
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
  /** Play-clock ms of the lane's last key press and release (also for autoplay hits). */
  pressedAtMs?: number;
  releasedAtMs?: number;
  /** True while a long note in this lane is held, and the play-clock ms the hold started. */
  holding?: boolean;
  holdStartedAtMs?: number;
}

/**
 * A tap note as drawn this frame: its lane rect and the y its bottom edge sits at. In a chart with a negative `#SCROLL`
 * a note still ahead can sit below the judgement line, down to the bottom of the stage (the player draws such charts
 * the way beatoraja does); clip to the lane's `bottom` to keep nothing below the line.
 */
export interface BeMusicNote {
  kind: BeMusicLaneKind;
  x: number;
  w: number;
  y: number;
  /** True when autoplay (or auto-scratch) will hit this note. */
  autoplay?: boolean;
}

/**
 * A mine (landmine) note as drawn this frame: its lane rect and the y its bottom edge sits at (below the judgement line
 * when a negative `#SCROLL` puts it there, as for {@link BeMusicNote}). A mine detonates when its lane
 * is held as it crosses the judgement line (under the LR2 ruleset also on a press inside the PGREAT window) and drains
 * the gauge, so draw it as something to avoid. Only handed to skins that set
 * {@link BeMusicGameplaySkin.drawsMines}.
 */
export interface BeMusicMine {
  kind: BeMusicLaneKind;
  x: number;
  w: number;
  y: number;
}

/**
 * A long note as drawn this frame: its lane rect, tail (top) and head (bottom, held on the line once passed). Like
 * {@link BeMusicNote}, it can reach below the judgement line when a negative `#SCROLL` puts it there.
 */
export interface BeMusicLongNote {
  kind: BeMusicLaneKind;
  x: number;
  w: number;
  top: number;
  bottom: number;
  /**
   * How the long note judges: `'ln'` (only the start counts), `'cn'` (charge note: the release is judged too), or
   * `'hcn'` (hell charge note: the gauge drains while it isn't held).
   */
  mode?: BeMusicLongNoteMode;
  /**
   * Where the long note is in its life: not yet reached, being held, dropped (missed at the head or let go early), or
   * completed. LR2 draws a dropped long note at half alpha until it goes; the built-in skins do the same.
   */
  state?: BeMusicLongNoteState;
  /** True when autoplay (or auto-scratch) plays this long note. */
  autoplay?: boolean;
}

export type BeMusicLongNoteMode = 'ln' | 'cn' | 'hcn';

export type BeMusicLongNoteState = 'pending' | 'held' | 'dropped' | 'done';

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
  /** The judgement that set the hit off. */
  judge?: BeMusicJudge;
}

/**
 * A measure (bar) line crossing one lane run, as drawn this frame. Like {@link BeMusicNote}, it can sit below the
 * judgement line when a negative `#SCROLL` puts it there.
 */
export interface BeMusicMeasureLine {
  side: BeMusicSide;
  /** Left edge and width of the lane run it crosses. */
  x: number;
  w: number;
  y: number;
}

/**
 * The BGA layers showing this frame, for a skin that composites the BGA itself ({@link BeMusicGameplaySkin.drawsBga}).
 * Following the BMS convention, the host hands {@link layer} with pure black (`#000000`) already turned transparent,
 * while {@link base} and {@link poor} are opaque: draw all three with plain alpha blending, without keying them again.
 * A bmson layer (whose spec keeps black opaque) and a video layer come as authored. `#SWBGA` animation frames are
 * already picked; a slot's `#ARGB` tint and opacity are left to the skin.
 *
 * Images come at their authored size. The BGA rect stands for a 256x256 canvas: to match other BMS players, draw a
 * still image whose long edge is at most 256 px at its own size on that canvas, centered horizontally and against the
 * top edge, and stretch a larger image or a video over the whole rect.
 */
export interface BeMusicBgaFrame {
  /** The base layer (`#BMP` on channel 04), or a video frame. */
  base?: BeMusicImage;
  /** The layer drawn over the base (channel 07). */
  layer?: BeMusicImage;
  /** The miss image (channel 06), shown while {@link poorActive}. */
  poor?: BeMusicImage;
  /** True while a POOR is being shown: draw {@link poor} in place of the base and layer. */
  poorActive: boolean;
}

/**
 * Looks up one of a song's images (`#STAGEFILE`, `#BANNER`, `#BACKBMP`). Images load lazily: the first calls return
 * `undefined` while the image decodes, and the screen is redrawn (on select, `revision` moves) once it is ready. Also
 * `undefined` when the song has no such image or the host doesn't provide images. Look the image up on every draw rather
 * than keeping it: hosts cache a bounded number and may close the least recently used one.
 */
export type BeMusicSongImageLookup = (song: BrowserSongEntry, kind: BeMusicSongImageKind) => ImageBitmap | undefined;

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
  /**
   * Measure lines on screen, one per lane run they cross. Always empty unless the skin sets
   * {@link BeMusicGameplaySkin.drawsMeasureLines}.
   */
  measureLines: readonly BeMusicMeasureLine[];
  /** The BGA layers to composite. Always `undefined` unless the skin sets {@link BeMusicGameplaySkin.drawsBga}. */
  bga: BeMusicBgaFrame | undefined;
  /** Fractional beat position in [0, 1). */
  beatPhase: number;
  effects: BeMusicEffectLevel;
  audio: BeMusicAudioFrame | undefined;
  /** The player's values for the skin's {@link BeMusicSkin.settings}. */
  settings: BeMusicSkinSettingValues;
  songImage: BeMusicSongImageLookup;
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
  /**
   * Set to `true` when the skin draws the lane covers (SUDDEN+ / HIDDEN+) itself from `runtime.laneCovers`. Otherwise
   * the player draws its own covers over the skin.
   */
  readonly drawsLaneCover?: boolean;
  /**
   * Set to `true` when the skin draws measure lines itself from `frame.measureLines`. Otherwise the player draws its
   * own lines.
   */
  readonly drawsMeasureLines?: boolean;
  /**
   * Set to `true` when the skin composites the BGA itself from `frame.bga`. Otherwise the player shows the BGA behind
   * the skin's canvas, in {@link BeMusicGameplayLayout.bga}.
   */
  readonly drawsBga?: boolean;
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
  /** Sets one play option. Values outside the option's choices are ignored. */
  setPlayOption<K extends keyof BeMusicPlayOptions>(key: K, value: BeMusicPlayOptions[K]): void;
  /** Moves one play option to its next (`step` 1, the default) or previous (`-1`) choice, wrapping around. */
  cyclePlayOption(key: keyof BeMusicPlayOptions, step?: 1 | -1): void;
  /** Opens or closes the focused song's readme (the `.txt` beside the chart), when it has one. */
  toggleReadme(): void;
}

/**
 * The values each play option can take, for options with a fixed set of choices (numeric ones are left out):
 * `PlayOptionChoices` of `@be-music/scene-model`.
 */
export type BeMusicPlayOptionChoices = PlayOptionChoices;

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
  /**
   * Design pixels the list is pulled past its resting place toward later entries (negative: toward earlier ones), less
   * than one row: a finger dragging it, a list gliding after a swipe, or a trackpad mid-scroll. Each whole row turns
   * into a cursor step, so it stays under a row either way, and it is 0 at rest and where the window can't move (the
   * list's ends). Draw the rows that much higher, as `selectListRows` lays them out, and the list follows the finger;
   * a skin that ignores it scrolls a row at a time.
   */
  listScroll: number;
  focusedSong: BrowserSongEntry | undefined;
  /**
   * The course bar under the cursor (`undefined` on a song or folder bar, and from hosts that predate it). PLAY and
   * AUTO start it; {@link describeCourseCard} gives the lines a card shows for it.
   */
  focusedCourse?: BrowserCourseEntry;
  /** Current folder label (or search label), `undefined` at the library root. */
  folderLabel: string | undefined;
  searchQuery: string;
  /**
   * True while the host's text field sits over the search box (the box the skin bound to `actions.activateSearch`):
   * the player is typing there, so draw the box but not its text or placeholder. Absent or false otherwise.
   */
  searchEditing?: boolean;
  totalCharts: number;
  actions: BeMusicSelectActions;
  effects: BeMusicEffectLevel;
  /** `performance.now()` when a chart was launched and the skin's outro is playing, otherwise `undefined`. */
  launchAt: number | undefined;
  /** What is playing right now: the BGM or the chart preview (see {@link BeMusicAudioFrame}). */
  audio: BeMusicAudioFrame | undefined;
  /** The current play options; change them through {@link BeMusicSelectActions.setPlayOption}. */
  playOptions: Readonly<BeMusicPlayOptions>;
  /** The choices of every play option that has a fixed set. */
  playOptionChoices: BeMusicPlayOptionChoices;
  /** The pointer in design pixels, or `undefined` when it is outside the screen (or there is none). */
  pointer: { x: number; y: number } | undefined;
  /** The player's best record on `song`, or `undefined` when the host keeps none (or it was never played). */
  songRecord(song: BrowserSongEntry): BeMusicSongRecord | undefined;
  /**
   * The player's best record on `course` (a course bar), or `undefined` when the host keeps none, the course was never
   * played, or it is a random course or a NEW COURSE bar. Absent from hosts that predate it.
   */
  courseRecord?(course: BrowserCourseEntry): BeMusicCourseRecord | undefined;
  songImage: BeMusicSongImageLookup;
  /** The player's values for the skin's {@link BeMusicSkin.settings}. */
  settings: BeMusicSkinSettingValues;
  /**
   * Makes the rect (design pixels) run `action` when clicked — e.g. `frame.hit(x, y, w, h, frame.actions.play)`. Hit
   * areas last for the frame they were declared in, so declare them on every draw. `cursor` is the CSS cursor shown
   * over the rect (`'pointer'` by default). Returns whether the pointer is over the rect, for hover states.
   */
  hit(x: number, y: number, w: number, h: number, action: () => void, cursor?: string): boolean;
}

export interface BeMusicSelectSkin<K extends BeMusicSurfaceContextKind = BeMusicSurfaceContextKind> {
  /** Where the song list sits (the player hit-tests the rows with it). */
  readonly layout: BeMusicSelectLayout;
  /**
   * Where the song list sits on the skin's {@link BeMusicSkin.portraitStage}. Defaults to {@link layout}. See
   * `resolveBeMusicSelectLayout`.
   */
  readonly portraitLayout?: BeMusicSelectLayout;
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
  songImage: BeMusicSongImageLookup;
  /** The player's values for the skin's {@link BeMusicSkin.settings}. */
  settings: BeMusicSkinSettingValues;
}

export interface BeMusicResultSkin<K extends BeMusicSurfaceContextKind = BeMusicSurfaceContextKind> {
  /** Draws one result frame. Called every frame while the result screen is shown. */
  draw(surface: BeMusicSurface<K>, frame: BeMusicResultFrame): void;
}

/** Everything on the decide screen this frame. */
export interface BeMusicDecideFrame {
  designWidth: number;
  designHeight: number;
  nowMs: number;
  /** Milliseconds since the screen mounted. */
  elapsedMs: number;
  /** The chart about to be played. */
  song: BrowserSongEntry;
  /** The options the play will run with. */
  playOptions: Readonly<BeMusicPlayOptions>;
  songImage: BeMusicSongImageLookup;
  effects: BeMusicEffectLevel;
  /** The player's values for the skin's {@link BeMusicSkin.settings}. */
  settings: BeMusicSkinSettingValues;
  audio: BeMusicAudioFrame | undefined;
}

export interface BeMusicDecideSkin<K extends BeMusicSurfaceContextKind = BeMusicSurfaceContextKind> {
  /**
   * How long (ms) the screen shows before the play starts. Default 2000. The player can skip ahead (Enter) or go back to
   * select (Escape) meanwhile.
   */
  readonly durationMs?: number;
  /** Draws one decide frame. Called every frame while the decide screen is shown. */
  draw(surface: BeMusicSurface<K>, frame: BeMusicDecideFrame): void;
}

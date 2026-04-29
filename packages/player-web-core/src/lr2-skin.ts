import { dirname, basename, normalizePath } from './library.ts';

export interface Lr2ImageRect {
  imagePath: string;
  x: number;
  y: number;
  w: number;
  h: number;
  divx: number;
  divy: number;
  /** Animation cycle length (ms). 0 = static. */
  cycle: number;
  /**
   * Source-side timer reference. The cycle counter is anchored at the moment
   * this timer started so animations are deterministic per skin convention.
   * 0 = scene start.
   */
  timer: number;
}

export interface Lr2DestinationRect {
  /**
   * Keyframe time in milliseconds since the source `timer` started counting.
   * The renderer interpolates between consecutive keyframes by `time`.
   */
  time: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Easing applied to the segment **into** this keyframe (LR2 spec):
   *
   *   0 = constant (linear) / 1 = accelerate (ease-in) /
   *   2 = decelerate (ease-out) / 3 = discontinuous (snap).
   */
  acc: number;
  /** 0..1 normalised from LR2's 0..255 alpha. */
  alpha: number;
  /** 0..255 colour tint. 255 means no tint (LR2 only allows reducing channels). */
  r: number;
  g: number;
  b: number;
  /** Blend mode (0=none, 1=alpha, 2=add, 3=sub, 4=multiply, 6=xor, 9..11 specials). */
  blend: number;
  /** 1 enables bilinear filter on scaling. */
  filter: number;
  /** Rotation in degrees (LR2 spec, 360 = full revolution). */
  angle: number;
  /** Numpad-layout rotation pivot (0=center, 1..9=corners/edges). */
  center: number;
  /** Loop offset (-1 disables / hides after, 0 loops to time=0, otherwise loops to that time). */
  loop: number;
  /** Time-base timer index (see timer.txt). */
  timer: number;
  /** Display conditions (op1/op2/op3). Negative values mean negation; 0 entries are dropped. */
  ops: number[];
  /**
   * Optional fourth column past the standard op slots. The LR2 default
   * 7-keys skin uses `op4=1` on the scratch turntable's `#DST_IMAGE` to
   * mean "spin this sprite at the scratch rate". Most other elements leave
   * it 0.
   */
  op4: number;
}

export interface Lr2ImageElement {
  source: Lr2ImageRect;
  /**
   * Final keyframe of the destination animation. Convenient for static
   * elements; for animation, prefer `keyframes` which exposes the full
   * sequence including intermediate `time` markers.
   */
  destination: Lr2DestinationRect;
  /**
   * Full set of `#DST_*` keyframes in time-order. Use these together with
   * `Lr2DestinationRect.loop` and `time` to animate the rectangle / colour
   * / alpha across a play session.
   */
  keyframes: Lr2DestinationRect[];
}

export interface Lr2CustomOption {
  name: string;
  defaultOp: number;
  numChoices: number;
}

export interface Lr2CustomFile {
  name: string;
  path: string;
}

export type Lr2NumberAlignment = 'right' | 'left' | 'center';

export interface Lr2NumberSourceRect extends Lr2ImageRect {
  num: number;
  alignment: Lr2NumberAlignment;
  padding: number;
}

export interface Lr2NumberElement {
  source: Lr2NumberSourceRect;
  destination: Lr2DestinationRect;
  keyframes: Lr2DestinationRect[];
}

export interface Lr2GrooveGaugeElement {
  source: Lr2ImageRect;
  destination: Lr2DestinationRect;
  keyframes: Lr2DestinationRect[];
  /** 0 = 1P side, 1 = 2P side. */
  index: number;
  /** Per-cell horizontal advance (pixels) for the next gauge unit. */
  addX: number;
  /** Per-cell vertical advance (pixels). */
  addY: number;
}

export type Lr2NowComboKind = 'good' | 'great' | 'perfect';

export interface Lr2NowComboElement {
  source: Lr2ImageRect & { alignment: Lr2NumberAlignment; padding: number };
  destination: Lr2DestinationRect;
  keyframes: Lr2DestinationRect[];
  /** Which judgement triggers this combo style ('good' | 'great' | 'perfect'). */
  kind: Lr2NowComboKind;
}

/**
 * `#SRC_JUDGELINE` + `#DST_JUDGELINE` element. LR2 draws a horizontal bar at
 * the judgement line per side (index 0=1P, 1=2P). The skin texture frame
 * itself decides the colour/thickness; we just need to honour the destination
 * rectangle so it lands at the correct y-coordinate above the keys.
 */
export interface Lr2JudgeLineElement {
  source: Lr2ImageRect;
  destination: Lr2DestinationRect;
  keyframes: Lr2DestinationRect[];
  /** Side: 0 = 1P, 1 = 2P. */
  index: number;
}

/**
 * `#SRC_LINE` + `#DST_LINE` element — LR2's measure-line graphic that
 * scrolls with the chart. The skin specifies the per-side x/y/w/h at the
 * judgement line; the renderer replicates this texture at every measure
 * boundary, offset upward by the same scroll amount as falling notes.
 */
export interface Lr2MeasureLineElement {
  source: Lr2ImageRect;
  destination: Lr2DestinationRect;
  keyframes: Lr2DestinationRect[];
  /** Side: 0 = 1P, 1 = 2P. */
  index: number;
}

/**
 * `#SRC_BGA` + `#DST_BGA` — defines the rectangle where the chart's BGA
 * (background animation) is composited. The SRC is mostly a placeholder
 * in the LR2 spec; columns 11/12/13 carry the **nobase / nolayer / nopoor**
 * flags (set to 1 to suppress that layer for this DST entry). Multiple
 * `#DST_BGA` entries can coexist when gated on different ops (e.g. one
 * for "normal" BGA size, another for "large" BGA size).
 */
export interface Lr2BgaElement {
  destination: Lr2DestinationRect;
  keyframes: Lr2DestinationRect[];
  /** When true the base BGA layer (channel 04 / bmson `bga.events`) is hidden. */
  noBase: boolean;
  /** When true the layer BGAs (channels 07 / 0A / bmson `bga.layerEvents`) are hidden. */
  noLayer: boolean;
  /** When true the POOR BGA (channel 06 / bmson `bga.poorEvents`) is hidden. */
  noPoor: boolean;
}

/**
 * `#SRC_TEXT` text alignment. LR2 spec column 4 of #SRC_TEXT:
 * 0 = left, 1 = center, 2 = right.
 */
export type Lr2TextAlignment = 'left' | 'center' | 'right';

/**
 * `#SRC_TEXT` + `#DST_TEXT` element. LR2 renders strings (song title,
 * artist, difficulty label, …) via a separately-defined font (either an
 * image-font `#LR2FONT` or a system `#FONT`). The `st` (source type) is a
 * one-of-many enum — see `text.txt` of the LR2 reference docs.
 */
export interface Lr2TextElement {
  /** Font index — references the order of `#LR2FONT` / `#FONT` entries. */
  font: number;
  /** Source type — what string to render (10 = title, 14 = artist, …). */
  st: number;
  alignment: Lr2TextAlignment;
  /**
   * `edit=1` makes the text field clickable for in-place editing. We
   * don't yet ship a text-edit UI, so this is purely informational
   * for skins that gate UI on it.
   */
  edit: number;
  /**
   * Panel gate (-1 = only when no panel open, 0 = always, 1..9 =
   * matching panel only). LR2 default skins use this to scope option
   * labels to their respective option panel.
   */
  panel: number;
  destination: Lr2DestinationRect;
  keyframes: Lr2DestinationRect[];
}

/**
 * `#SRC_BARGRAPH` bar fill direction. LR2 spec column 11 (`muki`):
 * 0 = horizontal (default), 1 = vertical.
 */
export type Lr2BarGraphMuki = 'horizontal' | 'vertical';

/**
 * `#SRC_BARGRAPH` + `#DST_BARGRAPH`. A bargraph is a sprite that is
 * progressively revealed from one edge based on a runtime value (gauge,
 * loading progress, score graph, …). The `type` enum in `bargraph.txt`
 * controls which value drives the fill.
 */
export interface Lr2BarGraphElement {
  source: Lr2ImageRect;
  destination: Lr2DestinationRect;
  keyframes: Lr2DestinationRect[];
  /** Bargraph type code (see lr2skinhelp/bargraph.txt). */
  type: number;
  muki: Lr2BarGraphMuki;
}

/**
 * `#SRC_SLIDER` orientation. Column 11 (`muki`): 0=down, 1=up, 2=right,
 * 3=left — i.e. the direction the slider travels as its value grows.
 */
export type Lr2SliderMuki = 'down' | 'up' | 'right' | 'left';

/**
 * `#SRC_SLIDER` + `#DST_SLIDER`. A slider is a draggable knob whose
 * position represents a runtime value. During play sliders are mostly
 * read-only (e.g. the song-progress slider, the hi-speed knob).
 */
export interface Lr2SliderElement {
  source: Lr2ImageRect;
  destination: Lr2DestinationRect;
  keyframes: Lr2DestinationRect[];
  /** Slider type code (see lr2skinhelp/slider.txt). */
  type: number;
  muki: Lr2SliderMuki;
  /** Travel range in design pixels. */
  range: number;
}

/**
 * `#SRC_BUTTON` + `#DST_BUTTON`. A button element shows a per-state
 * cell from a sprite sheet: `divx*divy` cells correspond to the
 * possible states of the button's `type` (sort, difficulty filter,
 * play-mode, panel toggle, etc.) — see `# button_type 一覧` in
 * `docs/LR2SkinHelp.md` (lines 5887+) for the full enum.
 *
 * State management & click handling aren't wired yet; the renderer
 * just paints the cell at the current button state index (cell 0 by
 * default) so the static frame shows the right artwork.
 */
export interface Lr2ButtonElement {
  source: Lr2ImageRect;
  destination: Lr2DestinationRect;
  keyframes: Lr2DestinationRect[];
  /** Button type code (see button_type list in `LR2SkinHelp.md`). */
  type: number;
  /** 0 = display only, 1 = clickable. */
  click: number;
  /** Panel gate: -1 = only when no panel open, 0 = always, 1..9 = only when that panel is open. */
  panel: number;
  /** -1 = `value -` only, 0 = both, 1 = `value +` only. Optional in spec. */
  plusOnly: number;
}

/**
 * `#SRC_ONMOUSE` + `#DST_ONMOUSE`. The element is only painted when
 * the mouse cursor is inside its hit-test rectangle — used for hover
 * highlights on buttons and links. Hit-test coordinates `(x2, y2,
 * w2, h2)` are **relative to the DST `(x, y)`** per LR2 spec; the
 * `panel` field gates the element to a specific option panel.
 */
export interface Lr2OnMouseElement {
  source: Lr2ImageRect;
  destination: Lr2DestinationRect;
  keyframes: Lr2DestinationRect[];
  /** Panel gate (-1 = only when no panel open, 0 = always, 1..9 = matching panel only). */
  panel: number;
  /** Hit-test rect, expressed as offset from DST top-left (`x2`, `y2`, `w2`, `h2`). */
  hitOffsetX: number;
  hitOffsetY: number;
  hitWidth: number;
  hitHeight: number;
}

/**
 * `#SRC_BAR_FLASH` + `#DST_BAR_FLASH`. Animated overlay drawn on top
 * of the focused (`BAR_BODY_ON`) bar — typically a glow or pulse.
 * DST coordinates are relative to the focused bar's top-left, like
 * `#SRC_BAR_TITLE` / `#SRC_BAR_LEVEL`.
 */
export interface Lr2BarFlashElement {
  source: Lr2ImageRect;
  destination: Lr2DestinationRect;
  keyframes: Lr2DestinationRect[];
}

/**
 * `#SRC_BAR_RIVAL` (rival mode WIN/LOSE/DRAW per-bar overlay). One
 * SRC per outcome (`win` / `lose` / `draw`) plus a single shared DST
 * keyframe set. Renderer skipped until rival mode lands; parsed so
 * the data is available when it does.
 */
export type Lr2BarRivalKind = 'win' | 'lose' | 'draw';
export interface Lr2BarRivalSource {
  kind: Lr2BarRivalKind;
  source: Lr2ImageRect;
}

/**
 * `#SRC_BAR_MY_LAMP` / `#SRC_BAR_RIVAL_LAMP` rival-folder lamp
 * variants. Use the same `Lr2BarLampKind` enum as the regular
 * `#SRC_BAR_LAMP`. Parsed but not yet rendered (rival mode is TBD).
 */
export interface Lr2BarRivalLampSet {
  myLamps: Lr2BarLampSource[];
  myLampDestination?: Lr2DestinationRect;
  myLampKeyframes: Lr2DestinationRect[];
  rivalLamps: Lr2BarLampSource[];
  rivalLampDestination?: Lr2DestinationRect;
  rivalLampKeyframes: Lr2DestinationRect[];
}

/**
 * `#SRC_README` + `#DST_README`. Scrollable text viewer used by the
 * `READTEXT` button on the select screen. The renderer is gated on
 * a "readme open" state we don't yet model, so the parser stores
 * the entry but the select view doesn't draw it.
 */
export interface Lr2ReadmeElement {
  /** Font index (`#LR2FONT` order). */
  font: number;
  /** Pixel spacing between lines. */
  lineSpacing: number;
  destination: Lr2DestinationRect;
  keyframes: Lr2DestinationRect[];
}

/**
 * `#SRC_MOUSECURSOR` + `#DST_MOUSECURSOR`. Replaces the system
 * cursor with a skin sprite that follows the pointer. DST `(x, y)`
 * is the offset from the actual mouse position (typically `(0, 0)`).
 */
export interface Lr2MouseCursorElement {
  source: Lr2ImageRect;
  destination: Lr2DestinationRect;
  keyframes: Lr2DestinationRect[];
}

/**
 * `#SRC_BAR_BODY` index → which kind of song-select bar this sprite
 * decorates. The renderer picks the appropriate sprite per song / folder
 * row when populating the on-screen bar list.
 *
 * 0 song / 1 folder / 2 custom folder / 3 new song folder /
 * 4 rival folder / 5 song (rival mode) / 6 course folder /
 * 7 course create / 8 course / 9 random course
 */
export type Lr2BarBodyKind =
  | 'song'
  | 'folder'
  | 'customFolder'
  | 'newSongFolder'
  | 'rivalFolder'
  | 'rivalSong'
  | 'courseFolder'
  | 'courseCreate'
  | 'course'
  | 'randomCourse';

/**
 * Sprite definition for one kind of song-select bar (`#SRC_BAR_BODY`).
 * The select-screen renderer cross-references the bar slot's kind with
 * this map to pick the right artwork.
 */
export interface Lr2BarBodySource {
  kind: Lr2BarBodyKind;
  source: Lr2ImageRect;
}

/**
 * One song-select bar slot (`#DST_BAR_BODY_OFF` / `_ON` index 0..29).
 * `off` is the inactive layout, `on` is the focused layout. LR2 uses up
 * to 30 slots — typically 10 above the focus, 1 at the centre, 10 below.
 */
export interface Lr2BarBodySlot {
  index: number;
  off?: Lr2DestinationRect;
  offKeyframes: Lr2DestinationRect[];
  on?: Lr2DestinationRect;
  onKeyframes: Lr2DestinationRect[];
}

/**
 * `#SRC_BAR_TITLE` / `#DST_BAR_TITLE`: the per-bar song title overlay.
 * DST coordinates are **relative** to the bar slot's `BAR_BODY` rect
 * (LR2 spec: "DST coordinates are relative to the bar's xy"). Only one
 * SRC + DST pair is allowed per skin.
 */
export interface Lr2BarTitleElement {
  /** Font index (references the skin's `#LR2FONT` order). */
  font: number;
  destination: Lr2DestinationRect;
  keyframes: Lr2DestinationRect[];
}

/**
 * `#SRC_BAR_LEVEL` index → difficulty kind. Renders the song's level
 * number using a NUMBER-style cell sheet. DST coordinates are
 * **relative** to the bar's xy.
 *
 * 0 = undefined / 1 = BEGINNER / 2 = NORMAL / 3 = HYPER / 4 = ANOTHER /
 * 5 = INSANE / 6 = IR RANKING.
 */
export type Lr2BarLevelKind = 'undefined' | 'beginner' | 'normal' | 'hyper' | 'another' | 'insane' | 'irRanking';

export interface Lr2BarLevelSource {
  kind: Lr2BarLevelKind;
  source: Lr2NumberSourceRect;
}

/**
 * `#SRC_BAR_LAMP` index → clear-lamp kind.
 *   0 = NO PLAY / 1 = FAILED / 2 = EASY / 3 = CLEAR / 4 = HARD /
 *   5 = full combo.
 * `#SRC_BAR_MY_LAMP` / `#SRC_BAR_RIVAL_LAMP` (rival-folder variants)
 * aren't parsed yet — only the plain track is.
 */
export type Lr2BarLampKind = 'noplay' | 'failed' | 'easy' | 'clear' | 'hard' | 'fullcombo';

export interface Lr2BarLampSource {
  kind: Lr2BarLampKind;
  source: Lr2ImageRect;
}

/**
 * `#SRC_BAR_RANK` index → clear-rank kind.
 *   0 = no play / 1 = F / 2 = E / 3 = D / 4 = C / 5 = B / 6 = A /
 *   7 = AA / 8 = AAA.
 */
export type Lr2BarRankKind = 'noplay' | 'F' | 'E' | 'D' | 'C' | 'B' | 'A' | 'AA' | 'AAA';

export interface Lr2BarRankSource {
  kind: Lr2BarRankKind;
  source: Lr2ImageRect;
}

/**
 * Aggregate of the song-select-bar definitions in an LR2 skin. When a
 * skin has no bar definitions (e.g. play-only skins) `slots` is empty
 * and the renderer falls back to its built-in list layout.
 */
export interface Lr2BarLayout {
  bodies: Lr2BarBodySource[];
  slots: Lr2BarBodySlot[];
  /** `#BAR_CENTER`: the slot index that should hold the focused song. */
  center: number;
  /**
   * `#BAR_AVAILABLE`: number of slots that are clickable / focus-able.
   * Slots outside this range only render as scrolling decoration.
   */
  available: number;
  title?: Lr2BarTitleElement;
  /**
   * `#SRC_BAR_LEVEL` artworks keyed by difficulty. The renderer picks
   * one entry based on the focused-song's `#DIFFICULTY` and uses the
   * single shared `levelDestination` (DST_BAR_LEVEL keyframes are not
   * indexed per kind in LR2).
   */
  levels: Lr2BarLevelSource[];
  levelDestination?: Lr2DestinationRect;
  levelKeyframes: Lr2DestinationRect[];
  /** `#SRC_BAR_LAMP` artworks per clear-lamp kind. */
  lamps: Lr2BarLampSource[];
  lampDestination?: Lr2DestinationRect;
  lampKeyframes: Lr2DestinationRect[];
  /** `#SRC_BAR_RANK` artworks per clear-rank kind. */
  ranks: Lr2BarRankSource[];
  rankDestination?: Lr2DestinationRect;
  rankKeyframes: Lr2DestinationRect[];
  /**
   * `#SRC_BAR_FLASH` overlay on the focused bar. LR2 spec: only one
   * SRC + DST pair allowed. Rendered relative to the focused bar's
   * `BAR_BODY_ON` rect.
   */
  flash?: Lr2BarFlashElement;
  /**
   * `#SRC_BAR_RIVAL` artworks (WIN/LOSE/DRAW) drawn on rival-folder
   * bars. Parsed; renderer skipped until rival mode lands.
   */
  rivalIndicators: Lr2BarRivalSource[];
  rivalDestination?: Lr2DestinationRect;
  rivalKeyframes: Lr2DestinationRect[];
  /** Rival-mode lamp variants (`#SRC_BAR_MY_LAMP` / `_RIVAL_LAMP`). */
  rivalLamps: Lr2BarRivalLampSet;
}

/**
 * Scene-timing directives (`#STARTINPUT` / `#FADEOUT` / `#CLOSE` /
 * `#LOADSTART` / `#LOADEND` / `#PLAYSTART` / `#SKIP`). Each value is a
 * millisecond offset from the scene's main timer (timer 0). The
 * select-screen renderer uses `startInput` to gate timer-1 anchored
 * elements; `fadeOut` / `close` would drive scene-exit transitions.
 */
export interface Lr2SkinTiming {
  /** ms after scene mount before timer 1 (input start) fires. */
  startInput?: number;
  /** ms duration of fade-out before scene exits (drives timer 2). */
  fadeOut?: number;
  /** ms before the scene closes (drives timer 3). */
  close?: number;
  /** Play-skin only: load-start / load-end / play-start anchors. */
  loadStart?: number;
  loadEnd?: number;
  playStart?: number;
  /** Result skin only: `#SKIP` ms — minimum input wait before chart-draw skip. */
  skip?: number;
}

/**
 * Scratch-side / DP-flip behaviour declared by the skin (`#SCRATCH`,
 * `#FLIPSIDE`, `#FLIPRESULT`, `#DISABLEFLIP`). All optional — the
 * renderer reads these to decide which side renders the scratch and
 * whether to apply the LR2 "DP flip" mirror.
 *
 * Spec values (`docs/LR2SkinHelp.md`):
 * - `#SCRATCH,1P,2P` — `1P` / `2P` flag for which side has scratch.
 *   `0 = no scratch`, `1 = has scratch` per side.
 * - `#FLIPSIDE` — declares the skin is the flippable kind.
 * - `#FLIPRESULT` — flip persists into the result screen.
 * - `#DISABLEFLIP` — skin opts out of flip entirely.
 */
export interface Lr2ScratchFlip {
  /** `1` if the 1P side has a scratch lane, `0` otherwise. */
  scratch1P?: number;
  /** `1` if the 2P side has a scratch lane, `0` otherwise. */
  scratch2P?: number;
  /** True when the skin declares `#FLIPSIDE`. */
  flipSide: boolean;
  /** True when `#FLIPRESULT` is present (flip carries into result). */
  flipResult: boolean;
  /** True when `#DISABLEFLIP` is present (skin disables flip). */
  disableFlip: boolean;
  /** True when the skin declares `#RELOADBANNER` (banner reloads on cursor move). */
  reloadBanner: boolean;
}

export interface Lr2Skin {
  name: string;
  width: number;
  height: number;
  images: Lr2ImageElement[];
  laneRects: Lr2DestinationRect[];
  notes: Partial<
    Record<
      | 'note'
      | 'lnstart'
      | 'lnend'
      | 'lnbody'
      | 'mine'
      | 'autonote'
      | 'autolnstart'
      | 'autolnend'
      | 'autolnbody'
      | 'automine',
      Lr2ImageRect[]
    >
  >;
  judges: Partial<Record<'perfect' | 'great' | 'good' | 'bad' | 'poor', Lr2ImageElement[]>>;
  numbers: Lr2NumberElement[];
  grooveGauges: Lr2GrooveGaugeElement[];
  nowCombos: Lr2NowComboElement[];
  judgeLines: Lr2JudgeLineElement[];
  measureLines: Lr2MeasureLineElement[];
  bgas: Lr2BgaElement[];
  texts: Lr2TextElement[];
  bargraphs: Lr2BarGraphElement[];
  sliders: Lr2SliderElement[];
  buttons: Lr2ButtonElement[];
  onMouseElements: Lr2OnMouseElement[];
  /** `#SRC_README` viewer entries. Parsed; renderer integration is TBD. */
  readmes: Lr2ReadmeElement[];
  /**
   * `#SRC_MOUSECURSOR`. Generally one entry per skin; we keep an
   * array for parity with the other element collections and so a
   * skin that overrides via `#IF` branches works.
   */
  mouseCursors: Lr2MouseCursorElement[];
  /** Scene-timing directives (`#STARTINPUT` / `#FADEOUT` / `#CLOSE` / …). */
  timing: Lr2SkinTiming;
  /** Scratch-side / DP-flip behaviour declared by the skin. */
  scratchFlip: Lr2ScratchFlip;
  /** Song-select bar layout. Only populated when the skin defines `#SRC_BAR_BODY` etc. */
  barLayout: Lr2BarLayout;
  customOptions: Lr2CustomOption[];
  customFiles: Lr2CustomFile[];
  transparentColor?: { r: number; g: number; b: number };
  files: ReadonlyMap<string, Uint8Array>;
}

interface SourceRect {
  gr: number;
  x: number;
  y: number;
  w: number;
  h: number;
  divx: number;
  divy: number;
  cycle: number;
  timer: number;
}

interface NumberSourceEntry {
  source: SourceRect;
  num: number;
  alignment: Lr2NumberAlignment;
  padding: number;
}

interface GrooveGaugeSourceEntry {
  source: SourceRect;
  index: number;
  addX: number;
  addY: number;
}

interface NowComboSourceEntry {
  source: SourceRect;
  index: number;
  alignment: Lr2NumberAlignment;
  padding: number;
}

interface JudgeLineSourceEntry {
  source: SourceRect;
  index: number;
}

interface MeasureLineSourceEntry {
  source: SourceRect;
  index: number;
}

interface BgaSourceEntry {
  noBase: boolean;
  noLayer: boolean;
  noPoor: boolean;
}

interface TextSourceEntry {
  font: number;
  st: number;
  alignment: Lr2TextAlignment;
  edit: number;
  panel: number;
}

interface BarGraphSourceEntry {
  source: SourceRect;
  type: number;
  muki: Lr2BarGraphMuki;
}

interface SliderSourceEntry {
  source: SourceRect;
  type: number;
  muki: Lr2SliderMuki;
  range: number;
}

interface ButtonSourceEntry {
  source: SourceRect;
  type: number;
  click: number;
  panel: number;
  plusOnly: number;
}

interface OnMouseSourceEntry {
  source: SourceRect;
  panel: number;
  hitOffsetX: number;
  hitOffsetY: number;
  hitWidth: number;
  hitHeight: number;
}

interface ReadmeSourceEntry {
  font: number;
  lineSpacing: number;
}

interface BarRivalSourceEntry {
  kind: Lr2BarRivalKind;
  source: SourceRect;
}

interface BarBodySourceEntry {
  kind: Lr2BarBodyKind;
  source: SourceRect;
}

interface BarTitleSourceEntry {
  font: number;
}

interface BarLevelSourceEntry {
  kind: Lr2BarLevelKind;
  source: SourceRect;
  alignment: Lr2NumberAlignment;
  padding: number;
}

interface BarLampSourceEntry {
  kind: Lr2BarLampKind;
  source: SourceRect;
}

interface BarRankSourceEntry {
  kind: Lr2BarRankKind;
  source: SourceRect;
}

interface ParseContext {
  imagePaths: string[];
  imageSources: SourceRect[];
  imageDstGroups: Lr2DestinationRect[][];
  noteSources: Map<string, SourceRect[]>;
  nowJudge1PSources: SourceRect[];
  /**
   * Full keyframe chain per judgement id — [first DST, … last DST]. The
   * renderer needs the whole sequence (not just the first row) to play the
   * judge plate's fade-in / fade-out animation off timer 46.
   */
  nowJudge1PDstGroups: Lr2DestinationRect[][];
  numberSources: NumberSourceEntry[];
  numberDstGroups: Lr2DestinationRect[][];
  grooveGaugeSources: GrooveGaugeSourceEntry[];
  grooveGaugeDstGroups: Lr2DestinationRect[][];
  nowComboSources: NowComboSourceEntry[];
  nowComboDstGroups: Lr2DestinationRect[][];
  judgeLineSources: JudgeLineSourceEntry[];
  judgeLineDstGroups: Lr2DestinationRect[][];
  measureLineSources: MeasureLineSourceEntry[];
  measureLineDstGroups: Lr2DestinationRect[][];
  bgaSources: BgaSourceEntry[];
  bgaDstGroups: Lr2DestinationRect[][];
  textSources: TextSourceEntry[];
  textDstGroups: Lr2DestinationRect[][];
  bargraphSources: BarGraphSourceEntry[];
  bargraphDstGroups: Lr2DestinationRect[][];
  sliderSources: SliderSourceEntry[];
  sliderDstGroups: Lr2DestinationRect[][];
  buttonSources: ButtonSourceEntry[];
  buttonDstGroups: Lr2DestinationRect[][];
  onMouseSources: OnMouseSourceEntry[];
  onMouseDstGroups: Lr2DestinationRect[][];
  readmeSources: ReadmeSourceEntry[];
  readmeDstGroups: Lr2DestinationRect[][];
  mouseCursorSources: SourceRect[];
  mouseCursorDstGroups: Lr2DestinationRect[][];
  /** `#SRC_BAR_FLASH` source (single SRC per spec, last-wins). */
  barFlashSource?: SourceRect;
  /** `#DST_BAR_FLASH` keyframes. */
  barFlashDst: Lr2DestinationRect[];
  /** `#SRC_BAR_RIVAL` per-outcome sources. */
  barRivalSources: BarRivalSourceEntry[];
  barRivalDst: Lr2DestinationRect[];
  /** Rival-mode lamp variants. */
  barMyLampSources: BarLampSourceEntry[];
  barMyLampDst: Lr2DestinationRect[];
  barRivalLampSources: BarLampSourceEntry[];
  barRivalLampDst: Lr2DestinationRect[];
  /**
   * Song-select bar `#SRC_BAR_BODY` definitions (one per kind id 0..9).
   * Sparse — only kinds the skin actually defines have an entry.
   */
  barBodySources: BarBodySourceEntry[];
  /**
   * `#DST_BAR_BODY_OFF` keyframes per slot index 0..29. Sparse like the
   * play-skin DST groups — slot 0 is the topmost off-state position.
   */
  barBodyOffDstGroups: Lr2DestinationRect[][];
  /** `#DST_BAR_BODY_ON` keyframes per slot index 0..29 (focus-state). */
  barBodyOnDstGroups: Lr2DestinationRect[][];
  /** `#BAR_CENTER` value (clamped to slot range at finalization). */
  barCenter: number;
  /** `#BAR_AVAILABLE` value (clamped to slot range at finalization). */
  barAvailable: number;
  /**
   * `#SRC_BAR_TITLE` source. LR2 spec only allows one. We keep the
   * latest one wins to mirror how the LR2 default skin chains an
   * `#IF`-gated alt definition for the focus state.
   */
  barTitleSource?: BarTitleSourceEntry;
  /** `#DST_BAR_TITLE` keyframes (relative to the bar's xy). */
  barTitleDst: Lr2DestinationRect[];
  /** `#SRC_BAR_LEVEL` per-difficulty cell sheets (sparse by kind). */
  barLevelSources: BarLevelSourceEntry[];
  /** `#DST_BAR_LEVEL` shared keyframes (LR2 only ships one DST chain). */
  barLevelDst: Lr2DestinationRect[];
  /** `#SRC_BAR_LAMP` per-clear-lamp sprites. */
  barLampSources: BarLampSourceEntry[];
  /** `#DST_BAR_LAMP` shared keyframes. */
  barLampDst: Lr2DestinationRect[];
  /** `#SRC_BAR_RANK` per-clear-rank sprites. */
  barRankSources: BarRankSourceEntry[];
  /** `#DST_BAR_RANK` shared keyframes. */
  barRankDst: Lr2DestinationRect[];
  laneRects: Lr2DestinationRect[];
  customOptions: Lr2CustomOption[];
  customFiles: Lr2CustomFile[];
  customFileLookup: Map<string, string>;
  transparentColor?: { r: number; g: number; b: number };
  trueOps: Set<number>;
  timing: Lr2SkinTiming;
  scratchFlip: Lr2ScratchFlip;
  name: string;
  width: number;
  height: number;
}

interface ConditionalFrame {
  active: boolean;
  anyMatched: boolean;
  parentActive: boolean;
}

const NOTE_COMMANDS: Record<string, keyof Lr2Skin['notes']> = {
  '#SRC_NOTE': 'note',
  '#SRC_LN_START': 'lnstart',
  '#SRC_LN_END': 'lnend',
  '#SRC_LN_BODY': 'lnbody',
  '#SRC_MINE': 'mine',
  // Auto-play "dummy note" sprites — used while autoplay (op 33) is on with
  // CUSTOMOPTION "AUTOPLAY LANE = DUMMY NOTES" (op 915) selected.
  '#SRC_AUTO_NOTE': 'autonote',
  '#SRC_AUTO_LN_START': 'autolnstart',
  '#SRC_AUTO_LN_END': 'autolnend',
  '#SRC_AUTO_LN_BODY': 'autolnbody',
  '#SRC_AUTO_MINE': 'automine',
};

// LR2 NOWJUDGE_1P index mapping (per the LR2skin spec):
//   0 = early POOR (空POOR), 1 = POOR (見逃し), 2 = BAD,
//   3 = GOOD, 4 = GREAT, 5 = PERFECT (= JUST GREAT).
// Both POOR variants render with the same kind.
const NOW_JUDGE_1P_KIND_BY_INDEX: ReadonlyMap<number, keyof Lr2Skin['judges']> = new Map([
  [0, 'poor'],
  [1, 'poor'],
  [2, 'bad'],
  [3, 'good'],
  [4, 'great'],
  [5, 'perfect'],
]);
// LR2 NOWCOMBO_1P index mapping. BAD or worse breaks the combo, so only
// GOOD/GREAT/PERFECT have meaningful entries.
const NOW_COMBO_1P_KIND_BY_INDEX: ReadonlyMap<number, 'good' | 'great' | 'perfect'> = new Map([
  [3, 'good'],
  [4, 'great'],
  [5, 'perfect'],
]);

/**
 * Which screen's `.lr2skin` to pick when a theme bundle ships multiple
 * (play, select, result, etc.). Defaults to `'play'` for backward
 * compatibility — the original `loadLr2SkinFromFiles()` callers were all
 * the gameplay view.
 */
export type Lr2SkinKind = 'play' | 'select';

/**
 * `play_N.lr2skin` variant hint for the play-skin loader. Themes
 * conventionally bundle one CSV per key-mode (`play_5.lr2skin` SP
 * 5-keys, `play_7.lr2skin` SP 7-keys, `play_9.lr2skin` pop'n,
 * `play_10.lr2skin` DP 10-keys, `play_14.lr2skin` DP 14-keys); the
 * default scoring picks `play_7.lr2skin` because that's the most
 * common chart kind, but DP / 5K / 9K charts need their matching
 * variant for the playfield layout to make sense.
 */
export type Lr2PlayVariant = '5' | '7' | '9' | '10' | '14';

export interface LoadLr2SkinOptions {
  /** Which kind of skin to load. Defaults to `'play'`. */
  kind?: Lr2SkinKind;
  /**
   * For `kind: 'play'` only — biases the candidate scoring towards
   * `play_<variant>.lr2skin`. Falls back to the default scoring
   * (7K-preferred) if no file matches the requested variant.
   */
  playVariant?: Lr2PlayVariant;
}

export async function loadLr2SkinFromFiles(
  files: Iterable<File>,
  options: LoadLr2SkinOptions = {},
): Promise<Lr2Skin | undefined> {
  const sourceFiles = new Map<string, Uint8Array>();
  for (const file of files) {
    const path = normalizePath(file.webkitRelativePath || file.name);
    sourceFiles.set(path, new Uint8Array(await file.arrayBuffer()));
  }
  return loadLr2SkinFromSourceFiles(sourceFiles, options);
}

export function loadLr2SkinFromSourceFiles(
  sourceFiles: ReadonlyMap<string, Uint8Array>,
  options: LoadLr2SkinOptions = {},
): Lr2Skin | undefined {
  const kind = options.kind ?? 'play';
  // Filter `.lr2skin` candidates to the requested kind first so a theme
  // bundle that contains both `Play/play_7.lr2skin` and
  // `Select/select.lr2skin` doesn't accidentally feed the play skin into
  // the select view (or vice versa). Falls back to ANY `.lr2skin` if the
  // kind-specific filter matches nothing — useful for one-off skins that
  // ship a single CSV.
  const lr2SkinPaths = [...sourceFiles.keys()].filter((path) => path.toLowerCase().endsWith('.lr2skin'));
  const filtered = lr2SkinPaths.filter((path) => isSkinPathOfKind(path, kind));
  const candidates = filtered.length > 0 ? filtered : lr2SkinPaths;
  const variant = kind === 'play' ? options.playVariant : undefined;
  const entryPath =
    candidates
      .slice()
      .sort(
        (left, right) =>
          scoreSkinPath(left, kind, variant) - scoreSkinPath(right, kind, variant) ||
          left.localeCompare(right, 'ja'),
      )[0] ?? [...sourceFiles.keys()].find((path) => path.toLowerCase().endsWith('.csv'));
  if (!entryPath) {
    return undefined;
  }

  const context: ParseContext = {
    imagePaths: [],
    imageSources: [],
    imageDstGroups: [],
    noteSources: new Map(),
    nowJudge1PSources: [],
    nowJudge1PDstGroups: [],
    numberSources: [],
    numberDstGroups: [],
    grooveGaugeSources: [],
    grooveGaugeDstGroups: [],
    nowComboSources: [],
    nowComboDstGroups: [],
    judgeLineSources: [],
    judgeLineDstGroups: [],
    measureLineSources: [],
    measureLineDstGroups: [],
    bgaSources: [],
    bgaDstGroups: [],
    textSources: [],
    textDstGroups: [],
    bargraphSources: [],
    bargraphDstGroups: [],
    sliderSources: [],
    sliderDstGroups: [],
    buttonSources: [],
    buttonDstGroups: [],
    onMouseSources: [],
    onMouseDstGroups: [],
    readmeSources: [],
    readmeDstGroups: [],
    mouseCursorSources: [],
    mouseCursorDstGroups: [],
    barFlashDst: [],
    barRivalSources: [],
    barRivalDst: [],
    barMyLampSources: [],
    barMyLampDst: [],
    barRivalLampSources: [],
    barRivalLampDst: [],
    barBodySources: [],
    barBodyOffDstGroups: [],
    barBodyOnDstGroups: [],
    barCenter: 0,
    barAvailable: 0,
    barTitleDst: [],
    barLevelSources: [],
    barLevelDst: [],
    barLampSources: [],
    barLampDst: [],
    barRankSources: [],
    barRankDst: [],
    laneRects: [],
    customOptions: [],
    customFiles: [],
    customFileLookup: new Map(),
    trueOps: defaultParseOps(),
    timing: {},
    scratchFlip: {
      flipSide: false,
      flipResult: false,
      disableFlip: false,
      reloadBanner: false,
    },
    name: basename(entryPath),
    width: 640,
    height: 480,
  };
  readLr2Path(sourceFiles, entryPath, context, new Set());

  return {
    name: context.name,
    width: context.width,
    height: context.height,
    images: context.imageSources.flatMap((source, index) => {
      const dstGroup = context.imageDstGroups[index];
      if (!dstGroup || dstGroup.length === 0) {
        return [];
      }
      // LR2 reserves a few special gr indices for textures that are
      // resolved at runtime instead of from `#IMAGE` declarations:
      //   100 = STAGEFILE, 101 = BACKBMP, 102 = BANNER,
      //   105 = skin-select thumbnail, 110 = solid black, 111 = solid white.
      // We mark them with a sentinel path so the renderer can swap in
      // the appropriate texture (per-song banner, generated 1-dot, etc.)
      // without needing to pre-register them in the `#IMAGE` table.
      const specialPath = specialGraphicPath(source.gr);
      const imagePath = specialPath ?? context.imagePaths[source.gr];
      if (!imagePath) {
        return [];
      }
      // LR2: a sequence of consecutive `#DST_IMAGE` lines after one
      // `#SRC_IMAGE` defines an animation. We expose every keyframe so the
      // renderer can interpolate; the `destination` field is the final
      // (latest-`time`) keyframe, used for visibility checks and as the
      // fallback for static elements.
      const destination = dstGroup[dstGroup.length - 1]!;
      return [{ source: { ...source, imagePath }, destination, keyframes: [...dstGroup] }];
    }),
    laneRects: context.laneRects,
    notes: Object.fromEntries(
      [...context.noteSources.entries()].map(([kind, sources]) => [
        kind,
        sources.map((source) => ({
          ...source,
          imagePath: context.imagePaths[source.gr] ?? '',
        })),
      ]),
    ) as Lr2Skin['notes'],
    judges: createJudgeElements(context),
    numbers: createNumberElements(context),
    grooveGauges: createGrooveGaugeElements(context),
    nowCombos: createNowComboElements(context),
    judgeLines: createJudgeLineElements(context),
    measureLines: createMeasureLineElements(context),
    bgas: createBgaElements(context),
    texts: createTextElements(context),
    bargraphs: createBarGraphElements(context),
    sliders: createSliderElements(context),
    buttons: createButtonElements(context),
    onMouseElements: createOnMouseElements(context),
    readmes: createReadmeElements(context),
    mouseCursors: createMouseCursorElements(context),
    timing: { ...context.timing },
    scratchFlip: { ...context.scratchFlip },
    barLayout: createBarLayout(context),
    customOptions: context.customOptions,
    customFiles: context.customFiles,
    transparentColor: context.transparentColor,
    files: sourceFiles,
  };
}

function clampColorByte(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(255, Math.max(0, Math.trunc(value)));
}

function readLr2Path(
  sourceFiles: ReadonlyMap<string, Uint8Array>,
  path: string,
  context: ParseContext,
  visited: Set<string>,
): void {
  if (visited.has(path)) {
    return;
  }
  visited.add(path);
  const bytes = sourceFiles.get(path);
  if (!bytes) {
    return;
  }

  const ifStack: ConditionalFrame[] = [];
  const isActive = (): boolean => ifStack.every((frame) => frame.active);

  for (const row of parseRows(decodeText(bytes))) {
    const command = row[0]?.toUpperCase();
    if (!command) {
      continue;
    }

    if (command === '#IF') {
      const parentActive = isActive();
      const matched = parentActive && evaluateOps(row.slice(1), context.trueOps);
      ifStack.push({ active: matched, anyMatched: matched, parentActive });
      continue;
    }
    if (command === '#ELSEIF') {
      const top = ifStack.at(-1);
      if (!top) {
        continue;
      }
      if (top.anyMatched || !top.parentActive) {
        top.active = false;
      } else {
        const matched = evaluateOps(row.slice(1), context.trueOps);
        top.active = matched;
        top.anyMatched = matched;
      }
      continue;
    }
    if (command === '#ELSE') {
      const top = ifStack.at(-1);
      if (!top) {
        continue;
      }
      top.active = !top.anyMatched && top.parentActive;
      top.anyMatched = true;
      continue;
    }
    if (command === '#ENDIF') {
      ifStack.pop();
      continue;
    }

    if (!isActive()) {
      continue;
    }

    if (command === '#ENDOFHEADER') {
      continue;
    }
    if (command === '#CUSTOMOPTION') {
      registerCustomOption(context, row);
      continue;
    }
    if (command === '#CUSTOMFILE') {
      registerCustomFile(context, sourceFiles, dirname(path), row);
      continue;
    }
    if (command === '#INFORMATION') {
      context.name = row[2] || context.name;
    } else if (command === '#RESOLUTION') {
      context.width = toNumber(row[1], context.width);
      context.height = toNumber(row[2], context.height);
    } else if (command === '#IMAGE') {
      const normalized = normalizeLr2Path(row[1] ?? '');
      const expanded = context.customFileLookup.get(normalized.toLowerCase()) ?? normalized;
      context.imagePaths.push(expanded);
    } else if (command === '#TRANSCOLOR') {
      const r = clampColorByte(toNumber(row[1], 0));
      const g = clampColorByte(toNumber(row[2], 0));
      const b = clampColorByte(toNumber(row[3], 0));
      context.transparentColor = { r, g, b };
    } else if (
      command === '#STARTINPUT' ||
      command === '#FADEOUT' ||
      command === '#CLOSE' ||
      command === '#LOADSTART' ||
      command === '#LOADEND' ||
      command === '#PLAYSTART' ||
      command === '#SKIP'
    ) {
      // Scene-timing directives — single ms argument. The renderer
      // anchors timer 1/2/3/40/41 off these offsets.
      const ms = Math.max(0, Math.trunc(toNumber(row[1], 0)));
      switch (command) {
        case '#STARTINPUT':
          context.timing.startInput = ms;
          break;
        case '#FADEOUT':
          context.timing.fadeOut = ms;
          break;
        case '#CLOSE':
          context.timing.close = ms;
          break;
        case '#LOADSTART':
          context.timing.loadStart = ms;
          break;
        case '#LOADEND':
          context.timing.loadEnd = ms;
          break;
        case '#PLAYSTART':
          context.timing.playStart = ms;
          break;
        case '#SKIP':
          context.timing.skip = ms;
          break;
      }
    } else if (command === '#SETOPTION') {
      // `#SETOPTION,opCode` — overrides a CUSTOMOPTION's default by
      // marking that op true at parse time. LR2 uses this to lock a
      // skin into a specific branch even when the user hasn't
      // selected the matching option (e.g. force the wide-lane layout
      // when the skin author wants it as the default).
      const op = Math.trunc(toNumber(row[1], 0));
      if (op > 0) {
        context.trueOps.add(op);
      } else if (op < 0) {
        context.trueOps.delete(-op);
      }
    } else if (command === '#SCRATCH') {
      // `#SCRATCH,1P,2P` — flag (0/1) per side for "has scratch lane".
      context.scratchFlip.scratch1P = Math.max(0, Math.trunc(toNumber(row[1], 0)));
      context.scratchFlip.scratch2P = Math.max(0, Math.trunc(toNumber(row[2], 0)));
    } else if (command === '#FLIPSIDE') {
      // Marker — the skin declares itself flippable.
      context.scratchFlip.flipSide = true;
    } else if (command === '#FLIPRESULT') {
      // Flip should persist into the result scene.
      context.scratchFlip.flipResult = true;
    } else if (command === '#DISABLEFLIP') {
      // Skin opts out of flip. Mutually exclusive with `#FLIPSIDE`,
      // but we honour whichever directive appears latest.
      context.scratchFlip.disableFlip = true;
    } else if (command === '#RELOADBANNER') {
      // Banner reloads on cursor move (BACKBMP / BANNER refresh).
      // We always reload anyway, so this just records the intent.
      context.scratchFlip.reloadBanner = true;
    } else if (command === '#INCLUDE') {
      const includePath = resolveIncludePath(sourceFiles, dirname(path), row[1] ?? '');
      if (includePath) {
        readLr2Path(sourceFiles, includePath, context, visited);
      }
    } else if (command === '#SRC_IMAGE') {
      context.imageSources.push(parseSource(row));
      context.imageDstGroups.push([]);
    } else if (command === '#DST_IMAGE') {
      const group = context.imageDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row);
      }
    } else if (command === '#SRC_NOWJUDGE_1P') {
      const id = toNumber(row[1], 0);
      if (context.nowJudge1PSources[id] === undefined) {
        context.nowJudge1PSources[id] = parseSource(row);
      }
    } else if (command === '#DST_NOWJUDGE_1P') {
      const id = toNumber(row[1], 0);
      const group = context.nowJudge1PDstGroups[id] ?? [];
      appendDestinationKeyframe(group, row);
      context.nowJudge1PDstGroups[id] = group;
    } else if (command === '#SRC_NUMBER') {
      context.numberSources.push({
        source: parseSource(row),
        num: toNumber(row[11], 0),
        alignment: parseNumberAlignment(row[12]),
        padding: Math.max(0, Math.trunc(toNumber(row[13], 0))),
      });
      context.numberDstGroups.push([]);
    } else if (command === '#DST_NUMBER') {
      const group = context.numberDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row);
      }
    } else if (command === '#SRC_GROOVEGAUGE') {
      context.grooveGaugeSources.push({
        source: parseSource(row),
        index: Math.max(0, Math.trunc(toNumber(row[1], 0))),
        addX: toNumber(row[11], 0),
        addY: toNumber(row[12], 0),
      });
      context.grooveGaugeDstGroups.push([]);
    } else if (command === '#DST_GROOVEGAUGE') {
      const group = context.grooveGaugeDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row);
      }
    } else if (command === '#SRC_NOWCOMBO_1P') {
      // #SRC_NOWCOMBO_1P,index,gr,x,y,w,h,divx,divy,cycle,timer,(null),align,keta
      context.nowComboSources.push({
        source: parseSource(row),
        index: Math.max(0, Math.trunc(toNumber(row[1], 0))),
        alignment: parseNowComboAlignment(row[12]),
        padding: Math.max(0, Math.trunc(toNumber(row[13], 0))),
      });
      context.nowComboDstGroups.push([]);
    } else if (command === '#DST_NOWCOMBO_1P') {
      const group = context.nowComboDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row);
      }
    } else if (command === '#SRC_JUDGELINE') {
      // #SRC_JUDGELINE,index,gr,x,y,w,h,divx,divy,cycle,timer,op1,op2,op3
      context.judgeLineSources.push({
        source: parseSource(row),
        index: Math.max(0, Math.trunc(toNumber(row[1], 0))),
      });
      context.judgeLineDstGroups.push([]);
    } else if (command === '#DST_JUDGELINE') {
      const group = context.judgeLineDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row);
      }
    } else if (command === '#SRC_LINE') {
      // #SRC_LINE,index,gr,x,y,w,h,divx,divy,cycle,timer,op1,op2,op3
      context.measureLineSources.push({
        source: parseSource(row),
        index: Math.max(0, Math.trunc(toNumber(row[1], 0))),
      });
      context.measureLineDstGroups.push([]);
    } else if (command === '#DST_LINE') {
      const group = context.measureLineDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row);
      }
    } else if (command === '#SRC_BGA') {
      // #SRC_BGA,(NULL),(NULL),…(unused),nobase,nolayer,nopoor
      // Columns 11/12/13 are the per-DST suppression flags; everything
      // before them is a placeholder kept for SRC-row format symmetry.
      context.bgaSources.push({
        noBase: toNumber(row[11], 0) === 1,
        noLayer: toNumber(row[12], 0) === 1,
        noPoor: toNumber(row[13], 0) === 1,
      });
      context.bgaDstGroups.push([]);
    } else if (command === '#DST_BGA') {
      const group = context.bgaDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row);
      }
    } else if (command === '#SRC_TEXT') {
      // #SRC_TEXT,(NULL),font,st,align,edit,panel
      context.textSources.push({
        font: Math.max(0, Math.trunc(toNumber(row[2], 0))),
        st: Math.max(0, Math.trunc(toNumber(row[3], 0))),
        alignment: parseTextAlignment(row[4]),
        edit: Math.max(0, Math.trunc(toNumber(row[5], 0))),
        // `panel` may legitimately be negative (-1 = "only when no
        // panel open") so we keep the sign.
        panel: Math.trunc(toNumber(row[6], 0)),
      });
      context.textDstGroups.push([]);
    } else if (command === '#DST_TEXT') {
      const group = context.textDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row);
      }
    } else if (command === '#SRC_BARGRAPH') {
      // #SRC_BARGRAPH,(NULL),gr,x,y,w,h,divx,divy,cycle,timer,type,muki
      context.bargraphSources.push({
        source: parseSource(row),
        type: Math.max(0, Math.trunc(toNumber(row[11], 0))),
        muki: parseBarGraphMuki(row[12]),
      });
      context.bargraphDstGroups.push([]);
    } else if (command === '#DST_BARGRAPH') {
      const group = context.bargraphDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row);
      }
    } else if (command === '#SRC_SLIDER') {
      // #SRC_SLIDER,(NULL),gr,x,y,w,h,divx,divy,cycle,timer,muki,range,type,disable
      context.sliderSources.push({
        source: parseSource(row),
        muki: parseSliderMuki(row[11]),
        range: Math.max(0, Math.trunc(toNumber(row[12], 0))),
        type: Math.max(0, Math.trunc(toNumber(row[13], 0))),
      });
      context.sliderDstGroups.push([]);
    } else if (command === '#DST_SLIDER') {
      const group = context.sliderDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row);
      }
    } else if (command === '#SRC_BUTTON') {
      // #SRC_BUTTON,(NULL),gr,x,y,w,h,divx,divy,cycle,timer,type,click,panel,plusonly
      // `plusonly` is optional in the LR2 spec — `toNumber(..., 0)` keeps
      // it at 0 (= both directions allowed) when the column is missing.
      context.buttonSources.push({
        source: parseSource(row),
        type: Math.max(0, Math.trunc(toNumber(row[11], 0))),
        click: Math.max(0, Math.trunc(toNumber(row[12], 0))),
        panel: Math.trunc(toNumber(row[13], 0)),
        plusOnly: Math.trunc(toNumber(row[14], 0)),
      });
      context.buttonDstGroups.push([]);
    } else if (command === '#DST_BUTTON') {
      const group = context.buttonDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row);
      }
    } else if (command === '#SRC_ONMOUSE') {
      // #SRC_ONMOUSE,(NULL),gr,x,y,w,h,divx,divy,cycle,timer,panel,x2,y2,w2,h2
      context.onMouseSources.push({
        source: parseSource(row),
        panel: Math.trunc(toNumber(row[11], 0)),
        hitOffsetX: Math.trunc(toNumber(row[12], 0)),
        hitOffsetY: Math.trunc(toNumber(row[13], 0)),
        hitWidth: Math.trunc(toNumber(row[14], 0)),
        hitHeight: Math.trunc(toNumber(row[15], 0)),
      });
      context.onMouseDstGroups.push([]);
    } else if (command === '#DST_ONMOUSE') {
      const group = context.onMouseDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row);
      }
    } else if (command === '#SRC_README') {
      // #SRC_README,(NULL),font,(NULL),(NULL),kankaku
      context.readmeSources.push({
        font: Math.max(0, Math.trunc(toNumber(row[2], 0))),
        lineSpacing: Math.max(0, Math.trunc(toNumber(row[5], 0))),
      });
      context.readmeDstGroups.push([]);
    } else if (command === '#DST_README') {
      const group = context.readmeDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row);
      }
    } else if (command === '#SRC_MOUSECURSOR') {
      // #SRC_MOUSECURSOR,(NULL),gr,x,y,w,h,divx,divy,cycle,timer
      context.mouseCursorSources.push(parseSource(row));
      context.mouseCursorDstGroups.push([]);
    } else if (command === '#DST_MOUSECURSOR') {
      const group = context.mouseCursorDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row);
      }
    } else if (command === '#SRC_BAR_FLASH') {
      // Spec only allows one — last wins. Used as the focused-bar
      // pulse / glow overlay; DST coordinates are relative to the
      // focused bar's `BAR_BODY_ON` rect.
      context.barFlashSource = parseSource(row);
    } else if (command === '#DST_BAR_FLASH') {
      appendDestinationKeyframe(context.barFlashDst, row);
    } else if (command === '#SRC_BAR_RIVAL') {
      // #SRC_BAR_RIVAL,index,gr,x,y,w,h,divx,divy,cycle,timer
      // index 0=WIN / 1=LOSE / 2=DRAW (3=NOT PLAYED is recommended
      // omitted by the spec; we accept it but don't model it).
      const kind = parseBarRivalKind(row[1]);
      if (kind) {
        const entry: BarRivalSourceEntry = { kind, source: parseSource(row) };
        const existingIndex = context.barRivalSources.findIndex((existing) => existing.kind === kind);
        if (existingIndex >= 0) {
          context.barRivalSources[existingIndex] = entry;
        } else {
          context.barRivalSources.push(entry);
        }
      }
    } else if (command === '#DST_BAR_RIVAL') {
      appendDestinationKeyframe(context.barRivalDst, row);
    } else if (command === '#SRC_BAR_MY_LAMP') {
      // Rival-mode self lamp. Same kind enum as `#SRC_BAR_LAMP`.
      const kind = parseBarLampKind(row[1]);
      if (kind) {
        const entry: BarLampSourceEntry = { kind, source: parseSource(row) };
        const existingIndex = context.barMyLampSources.findIndex((existing) => existing.kind === kind);
        if (existingIndex >= 0) {
          context.barMyLampSources[existingIndex] = entry;
        } else {
          context.barMyLampSources.push(entry);
        }
      }
    } else if (command === '#DST_BAR_MY_LAMP') {
      appendDestinationKeyframe(context.barMyLampDst, row);
    } else if (command === '#SRC_BAR_RIVAL_LAMP') {
      // Rival-mode opponent lamp. Same kind enum.
      const kind = parseBarLampKind(row[1]);
      if (kind) {
        const entry: BarLampSourceEntry = { kind, source: parseSource(row) };
        const existingIndex = context.barRivalLampSources.findIndex((existing) => existing.kind === kind);
        if (existingIndex >= 0) {
          context.barRivalLampSources[existingIndex] = entry;
        } else {
          context.barRivalLampSources.push(entry);
        }
      }
    } else if (command === '#DST_BAR_RIVAL_LAMP') {
      appendDestinationKeyframe(context.barRivalLampDst, row);
    } else if (command === '#SRC_BAR_BODY') {
      // #SRC_BAR_BODY,kind,gr,x,y,w,h,divx,divy,cycle,timer
      const kind = parseBarBodyKind(row[1]);
      if (kind) {
        // Last definition for a given kind wins, mirroring LR2's
        // "later #IF branch overrides earlier" convention.
        const existingIndex = context.barBodySources.findIndex((entry) => entry.kind === kind);
        const entry: BarBodySourceEntry = { kind, source: parseSource(row) };
        if (existingIndex >= 0) {
          context.barBodySources[existingIndex] = entry;
        } else {
          context.barBodySources.push(entry);
        }
      }
    } else if (command === '#DST_BAR_BODY_OFF') {
      const slot = Math.max(0, Math.trunc(toNumber(row[1], 0)));
      const group = context.barBodyOffDstGroups[slot] ?? [];
      appendDestinationKeyframe(group, row);
      context.barBodyOffDstGroups[slot] = group;
    } else if (command === '#DST_BAR_BODY_ON') {
      const slot = Math.max(0, Math.trunc(toNumber(row[1], 0)));
      const group = context.barBodyOnDstGroups[slot] ?? [];
      appendDestinationKeyframe(group, row);
      context.barBodyOnDstGroups[slot] = group;
    } else if (command === '#BAR_CENTER') {
      context.barCenter = Math.max(0, Math.trunc(toNumber(row[1], 0)));
    } else if (command === '#BAR_AVAILABLE') {
      context.barAvailable = Math.max(0, Math.trunc(toNumber(row[1], 0)));
    } else if (command === '#SRC_BAR_TITLE') {
      // #SRC_BAR_TITLE,(NULL),font,(NULL)... — only the font index is
      // meaningful; everything else is a placeholder kept for SRC-row
      // format symmetry with #SRC_TEXT.
      context.barTitleSource = { font: Math.max(0, Math.trunc(toNumber(row[2], 0))) };
    } else if (command === '#DST_BAR_TITLE') {
      appendDestinationKeyframe(context.barTitleDst, row);
    } else if (command === '#SRC_BAR_LEVEL') {
      // #SRC_BAR_LEVEL,index,gr,x,y,w,h,divx,divy,cycle,timer,(null),align,keta
      const kind = parseBarLevelKind(row[1]);
      if (kind) {
        const entry: BarLevelSourceEntry = {
          kind,
          source: parseSource(row),
          alignment: parseNumberAlignment(row[12]),
          padding: Math.max(0, Math.trunc(toNumber(row[13], 0))),
        };
        const existingIndex = context.barLevelSources.findIndex((existing) => existing.kind === kind);
        if (existingIndex >= 0) {
          context.barLevelSources[existingIndex] = entry;
        } else {
          context.barLevelSources.push(entry);
        }
      }
    } else if (command === '#DST_BAR_LEVEL') {
      appendDestinationKeyframe(context.barLevelDst, row);
    } else if (command === '#SRC_BAR_LAMP') {
      // #SRC_BAR_LAMP,index,gr,x,y,w,h,divx,divy,cycle,timer
      const kind = parseBarLampKind(row[1]);
      if (kind) {
        const entry: BarLampSourceEntry = { kind, source: parseSource(row) };
        const existingIndex = context.barLampSources.findIndex((existing) => existing.kind === kind);
        if (existingIndex >= 0) {
          context.barLampSources[existingIndex] = entry;
        } else {
          context.barLampSources.push(entry);
        }
      }
    } else if (command === '#DST_BAR_LAMP') {
      appendDestinationKeyframe(context.barLampDst, row);
    } else if (command === '#SRC_BAR_RANK') {
      // #SRC_BAR_RANK,index,gr,x,y,w,h,divx,divy,cycle,timer
      const kind = parseBarRankKind(row[1]);
      if (kind) {
        const entry: BarRankSourceEntry = { kind, source: parseSource(row) };
        const existingIndex = context.barRankSources.findIndex((existing) => existing.kind === kind);
        if (existingIndex >= 0) {
          context.barRankSources[existingIndex] = entry;
        } else {
          context.barRankSources.push(entry);
        }
      }
    } else if (command === '#DST_BAR_RANK') {
      appendDestinationKeyframe(context.barRankDst, row);
    } else if (command in NOTE_COMMANDS) {
      const kind = NOTE_COMMANDS[command]!;
      const lane = toNumber(row[1], 0);
      const sources = context.noteSources.get(kind) ?? [];
      sources[lane] = parseSource(row);
      context.noteSources.set(kind, sources);
    } else if (command === '#DST_NOTE') {
      const lane = toNumber(row[1], 0);
      context.laneRects[lane] = parseDestination(row);
    }
  }
}

function registerCustomOption(context: ParseContext, row: string[]): void {
  const name = (row[1] ?? '').trim();
  const defaultOp = toNumber(row[2], 0);
  const labels = row.slice(3).filter((value) => value.length > 0);
  if (!name || defaultOp <= 0 || labels.length === 0) {
    return;
  }
  context.customOptions.push({ name, defaultOp, numChoices: labels.length });
  context.trueOps.add(defaultOp);
}

function registerCustomFile(
  context: ParseContext,
  sourceFiles: ReadonlyMap<string, Uint8Array>,
  baseDirectory: string,
  row: string[],
): void {
  const name = (row[1] ?? '').trim();
  const pattern = (row[2] ?? '').trim();
  const defaultName = (row[3] ?? '').trim();
  if (!name || !pattern || !defaultName) {
    return;
  }
  const expanded = pattern.replaceAll('*', defaultName);
  const resolvedPath = resolveIncludePath(sourceFiles, baseDirectory, expanded);
  if (resolvedPath) {
    context.customFiles.push({ name, path: resolvedPath });
    context.customFileLookup.set(normalizeLr2Path(pattern).toLowerCase(), resolvedPath);
  }
}

/**
 * Sentinel paths used in `Lr2ImageRect.imagePath` for LR2's runtime-bound
 * textures (`#SRC_IMAGE,gr=...`):
 *
 *   100 → STAGEFILE / 101 → BACKBMP / 102 → BANNER /
 *   105 → skin-select thumbnail / 110 → solid black / 111 → solid white.
 *
 * Renderers detect these paths and substitute the appropriate live
 * texture (e.g. the focused song's banner) instead of looking the path
 * up in the bundled `#IMAGE` map.
 */
export const LR2_SPECIAL_GRAPHIC = {
  STAGEFILE: '__lr2_special:stagefile',
  BACKBMP: '__lr2_special:backbmp',
  BANNER: '__lr2_special:banner',
  SKIN_THUMBNAIL: '__lr2_special:skin_thumbnail',
  BLACK: '__lr2_special:black',
  WHITE: '__lr2_special:white',
} as const;

export type Lr2SpecialGraphic = (typeof LR2_SPECIAL_GRAPHIC)[keyof typeof LR2_SPECIAL_GRAPHIC];

export function isLr2SpecialGraphic(path: string): path is Lr2SpecialGraphic {
  return (
    path === LR2_SPECIAL_GRAPHIC.STAGEFILE ||
    path === LR2_SPECIAL_GRAPHIC.BACKBMP ||
    path === LR2_SPECIAL_GRAPHIC.BANNER ||
    path === LR2_SPECIAL_GRAPHIC.SKIN_THUMBNAIL ||
    path === LR2_SPECIAL_GRAPHIC.BLACK ||
    path === LR2_SPECIAL_GRAPHIC.WHITE
  );
}

function specialGraphicPath(gr: number): Lr2SpecialGraphic | undefined {
  switch (gr) {
    case 100:
      return LR2_SPECIAL_GRAPHIC.STAGEFILE;
    case 101:
      return LR2_SPECIAL_GRAPHIC.BACKBMP;
    case 102:
      return LR2_SPECIAL_GRAPHIC.BANNER;
    case 105:
      return LR2_SPECIAL_GRAPHIC.SKIN_THUMBNAIL;
    case 110:
      return LR2_SPECIAL_GRAPHIC.BLACK;
    case 111:
      return LR2_SPECIAL_GRAPHIC.WHITE;
    default:
      return undefined;
  }
}

/**
 * Static ops that are conventionally true at parse time so that `#IF` /
 * `#ELSEIF` chains in the LR2 default skins resolve to a sensible default
 * branch. The runtime renderer overrides specific values (key mode, autoplay,
 * etc.) at play time, but they need to be true HERE so the parser doesn't
 * silently drop entire `#INCLUDE` chains gated on them.
 *
 * Notably 160 (7keys mode) and 32 (autoplay off) are included — without them,
 * an `#IF,160` / `#IF,32` block in any included CSV would skip the branch
 * even though the runtime would later mark those ops true.
 */
function defaultParseOps(): Set<number> {
  return new Set<number>([
    5, // selected bar is playable
    32, // autoplay off (default branch)
    34, // ghost off
    38, // scoregraph off
    40, // BGA off
    42, // 1P normal gauge
    44, // 2P normal gauge
    47, // difficulty filter disabled
    50, // offline
    54, // autolane 2P off
    56, // autoscratch 2P off
    61, // score saveable
    81, // load complete
    82, // replay off
    160, // 7keys (default key mode for play_7.lr2skin)
    170, // BGA absent
    172, // long notes absent
    174, // attached text absent
    176, // BPM change absent
    178, // RANDOM absent
    182, // judge normal
    // 190..195 — skins typically gate the STAGEFILE / BANNER /
    // BACKBMP display block on the "present" op, so we mark those
    // true at parse time even though the chart-level state is
    // unknown until runtime. Without 191/193/195 the load-screen
    // branch never gets included by `#IF`, so the runtime renderer
    // wouldn't have the SRC/DST entries to draw at all.
    191, // STAGEFILE present (per LR2 spec — the comment in the
    //   previous revision said "absent", which was wrong: 190 is
    //   absent, 191 is present)
    193, // BANNER present
    195, // BACKBMP present
    196, // replay absent
  ]);
}

function evaluateOps(values: string[], trueOps: ReadonlySet<number>): boolean {
  for (const value of values) {
    const op = toNumber(value, 0);
    if (op === 0) {
      continue;
    }
    if (op > 0) {
      if (!trueOps.has(op)) {
        return false;
      }
    } else if (trueOps.has(-op)) {
      return false;
    }
  }
  return true;
}

function parseSource(row: string[]): SourceRect {
  return {
    gr: toNumber(row[2], 0),
    x: toNumber(row[3], 0),
    y: toNumber(row[4], 0),
    w: toNumber(row[5], 0),
    h: toNumber(row[6], 0),
    // LR2 frequently sets divx/divy=0 to mean "treat as 1" (single cell).
    divx: Math.max(1, Math.trunc(toNumber(row[7], 1)) || 1),
    divy: Math.max(1, Math.trunc(toNumber(row[8], 1)) || 1),
    cycle: Math.max(0, Math.trunc(toNumber(row[9], 0))),
    timer: Math.max(0, Math.trunc(toNumber(row[10], 0))),
  };
}

function parseDestination(row: string[]): Lr2DestinationRect {
  // #DST_*,(NULL),time,x,y,w,h,acc,a,r,g,b,blend,filter,angle,center,loop,timer,op1,op2,op3
  // row index:    0         1   2 3 4 5 6   7 8 9  10 11    12     13    14     15  16    17  18  19  20
  // (row[0] is the command itself when split by parseRow.)
  const ops = [toNumber(row[18], 0), toNumber(row[19], 0), toNumber(row[20], 0)].filter(
    (op) => Number.isFinite(op) && op !== 0,
  );
  // LR2 keyframes commonly leave the trailing fields blank past the first row
  // (e.g. `#DST_IMAGE,0,1500,...,,,,,`). An empty field for `timer` should be
  // treated as "inherit from the previous keyframe", not as `timer=0` -- this
  // is what kept things like the "STAGE FAILED" plate (timer=3 on the first
  // keyframe) drawing during gameplay. Use -1 here as a sentinel and let the
  // DST-list builder resolve the inheritance.
  const timerRaw = row[17];
  const timerProvided = typeof timerRaw === 'string' && timerRaw.trim() !== '';
  const timer = timerProvided ? Math.max(0, Math.trunc(toNumber(timerRaw, 0))) : -1;
  return {
    time: Math.max(0, toNumber(row[2], 0)),
    x: toNumber(row[3], 0),
    y: toNumber(row[4], 0),
    w: toNumber(row[5], 0),
    h: toNumber(row[6], 0),
    acc: Math.max(0, Math.min(3, Math.trunc(toNumber(row[7], 0)))),
    alpha: Math.max(0, Math.min(1, toNumber(row[8], 255) / 255)),
    r: clampColorByte(toNumber(row[9], 255)),
    g: clampColorByte(toNumber(row[10], 255)),
    b: clampColorByte(toNumber(row[11], 255)),
    blend: Math.max(0, Math.trunc(toNumber(row[12], 0))),
    filter: Math.max(0, Math.trunc(toNumber(row[13], 0))),
    angle: toNumber(row[14], 0),
    center: Math.max(0, Math.trunc(toNumber(row[15], 0))),
    loop: toNumber(row[16], 0),
    timer,
    ops,
    op4: Math.trunc(toNumber(row[21], 0)),
  };
}

/**
 * Push a freshly-parsed `#DST_*` row into a keyframe group, inheriting the
 * `timer`, `loop`, and `ops` values from the previous keyframe when they were
 * omitted on the trailing row.
 *
 * Per the LR2 spec, a chain like
 *   `#DST_IMAGE,0,400,...,1000,0,161,0,0`
 *   `#DST_IMAGE,0,1000,...,,,,,`
 * is read as "second keyframe inherits everything that was blank from the
 * first." Without inheritance, the second keyframe would silently default to
 * `timer=0, loop=0, ops=[]`, which made gated overlays (5keys lane cover
 * with op=161, autoscratch lane cover with op=55, …) leak in unrelated
 * modes. The destination check uses the *final* keyframe, so its `ops` MUST
 * carry the gate forward.
 */
function appendDestinationKeyframe(group: Lr2DestinationRect[], row: string[]): void {
  const dst = parseDestination(row);
  const previous = group[group.length - 1];
  if (dst.timer === -1) {
    dst.timer = previous?.timer ?? 0;
  }
  if (previous) {
    // `loop`, `acc`, and the trailing op fields are blank-inherited
    // the same way: a row that only specifies `time,x,y,w,h,...` keeps
    // the original easing / loop gate / op gate.
    if (isBlank(row[16])) {
      dst.loop = previous.loop;
    }
    if (isBlank(row[7])) {
      dst.acc = previous.acc;
    }
    if (isBlank(row[18]) && isBlank(row[19]) && isBlank(row[20])) {
      dst.ops = previous.ops;
    }
  }
  group.push(dst);
}

function isBlank(value: string | undefined): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

function createNumberElements(context: ParseContext): Lr2NumberElement[] {
  const elements: Lr2NumberElement[] = [];
  for (let index = 0; index < context.numberSources.length; index += 1) {
    const entry = context.numberSources[index]!;
    const dstGroup = context.numberDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: {
        imagePath,
        x: entry.source.x,
        y: entry.source.y,
        w: entry.source.w,
        h: entry.source.h,
        divx: entry.source.divx,
        divy: entry.source.divy,
        cycle: entry.source.cycle,
        timer: entry.source.timer,
        num: entry.num,
        alignment: entry.alignment,
        padding: entry.padding,
      },
      destination,
      keyframes: [...dstGroup],
    });
  }
  return elements;
}

function createNowComboElements(context: ParseContext): Lr2NowComboElement[] {
  const elements: Lr2NowComboElement[] = [];
  for (let index = 0; index < context.nowComboSources.length; index += 1) {
    const entry = context.nowComboSources[index]!;
    const dstGroup = context.nowComboDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const kind = NOW_COMBO_1P_KIND_BY_INDEX.get(entry.index);
    if (!kind) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: {
        imagePath,
        x: entry.source.x,
        y: entry.source.y,
        w: entry.source.w,
        h: entry.source.h,
        divx: entry.source.divx,
        divy: entry.source.divy,
        cycle: entry.source.cycle,
        timer: entry.source.timer,
        alignment: entry.alignment,
        padding: entry.padding,
      },
      destination,
      keyframes: [...dstGroup],
      kind,
    });
  }
  return elements;
}

function createJudgeLineElements(context: ParseContext): Lr2JudgeLineElement[] {
  const elements: Lr2JudgeLineElement[] = [];
  for (let index = 0; index < context.judgeLineSources.length; index += 1) {
    const entry = context.judgeLineSources[index]!;
    const dstGroup = context.judgeLineDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: { ...entry.source, imagePath },
      destination,
      keyframes: [...dstGroup],
      index: entry.index,
    });
  }
  return elements;
}

function createMeasureLineElements(context: ParseContext): Lr2MeasureLineElement[] {
  const elements: Lr2MeasureLineElement[] = [];
  for (let index = 0; index < context.measureLineSources.length; index += 1) {
    const entry = context.measureLineSources[index]!;
    const dstGroup = context.measureLineDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: { ...entry.source, imagePath },
      destination,
      keyframes: [...dstGroup],
      index: entry.index,
    });
  }
  return elements;
}

function createBgaElements(context: ParseContext): Lr2BgaElement[] {
  const elements: Lr2BgaElement[] = [];
  for (let index = 0; index < context.bgaSources.length; index += 1) {
    const entry = context.bgaSources[index]!;
    const dstGroup = context.bgaDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      destination,
      keyframes: [...dstGroup],
      noBase: entry.noBase,
      noLayer: entry.noLayer,
      noPoor: entry.noPoor,
    });
  }
  return elements;
}

function createGrooveGaugeElements(context: ParseContext): Lr2GrooveGaugeElement[] {
  const elements: Lr2GrooveGaugeElement[] = [];
  for (let index = 0; index < context.grooveGaugeSources.length; index += 1) {
    const entry = context.grooveGaugeSources[index]!;
    const dstGroup = context.grooveGaugeDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: { ...entry.source, imagePath },
      destination,
      keyframes: [...dstGroup],
      index: entry.index,
      addX: entry.addX,
      addY: entry.addY,
    });
  }
  return elements;
}

function parseNumberAlignment(value: string | undefined): Lr2NumberAlignment {
  switch (toNumber(value, 0)) {
    case 1:
      return 'left';
    case 2:
      return 'center';
    default:
      return 'right';
  }
}

// LR2 NOWCOMBO_1P alignment. The spec says 0=left/1=center/2=right but
// matching the LR2 reference video visually requires NUMBER's encoding
// (0=right, 1=left, 2=center) — for the LR2 default 7-keys skin (`align=1`)
// the combo digits sit IMMEDIATELY to the right of the judgement plate
// (left-aligned at the relative x), not centred on it.
function parseNowComboAlignment(value: string | undefined): Lr2NumberAlignment {
  switch (toNumber(value, 0)) {
    case 1:
      return 'left';
    case 2:
      return 'center';
    default:
      return 'right';
  }
}

/** LR2 SRC_TEXT alignment: 0=left, 1=center, 2=right. */
function parseTextAlignment(value: string | undefined): Lr2TextAlignment {
  switch (toNumber(value, 0)) {
    case 1:
      return 'center';
    case 2:
      return 'right';
    default:
      return 'left';
  }
}

/** LR2 SRC_BARGRAPH `muki`: 0=horizontal, 1=vertical. */
function parseBarGraphMuki(value: string | undefined): Lr2BarGraphMuki {
  return toNumber(value, 0) === 1 ? 'vertical' : 'horizontal';
}

/**
 * LR2 SRC_SLIDER `muki`: empirically derived from the LR2 default 7-keys
 * skin's song-progress slider (`#SRC_SLIDER,…,muki=2,range=278,type=6`)
 * and the verified behaviour that the indicator travels top → bottom over
 * 278 px starting at y=15. So muki=2 ⇒ "down" — vertical, growing
 * downward.
 *
 * 0=right (horizontal default), 1=left, 2=down, 3=up.
 */
function parseSliderMuki(value: string | undefined): Lr2SliderMuki {
  switch (toNumber(value, 0)) {
    case 1:
      return 'left';
    case 2:
      return 'down';
    case 3:
      return 'up';
    default:
      return 'right';
  }
}

function createTextElements(context: ParseContext): Lr2TextElement[] {
  const elements: Lr2TextElement[] = [];
  for (let index = 0; index < context.textSources.length; index += 1) {
    const entry = context.textSources[index]!;
    const dstGroup = context.textDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      font: entry.font,
      st: entry.st,
      alignment: entry.alignment,
      edit: entry.edit,
      panel: entry.panel,
      destination,
      keyframes: [...dstGroup],
    });
  }
  return elements;
}

function createBarGraphElements(context: ParseContext): Lr2BarGraphElement[] {
  const elements: Lr2BarGraphElement[] = [];
  for (let index = 0; index < context.bargraphSources.length; index += 1) {
    const entry = context.bargraphSources[index]!;
    const dstGroup = context.bargraphDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: { ...entry.source, imagePath },
      destination,
      keyframes: [...dstGroup],
      type: entry.type,
      muki: entry.muki,
    });
  }
  return elements;
}

function parseBarBodyKind(value: string | undefined): Lr2BarBodyKind | undefined {
  switch (Math.trunc(toNumber(value, -1))) {
    case 0:
      return 'song';
    case 1:
      return 'folder';
    case 2:
      return 'customFolder';
    case 3:
      return 'newSongFolder';
    case 4:
      return 'rivalFolder';
    case 5:
      return 'rivalSong';
    case 6:
      return 'courseFolder';
    case 7:
      return 'courseCreate';
    case 8:
      return 'course';
    case 9:
      return 'randomCourse';
    default:
      return undefined;
  }
}

function createBarLayout(context: ParseContext): Lr2BarLayout {
  const bodies: Lr2BarBodySource[] = context.barBodySources.flatMap((entry) => {
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      return [];
    }
    return [{ kind: entry.kind, source: { ...entry.source, imagePath } }];
  });

  const slotCount = Math.max(context.barBodyOffDstGroups.length, context.barBodyOnDstGroups.length);
  const slots: Lr2BarBodySlot[] = [];
  for (let index = 0; index < slotCount; index += 1) {
    const offGroup = context.barBodyOffDstGroups[index];
    const onGroup = context.barBodyOnDstGroups[index];
    if ((!offGroup || offGroup.length === 0) && (!onGroup || onGroup.length === 0)) {
      continue;
    }
    slots.push({
      index,
      off: offGroup && offGroup.length > 0 ? offGroup[offGroup.length - 1] : undefined,
      offKeyframes: offGroup ? [...offGroup] : [],
      on: onGroup && onGroup.length > 0 ? onGroup[onGroup.length - 1] : undefined,
      onKeyframes: onGroup ? [...onGroup] : [],
    });
  }

  let title: Lr2BarTitleElement | undefined;
  if (context.barTitleSource && context.barTitleDst.length > 0) {
    const dstGroup = context.barTitleDst;
    title = {
      font: context.barTitleSource.font,
      destination: dstGroup[dstGroup.length - 1]!,
      keyframes: [...dstGroup],
    };
  }

  // BAR_LEVEL: keep the alignment / padding from each per-difficulty
  // entry so the renderer can use `renderNumberElement` directly.
  const levels: Lr2BarLevelSource[] = context.barLevelSources.flatMap((entry) => {
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      return [];
    }
    const numberSource: Lr2NumberSourceRect = {
      ...entry.source,
      imagePath,
      num: 0, // unused — BAR_LEVEL pulls its value from the song, not the LR2 num field
      alignment: entry.alignment,
      padding: entry.padding,
    };
    return [{ kind: entry.kind, source: numberSource }];
  });

  const lamps: Lr2BarLampSource[] = context.barLampSources.flatMap((entry) => {
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      return [];
    }
    return [{ kind: entry.kind, source: { ...entry.source, imagePath } }];
  });

  const ranks: Lr2BarRankSource[] = context.barRankSources.flatMap((entry) => {
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      return [];
    }
    return [{ kind: entry.kind, source: { ...entry.source, imagePath } }];
  });

  const levelDestination = context.barLevelDst.at(-1);
  const lampDestination = context.barLampDst.at(-1);
  const rankDestination = context.barRankDst.at(-1);

  // BAR_FLASH — focused-bar overlay. Spec only allows one, so we
  // pick the latest source / DST chain and resolve its image path.
  let flash: Lr2BarFlashElement | undefined;
  if (context.barFlashSource && context.barFlashDst.length > 0) {
    const imagePath = context.imagePaths[context.barFlashSource.gr];
    if (imagePath) {
      const dstGroup = context.barFlashDst;
      flash = {
        source: { ...context.barFlashSource, imagePath },
        destination: dstGroup[dstGroup.length - 1]!,
        keyframes: [...dstGroup],
      };
    }
  }

  // BAR_RIVAL — rival-mode WIN/LOSE/DRAW per-bar overlay.
  const rivalIndicators: Lr2BarRivalSource[] = context.barRivalSources.flatMap((entry) => {
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      return [];
    }
    return [{ kind: entry.kind, source: { ...entry.source, imagePath } }];
  });
  const rivalDestination = context.barRivalDst.at(-1);

  // BAR_MY_LAMP / BAR_RIVAL_LAMP — rival-folder lamp variants.
  const myLamps: Lr2BarLampSource[] = context.barMyLampSources.flatMap((entry) => {
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) return [];
    return [{ kind: entry.kind, source: { ...entry.source, imagePath } }];
  });
  const rivalLampSprites: Lr2BarLampSource[] = context.barRivalLampSources.flatMap((entry) => {
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) return [];
    return [{ kind: entry.kind, source: { ...entry.source, imagePath } }];
  });

  return {
    bodies,
    slots,
    center: context.barCenter,
    available: context.barAvailable,
    title,
    levels,
    levelDestination,
    levelKeyframes: [...context.barLevelDst],
    lamps,
    lampDestination,
    lampKeyframes: [...context.barLampDst],
    ranks,
    rankDestination,
    rankKeyframes: [...context.barRankDst],
    flash,
    rivalIndicators,
    rivalDestination,
    rivalKeyframes: [...context.barRivalDst],
    rivalLamps: {
      myLamps,
      myLampDestination: context.barMyLampDst.at(-1),
      myLampKeyframes: [...context.barMyLampDst],
      rivalLamps: rivalLampSprites,
      rivalLampDestination: context.barRivalLampDst.at(-1),
      rivalLampKeyframes: [...context.barRivalLampDst],
    },
  };
}

function parseBarLevelKind(value: string | undefined): Lr2BarLevelKind | undefined {
  switch (Math.trunc(toNumber(value, -1))) {
    case 0:
      return 'undefined';
    case 1:
      return 'beginner';
    case 2:
      return 'normal';
    case 3:
      return 'hyper';
    case 4:
      return 'another';
    case 5:
      return 'insane';
    case 6:
      return 'irRanking';
    default:
      return undefined;
  }
}

function parseBarLampKind(value: string | undefined): Lr2BarLampKind | undefined {
  switch (Math.trunc(toNumber(value, -1))) {
    case 0:
      return 'noplay';
    case 1:
      return 'failed';
    case 2:
      return 'easy';
    case 3:
      return 'clear';
    case 4:
      return 'hard';
    case 5:
      return 'fullcombo';
    default:
      return undefined;
  }
}

function parseBarRankKind(value: string | undefined): Lr2BarRankKind | undefined {
  switch (Math.trunc(toNumber(value, -1))) {
    case 0:
      return 'noplay';
    case 1:
      return 'F';
    case 2:
      return 'E';
    case 3:
      return 'D';
    case 4:
      return 'C';
    case 5:
      return 'B';
    case 6:
      return 'A';
    case 7:
      return 'AA';
    case 8:
      return 'AAA';
    default:
      return undefined;
  }
}

function parseBarRivalKind(value: string | undefined): Lr2BarRivalKind | undefined {
  switch (Math.trunc(toNumber(value, -1))) {
    case 0:
      return 'win';
    case 1:
      return 'lose';
    case 2:
      return 'draw';
    default:
      return undefined;
  }
}

function createSliderElements(context: ParseContext): Lr2SliderElement[] {
  const elements: Lr2SliderElement[] = [];
  for (let index = 0; index < context.sliderSources.length; index += 1) {
    const entry = context.sliderSources[index]!;
    const dstGroup = context.sliderDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: { ...entry.source, imagePath },
      destination,
      keyframes: [...dstGroup],
      type: entry.type,
      muki: entry.muki,
      range: entry.range,
    });
  }
  return elements;
}

function createButtonElements(context: ParseContext): Lr2ButtonElement[] {
  const elements: Lr2ButtonElement[] = [];
  for (let index = 0; index < context.buttonSources.length; index += 1) {
    const entry = context.buttonSources[index]!;
    const dstGroup = context.buttonDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: { ...entry.source, imagePath },
      destination,
      keyframes: [...dstGroup],
      type: entry.type,
      click: entry.click,
      panel: entry.panel,
      plusOnly: entry.plusOnly,
    });
  }
  return elements;
}

function createOnMouseElements(context: ParseContext): Lr2OnMouseElement[] {
  const elements: Lr2OnMouseElement[] = [];
  for (let index = 0; index < context.onMouseSources.length; index += 1) {
    const entry = context.onMouseSources[index]!;
    const dstGroup = context.onMouseDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: { ...entry.source, imagePath },
      destination,
      keyframes: [...dstGroup],
      panel: entry.panel,
      hitOffsetX: entry.hitOffsetX,
      hitOffsetY: entry.hitOffsetY,
      hitWidth: entry.hitWidth,
      hitHeight: entry.hitHeight,
    });
  }
  return elements;
}

function createReadmeElements(context: ParseContext): Lr2ReadmeElement[] {
  const elements: Lr2ReadmeElement[] = [];
  for (let index = 0; index < context.readmeSources.length; index += 1) {
    const entry = context.readmeSources[index]!;
    const dstGroup = context.readmeDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      font: entry.font,
      lineSpacing: entry.lineSpacing,
      destination,
      keyframes: [...dstGroup],
    });
  }
  return elements;
}

function createMouseCursorElements(context: ParseContext): Lr2MouseCursorElement[] {
  const elements: Lr2MouseCursorElement[] = [];
  for (let index = 0; index < context.mouseCursorSources.length; index += 1) {
    const source = context.mouseCursorSources[index]!;
    const dstGroup = context.mouseCursorDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: { ...source, imagePath },
      destination,
      keyframes: [...dstGroup],
    });
  }
  return elements;
}

function createJudgeElements(context: ParseContext): Lr2Skin['judges'] {
  const judges: Lr2Skin['judges'] = {};
  for (const [id, kind] of NOW_JUDGE_1P_KIND_BY_INDEX) {
    const source = context.nowJudge1PSources[id];
    const dstGroup = context.nowJudge1PDstGroups[id];
    const imagePath = source ? context.imagePaths[source.gr] : undefined;
    if (!source || !dstGroup || dstGroup.length === 0 || !imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    // 0 (early POOR) and 1 (regular POOR) both map to 'poor'; the second one
    // wins by virtue of being processed later.
    // Keep the FULL source rect (w/h spanning all divx*divy cells) so the
    // renderer can cycle frames at runtime per `cycle`.
    judges[kind] = [
      {
        source: {
          imagePath,
          x: source.x,
          y: source.y,
          w: source.w,
          h: source.h,
          divx: source.divx,
          divy: source.divy,
          cycle: source.cycle,
          timer: source.timer,
        },
        destination,
        keyframes: [...dstGroup],
      },
    ];
  }
  return judges;
}

function resolveIncludePath(
  sourceFiles: ReadonlyMap<string, Uint8Array>,
  baseDirectory: string,
  rawPath: string,
): string | undefined {
  const normalized = normalizeLr2Path(rawPath);
  const fileName = basename(normalized).toLowerCase();
  const parentDir = dirname(normalized);
  const parentName = basename(parentDir).toLowerCase();
  const grandParent = basename(dirname(parentDir)).toLowerCase();
  const candidates = [
    normalizePath(`${baseDirectory}/${normalized}`),
    normalized,
    normalizePath(`${baseDirectory}/${basename(normalized)}`),
  ];
  const exact = candidates.find((candidate) => sourceFiles.has(candidate));
  if (exact) {
    return exact;
  }
  // Match progressively shorter trailing path segments. Trying the deeper
  // suffix first prevents `Play_half/frame/...` from being selected when the
  // request is for `Play/frame/...`.
  if (grandParent && parentName) {
    const withGrandparent = [...sourceFiles.keys()].find((path) =>
      path.toLowerCase().endsWith(`/${grandParent}/${parentName}/${fileName}`),
    );
    if (withGrandparent) {
      return withGrandparent;
    }
  }
  if (parentName) {
    const withParent = [...sourceFiles.keys()].find((path) =>
      path.toLowerCase().endsWith(`/${parentName}/${fileName}`),
    );
    if (withParent) {
      return withParent;
    }
  }
  return [...sourceFiles.keys()].find(
    (path) => path.toLowerCase().endsWith(`/${fileName}`) || path.toLowerCase() === fileName,
  );
}

export function resolveLr2AssetBytes(skin: Lr2Skin, rawPath: string): Uint8Array | undefined {
  const normalized = normalizeLr2Path(rawPath);
  const candidates = [normalized, basename(normalized)];
  for (const candidate of candidates) {
    const bytes = skin.files.get(candidate);
    if (bytes) {
      return bytes;
    }
  }
  const fileNamePattern = wildcardToRegExp(basename(normalized));
  const parentDir = dirname(normalized);
  const parentName = basename(parentDir).toLowerCase();
  const grandParent = basename(dirname(parentDir)).toLowerCase();
  if (grandParent && parentName) {
    const matchWithGrand = [...skin.files.keys()].find((path) => {
      const lower = path.toLowerCase();
      const segments = lower.split('/');
      const baseNameLower = segments.at(-1) ?? '';
      const parentLower = segments.at(-2) ?? '';
      const grandLower = segments.at(-3) ?? '';
      return grandLower === grandParent && parentLower === parentName && fileNamePattern.test(baseNameLower);
    });
    if (matchWithGrand) {
      return skin.files.get(matchWithGrand);
    }
  }
  if (parentName) {
    const matchWithParent = [...skin.files.keys()].find((path) => {
      const lower = path.toLowerCase();
      return basename(dirname(lower)) === parentName && fileNamePattern.test(basename(path));
    });
    if (matchWithParent) {
      return skin.files.get(matchWithParent);
    }
  }
  const match = [...skin.files.keys()].find((path) => fileNamePattern.test(basename(path)));
  return match ? skin.files.get(match) : undefined;
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`, 'iu');
}

function parseRows(text: string): string[][] {
  return text
    .split(/\r?\n/u)
    .map((line) => parseRow(stripComment(line).trim()))
    .filter((row) => row.length > 0 && row[0]?.startsWith('#'));
}

function parseRow(line: string): string[] {
  if (!line) {
    return [];
  }
  const delimiter = line.includes('\t') ? '\t' : ',';
  return line.split(delimiter).map((value) => value.trim().replace(/^["']|["']$/gu, ''));
}

function stripComment(line: string): string {
  const index = line.indexOf('//');
  return index >= 0 ? line.slice(0, index) : line;
}

function normalizeLr2Path(path: string): string {
  return normalizePath(path.replace(/^\.\\?/u, ''));
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('shift_jis').decode(bytes).replace(/^\ufeff/u, '');
}

function toNumber(value: string | undefined, fallback: number): number {
  const number = Number.parseFloat(value ?? '');
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Returns `true` when the path looks like an `.lr2skin` of the given
 * kind. Matches the LR2 default theme's directory layout (`/Play/...`,
 * `/Select/...`) AND the conventional filenames (`play_7.lr2skin`,
 * `select.lr2skin`).
 */
function isSkinPathOfKind(path: string, kind: Lr2SkinKind): boolean {
  const lower = path.toLowerCase();
  if (kind === 'play') {
    return lower.includes('/play') || lower.includes('\\play');
  }
  return lower.includes('/select') || lower.includes('\\select');
}

function scoreSkinPath(path: string, kind: Lr2SkinKind, variant?: Lr2PlayVariant): number {
  const lower = path.toLowerCase();
  if (kind === 'select') {
    // The LR2 default theme ships a single `select.lr2skin`, but other
    // themes occasionally bundle variants (`select_7.lr2skin`, etc.).
    // Plain `select.lr2skin` wins; anything inside a `/Select/` folder
    // ranks next; everything else is last.
    if (lower.endsWith('/select.lr2skin')) {
      return 0;
    }
    if (lower.includes('/select') && lower.endsWith('.lr2skin')) {
      return 10;
    }
    return 100;
  }
  // When the caller supplies a variant hint, the matching
  // `play_<variant>.lr2skin` wins outright. Other play variants
  // still score (so the loader can fall back if the requested
  // variant isn't bundled), just at a lower priority than the
  // hinted one.
  if (variant && lower.endsWith(`/play_${variant}.lr2skin`)) {
    return -1;
  }
  if (lower.endsWith('/play_7.lr2skin')) {
    return 0;
  }
  if (lower.endsWith('/play_5.lr2skin')) {
    return 1;
  }
  if (lower.endsWith('/play_9.lr2skin')) {
    return 2;
  }
  if (lower.endsWith('/play_10.lr2skin')) {
    return 3;
  }
  if (lower.endsWith('/play_14.lr2skin')) {
    return 4;
  }
  if (lower.includes('/play_') && !lower.includes('play_half')) {
    return 30;
  }
  if (lower.includes('play_half')) {
    return 50;
  }
  return 100;
}

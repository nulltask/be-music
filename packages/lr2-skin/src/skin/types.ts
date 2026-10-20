import type { LR2SkinFileEntry } from '../file-lookup.ts';

export interface LR2ImageRect {
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
   * Source-side timer reference. The cycle counter is anchored at the moment this timer started so animations are
   * deterministic per skin convention. 0 = scene start.
   */
  timer: number;
}

export interface LR2DestinationRect {
  /**
   * Keyframe time in milliseconds since the source `timer` started counting. The renderer interpolates between
   * consecutive keyframes by `time`.
   */
  time: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Easing applied to the segment **into** this keyframe (LR2 spec):
   *
   * 0 = constant (linear) / 1 = accelerate (ease-in) / 2 = decelerate (ease-out) / 3 = discontinuous (snap).
   */
  acc: number;
  /** 0..1 normalized from LR2's 0..255 alpha. */
  alpha: number;
  /** 0..255 color tint. 255 means no tint (LR2 only allows reducing channels). */
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
   * Optional fourth column past the standard op slots. The LR2 default 7-keys skin uses `op4=1` on the scratch
   * turntable's `#DST_IMAGE` to mean "spin this sprite at the scratch rate". Most other elements leave it 0.
   */
  op4: number;
}

export interface LR2ImageElement {
  source: LR2ImageRect;
  /**
   * Final keyframe of the destination animation. Convenient for static elements; for animation, prefer `keyframes`
   * which exposes the full sequence including intermediate `time` markers.
   */
  destination: LR2DestinationRect;
  /**
   * Full set of `#DST_*` keyframes in time-order. Use these together with `LR2DestinationRect.loop` and `time` to
   * animate the rectangle / color / alpha across a play session.
   */
  keyframes: LR2DestinationRect[];
  /**
   * Monotonic CSV-stream index — see {@link LR2SliderElement.declarationOrder}. Renderers stratify chrome around the
   * bar list using this field (e.g. `#IMAGE` declared after `#SRC_BAR_BODY` should overlay the bars).
   */
  declarationOrder: number;
}

export interface LR2CustomOption {
  name: string;
  defaultOp: number;
  numChoices: number;
}

export interface LR2CustomFile {
  name: string;
  path: string;
}

export type LR2NumberAlignment = 'right' | 'left' | 'center';

export interface LR2NumberSourceRect extends LR2ImageRect {
  num: number;
  alignment: LR2NumberAlignment;
  padding: number;
}

export interface LR2NumberElement {
  source: LR2NumberSourceRect;
  destination: LR2DestinationRect;
  keyframes: LR2DestinationRect[];
  /** See {@link LR2ImageElement.declarationOrder}. */
  declarationOrder: number;
}

export interface LR2GrooveGaugeElement {
  source: LR2ImageRect;
  destination: LR2DestinationRect;
  keyframes: LR2DestinationRect[];
  /** 0 = 1P side, 1 = 2P side. */
  index: number;
  /** Per-cell horizontal advance (pixels) for the next gauge unit. */
  addX: number;
  /** Per-cell vertical advance (pixels). */
  addY: number;
}

export type LR2NowComboKind = 'good' | 'great' | 'perfect';

export interface LR2NowComboElement {
  source: LR2ImageRect & { alignment: LR2NumberAlignment; padding: number };
  destination: LR2DestinationRect;
  keyframes: LR2DestinationRect[];
  /** Which judgement triggers this combo style ('good' | 'great' | 'perfect'). */
  kind: LR2NowComboKind;
  /**
   * Player side this combo definition belongs to. `#SRC_NOWCOMBO_1P` → `'1P'`, `#SRC_NOWCOMBO_2P` → `'2P'`. DP charts
   * need the 2P entry to render at the correct screen-x; SP charts only have 1P, so the renderer falls back to 1P on
   * the 2P side when no 2P element was authored.
   */
  side: '1P' | '2P';
}

/**
 * `#SRC_JUDGELINE` + `#DST_JUDGELINE` element. LR2 draws a horizontal bar at the judgement line per side (index 0=1P,
 * 1=2P). The skin texture frame itself decides the color/thickness; we just need to honor the destination rectangle
 * so it lands at the correct y-coordinate above the keys.
 */
export interface LR2JudgeLineElement {
  source: LR2ImageRect;
  destination: LR2DestinationRect;
  keyframes: LR2DestinationRect[];
  /** Side: 0 = 1P, 1 = 2P. */
  index: number;
}

/**
 * `#SRC_LINE` + `#DST_LINE` element — LR2's measure-line graphic that scrolls with the chart. The skin specifies the
 * per-side x/y/w/h at the judgement line; the renderer replicates this texture at every measure boundary, offset upward
 * by the same scroll amount as falling notes.
 */
export interface LR2MeasureLineElement {
  source: LR2ImageRect;
  destination: LR2DestinationRect;
  keyframes: LR2DestinationRect[];
  /** Side: 0 = 1P, 1 = 2P. */
  index: number;
}

/**
 * `#SRC_BGA` + `#DST_BGA` — defines the rectangle where the chart's BGA (background animation) is composited. The SRC
 * is mostly a placeholder in the LR2 spec; columns 11/12/13 carry the **nobase / nolayer / nopoor** flags (set to 1 to
 * suppress that layer for this DST entry). Multiple `#DST_BGA` entries can coexist when gated on different ops (e.g.
 * one for "normal" BGA size, another for "large" BGA size).
 */
export interface LR2BGAElement {
  destination: LR2DestinationRect;
  keyframes: LR2DestinationRect[];
  /** When true the base BGA layer (channel 04 / bmson `bga.events`) is hidden. */
  noBase: boolean;
  /** When true the layer BGAs (channels 07 / 0A / bmson `bga.layerEvents`) are hidden. */
  noLayer: boolean;
  /** When true the POOR BGA (channel 06 / bmson `bga.poorEvents`) is hidden. */
  noPoor: boolean;
}

/**
 * `#SRC_TEXT` text alignment. LR2 spec column 4 of #SRC_TEXT: 0 = left, 1 = center, 2 = right.
 */
export type LR2TextAlignment = 'left' | 'center' | 'right';

/**
 * `#SRC_TEXT` + `#DST_TEXT` element. LR2 renders strings (song title, artist, difficulty label, …) via a
 * separately-defined font (either an image-font `#LR2FONT` or a system `#FONT`). The `st` (source type) is a
 * one-of-many enum — see `text.txt` of the LR2 reference docs.
 */
export interface LR2TextElement {
  /** Font index — references the order of `#LR2FONT` / `#FONT` entries. */
  font: number;
  /** Source type — what string to render (10 = title, 14 = artist, …). */
  st: number;
  alignment: LR2TextAlignment;
  /**
   * `edit=1` makes the text field clickable for in-place editing. We don't yet ship a text-edit UI, so this is purely
   * informational for skins that gate UI on it.
   */
  edit: number;
  /**
   * Panel gate (-1 = only when no panel open, 0 = always, 1..9 = matching panel only). LR2 default skins use this to
   * scope option labels to their respective option panel.
   */
  panel: number;
  destination: LR2DestinationRect;
  keyframes: LR2DestinationRect[];
  /** See {@link LR2ImageElement.declarationOrder}. */
  declarationOrder: number;
}

/**
 * `#SRC_BARGRAPH` bar fill direction. LR2 spec column 11 (`muki`): 0 = horizontal (default), 1 = vertical.
 */
export type LR2BarGraphMuki = 'horizontal' | 'vertical';

/**
 * `#SRC_BARGRAPH` + `#DST_BARGRAPH`. A bargraph is a sprite that is progressively revealed from one edge based on a
 * runtime value (gauge, loading progress, score graph, …). The `type` enum in `bargraph.txt` controls which value
 * drives the fill.
 */
export interface LR2BarGraphElement {
  source: LR2ImageRect;
  destination: LR2DestinationRect;
  keyframes: LR2DestinationRect[];
  /** Bargraph type code (see lr2skinhelp/bargraph.txt). */
  type: number;
  muki: LR2BarGraphMuki;
  /** See {@link LR2ImageElement.declarationOrder}. */
  declarationOrder: number;
}

/**
 * `#SRC_SLIDER` orientation. Column 11 (`muki`): 0=down, 1=up, 2=right, 3=left — i.e. the direction the slider travels
 * as its value grows.
 */
export type LR2SliderMuki = 'down' | 'up' | 'right' | 'left';

/**
 * `#SRC_SLIDER` + `#DST_SLIDER`. A slider is a draggable knob whose position represents a runtime value. During play
 * sliders are mostly read-only (e.g. the song-progress slider, the hi-speed knob).
 */
export interface LR2SliderElement {
  source: LR2ImageRect;
  destination: LR2DestinationRect;
  keyframes: LR2DestinationRect[];
  /** Slider type code (see lr2skinhelp/slider.txt). */
  type: number;
  muki: LR2SliderMuki;
  /** Travel range in design pixels. */
  range: number;
  /**
   * Monotonic counter capturing where this slider's `#SRC_SLIDER` appeared in the skin's CSV stream relative to the
   * other tagged elements (`LR2BarLayout.declarationOrder` for bars). The renderer uses this to decide whether the
   * slider is drawn behind or in front of the song-list bars — a slider declared AFTER `#SRC_BAR_BODY` should overlay
   * the list (e.g. the LR2 default scroll-position slider on the right edge of the bar area), while one declared before
   * sits in the chrome behind everything.
   */
  declarationOrder: number;
}

/**
 * `#SRC_GAUGECHART_1P` / `#SRC_GAUGECHART_2P` source-rect plus the extra columns LR2 uses to size the chart area and
 * time the animated reveal. Used by the result scene to draw a polyline tracking gauge percentage over chart progress.
 *
 * Spec (`docs/LR2SkinHelp.md` lines 10238+): - `index` 0 = green (NORMAL gauge), 1 = red (HARD-style gauge). - `gr` /
 * `x` / `y` / `w` / `h` / `divx` / `divy` / `cycle` / `timer` follow the `#SRC_IMAGE` template — they pick the `#IMAGE`
 * cell whose **tint** colors the line. Most LR2 default skins set `gr = 0`, `w = h = 2` (a 2×2 sample of the skin
 * atlas) so the line carries the atlas pixel's color. - `fieldWidth` / `fieldHeight` are the polyline drawing area in
 * design pixels; the curve maps `progress 0..1 → 0..fieldW` and `value 0..100 → fieldH..0` (LR2 anchors the DST at the
 * bottom-left, so y grows upward in graph space). - `start` / `end` (ms relative to the controlling timer) gate the
 * **animated reveal**: until `start` ms elapsed nothing is drawn, between `start` and `end` the polyline reveals
 * left-to-right, after `end` it stays fully visible.
 */
export interface LR2GaugeChartSourceRect extends LR2ImageRect {
  /** 0 = 1P green / NORMAL gauge, 1 = 1P red / HARD-style gauge. */
  index: number;
  fieldWidth: number;
  fieldHeight: number;
  start: number;
  end: number;
}

/**
 * `#SRC_GAUGECHART_1P` / `#SRC_GAUGECHART_2P` plus its DST keyframe set. The DST `(x, y)` anchors the **bottom-left**
 * of the chart (LR2 spec, `docs/LR2SkinHelp.md` line 10244), and `(w, h)` is the line thickness — NOT the chart size,
 * which comes from the SRC's `fieldWidth` / `fieldHeight`.
 *
 * `side` distinguishes the 1P / 2P data source. The result scene always has 1P data, but DP / battle plays would also
 * populate 2P. Either side may have multiple `index` slots (green / red).
 */
export interface LR2GaugeChartElement {
  source: LR2GaugeChartSourceRect;
  destination: LR2DestinationRect;
  keyframes: LR2DestinationRect[];
  side: '1P' | '2P';
  /** See {@link LR2ImageElement.declarationOrder}. */
  declarationOrder: number;
}

/**
 * `#SRC_SCORECHART` source-rect — same extra columns as gauge-chart but the `index` enum is different per spec
 * (`docs/LR2SkinHelp.md` lines 10392+): - 0 = this play - 1 = personal best - 2 = rival / target
 *
 * The `value` axis runs 0..1 (EX-score / theoretical max) so the polyline maps the same way GAUGECHART does.
 */
export interface LR2ScoreChartSourceRect extends LR2ImageRect {
  /** 0 = this play, 1 = personal best, 2 = rival / target. */
  index: number;
  fieldWidth: number;
  fieldHeight: number;
  start: number;
  end: number;
}

export interface LR2ScoreChartElement {
  source: LR2ScoreChartSourceRect;
  destination: LR2DestinationRect;
  keyframes: LR2DestinationRect[];
  /** See {@link LR2ImageElement.declarationOrder}. */
  declarationOrder: number;
}

/**
 * `#SRC_BUTTON` + `#DST_BUTTON`. A button element shows a per-state cell from a sprite sheet: `divx*divy` cells
 * correspond to the possible states of the button's `type` (sort, difficulty filter, play-mode, panel toggle, etc.) —
 * see the `# button_type` list (`# button_type 一覧` in the original Japanese spec) in
 * `docs/LR2SkinHelp.md` (lines 5887+) for the full enum.
 *
 * State management & click handling aren't wired yet; the renderer just paints the cell at the current button state
 * index (cell 0 by default) so the static frame shows the right artwork.
 */
export interface LR2ButtonElement {
  source: LR2ImageRect;
  destination: LR2DestinationRect;
  keyframes: LR2DestinationRect[];
  /** Button type code (see button_type list in `LR2SkinHelp.md`). */
  type: number;
  /** 0 = display only, 1 = clickable. */
  click: number;
  /** Panel gate: -1 = only when no panel open, 0 = always, 1..9 = only when that panel is open. */
  panel: number;
  /** -1 = `value -` only, 0 = both, 1 = `value +` only. Optional in spec. */
  plusOnly: number;
  /** See {@link LR2ImageElement.declarationOrder}. */
  declarationOrder: number;
}

/**
 * `#SRC_ONMOUSE` + `#DST_ONMOUSE`. The element is only painted when the mouse cursor is inside its hit-test rectangle —
 * used for hover highlights on buttons and links. Hit-test coordinates `(x2, y2, w2, h2)` are **relative to the DST
 * `(x, y)`** per LR2 spec; the `panel` field gates the element to a specific option panel.
 */
export interface LR2OnMouseElement {
  source: LR2ImageRect;
  destination: LR2DestinationRect;
  keyframes: LR2DestinationRect[];
  /** Panel gate (-1 = only when no panel open, 0 = always, 1..9 = matching panel only). */
  panel: number;
  /** Hit-test rect, expressed as offset from DST top-left (`x2`, `y2`, `w2`, `h2`). */
  hitOffsetX: number;
  hitOffsetY: number;
  hitWidth: number;
  hitHeight: number;
  /** See {@link LR2ImageElement.declarationOrder}. */
  declarationOrder: number;
}

/**
 * `#SRC_BAR_FLASH` + `#DST_BAR_FLASH`. Animated overlay drawn on top of the focused (`BAR_BODY_ON`) bar — typically a
 * glow or pulse. DST coordinates are relative to the focused bar's top-left, like `#SRC_BAR_TITLE` / `#SRC_BAR_LEVEL`.
 */
export interface LR2BarFlashElement {
  source: LR2ImageRect;
  destination: LR2DestinationRect;
  keyframes: LR2DestinationRect[];
}

/**
 * `#SRC_BAR_RIVAL` (rival mode WIN/LOSE/DRAW per-bar overlay). One SRC per outcome (`win` / `lose` / `draw`) plus a
 * single shared DST keyframe set. Renderer skipped until rival mode lands; parsed so the data is available when it
 * does.
 */
export type LR2BarRivalKind = 'win' | 'lose' | 'draw';
export interface LR2BarRivalSource {
  kind: LR2BarRivalKind;
  source: LR2ImageRect;
}

/**
 * `#SRC_BAR_MY_LAMP` / `#SRC_BAR_RIVAL_LAMP` rival-folder lamp variants. Use the same `LR2BarLampKind` enum as the
 * regular `#SRC_BAR_LAMP`. Parsed but not yet rendered (rival mode is TBD).
 */
export interface LR2BarRivalLampSet {
  myLamps: LR2BarLampSource[];
  myLampDestination?: LR2DestinationRect;
  myLampKeyframes: LR2DestinationRect[];
  rivalLamps: LR2BarLampSource[];
  rivalLampDestination?: LR2DestinationRect;
  rivalLampKeyframes: LR2DestinationRect[];
}

/**
 * `#SRC_README` + `#DST_README`. Scrollable text viewer used by the `READTEXT` button on the select screen. The
 * renderer is gated on a "readme open" state we don't yet model, so the parser stores the entry but the select view
 * doesn't draw it.
 */
export interface LR2ReadmeElement {
  /** Font index (`#LR2FONT` order). */
  font: number;
  /** Pixel spacing between lines. */
  lineSpacing: number;
  destination: LR2DestinationRect;
  keyframes: LR2DestinationRect[];
}

/**
 * `#SRC_MOUSECURSOR` + `#DST_MOUSECURSOR`. Replaces the system cursor with a skin sprite that follows the pointer. DST
 * `(x, y)` is the offset from the actual mouse position (typically `(0, 0)`).
 */
export interface LR2MouseCursorElement {
  source: LR2ImageRect;
  destination: LR2DestinationRect;
  keyframes: LR2DestinationRect[];
  /** See {@link LR2ImageElement.declarationOrder}. */
  declarationOrder: number;
}

/**
 * `#SRC_BAR_BODY` index → which kind of song-select bar this sprite decorates. The renderer picks the appropriate
 * sprite per song / folder row when populating the on-screen bar list.
 *
 * 0 song / 1 folder / 2 custom folder / 3 new song folder / 4 rival folder / 5 song (rival mode) / 6 course folder / 7
 * course create / 8 course / 9 random course
 */
export type LR2BarBodyKind =
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
 * Sprite definition for one kind of song-select bar (`#SRC_BAR_BODY`). The select-screen renderer cross-references the
 * bar slot's kind with this map to pick the right artwork.
 */
export interface LR2BarBodySource {
  kind: LR2BarBodyKind;
  source: LR2ImageRect;
}

/**
 * One song-select bar slot (`#DST_BAR_BODY_OFF` / `_ON` index 0..29). `off` is the inactive layout, `on` is the focused
 * layout. LR2 uses up to 30 slots — typically 10 above the focus, 1 at the center, 10 below.
 */
export interface LR2BarBodySlot {
  index: number;
  off?: LR2DestinationRect;
  offKeyframes: LR2DestinationRect[];
  on?: LR2DestinationRect;
  onKeyframes: LR2DestinationRect[];
}

/**
 * `#SRC_BAR_TITLE` / `#DST_BAR_TITLE`: the per-bar song title overlay. DST coordinates are **relative** to the bar
 * slot's `BAR_BODY` rect (LR2 spec: "DST coordinates are relative to the bar's xy"). Only one SRC + DST pair is allowed
 * per skin.
 */
export interface LR2BarTitleElement {
  /** Font index (references the skin's `#LR2FONT` order). */
  font: number;
  destination: LR2DestinationRect;
  keyframes: LR2DestinationRect[];
}

/**
 * `#SRC_BAR_LEVEL` index → difficulty kind. Renders the song's level number using a NUMBER-style cell sheet. DST
 * coordinates are **relative** to the bar's xy.
 *
 * 0 = undefined / 1 = BEGINNER / 2 = NORMAL / 3 = HYPER / 4 = ANOTHER / 5 = INSANE / 6 = IR RANKING.
 */
export type LR2BarLevelKind = 'undefined' | 'beginner' | 'normal' | 'hyper' | 'another' | 'insane' | 'irRanking';

export interface LR2BarLevelSource {
  kind: LR2BarLevelKind;
  source: LR2NumberSourceRect;
}

/**
 * `#SRC_BAR_LAMP` index → clear-lamp kind. 0 = NO PLAY / 1 = FAILED / 2 = EASY / 3 = CLEAR / 4 = HARD / 5 = full combo.
 * `#SRC_BAR_MY_LAMP` / `#SRC_BAR_RIVAL_LAMP` (rival-folder variants) aren't parsed yet — only the plain track is.
 */
export type LR2BarLampKind = 'noplay' | 'failed' | 'easy' | 'clear' | 'hard' | 'fullcombo';

export interface LR2BarLampSource {
  kind: LR2BarLampKind;
  source: LR2ImageRect;
}

/**
 * `#SRC_BAR_RANK` index → clear-rank kind. 0 = no play / 1 = F / 2 = E / 3 = D / 4 = C / 5 = B / 6 = A / 7 = AA / 8 =
 * AAA.
 */
export type LR2BarRankKind = 'noplay' | 'F' | 'E' | 'D' | 'C' | 'B' | 'A' | 'AA' | 'AAA';

export interface LR2BarRankSource {
  kind: LR2BarRankKind;
  source: LR2ImageRect;
}

/**
 * Aggregate of the song-select-bar definitions in an LR2 skin. When a skin has no bar definitions (e.g. play-only
 * skins) `slots` is empty and the renderer falls back to its built-in list layout.
 */
export interface LR2BarLayout {
  bodies: LR2BarBodySource[];
  slots: LR2BarBodySlot[];
  /** `#BAR_CENTER`: the slot index that should hold the focused song. */
  center: number;
  /**
   * `#BAR_AVAILABLE`: number of slots that are clickable / focus-able. Slots outside this range only render as
   * scrolling decoration.
   */
  available: number;
  title?: LR2BarTitleElement;
  /**
   * `#SRC_BAR_LEVEL` artworks keyed by difficulty. The renderer picks one entry based on the focused-song's
   * `#DIFFICULTY` and uses the single shared `levelDestination` (DST_BAR_LEVEL keyframes are not indexed per kind in
   * LR2).
   */
  levels: LR2BarLevelSource[];
  levelDestination?: LR2DestinationRect;
  levelKeyframes: LR2DestinationRect[];
  /** `#SRC_BAR_LAMP` artworks per clear-lamp kind. */
  lamps: LR2BarLampSource[];
  lampDestination?: LR2DestinationRect;
  lampKeyframes: LR2DestinationRect[];
  /** `#SRC_BAR_RANK` artworks per clear-rank kind. */
  ranks: LR2BarRankSource[];
  rankDestination?: LR2DestinationRect;
  rankKeyframes: LR2DestinationRect[];
  /**
   * `#SRC_BAR_FLASH` overlay on the focused bar. LR2 spec: only one SRC + DST pair allowed. Rendered relative to the
   * focused bar's `BAR_BODY_ON` rect.
   */
  flash?: LR2BarFlashElement;
  /**
   * `#SRC_BAR_RIVAL` artworks (WIN/LOSE/DRAW) drawn on rival-folder bars. Parsed; renderer skipped until rival mode
   * lands.
   */
  rivalIndicators: LR2BarRivalSource[];
  rivalDestination?: LR2DestinationRect;
  rivalKeyframes: LR2DestinationRect[];
  /** Rival-mode lamp variants (`#SRC_BAR_MY_LAMP` / `_RIVAL_LAMP`). */
  rivalLamps: LR2BarRivalLampSet;
  /**
   * Monotonic counter capturing where the FIRST `#SRC_BAR_BODY` appeared in the skin's CSV stream. Compared against
   * `LR2SliderElement.declarationOrder` so the renderer can stratify chrome elements into "before bars" (skinLayer,
   * drawn behind the list) vs "after bars" (foreground layer, drawn on top of the list). `undefined` when the skin has
   * no bar list.
   */
  declarationOrder: number | undefined;
}

/**
 * Scene-timing directives (`#STARTINPUT` / `#FADEOUT` / `#CLOSE` / `#LOADSTART` / `#LOADEND` / `#PLAYSTART` / `#SKIP`).
 * Each value is a millisecond offset from the scene's main timer (timer 0). The select-screen renderer uses
 * `startInput` to gate timer-1 anchored elements; `fadeOut` / `close` would drive scene-exit transitions.
 */
export interface LR2SkinTiming {
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
 * Scratch-side / DP-flip behavior declared by the skin (`#SCRATCH`, `#FLIPSIDE`, `#FLIPRESULT`, `#DISABLEFLIP`). All
 * optional — the renderer reads these to decide which side renders the scratch and whether to apply the LR2 "DP flip"
 * mirror.
 *
 * Spec values (`docs/LR2SkinHelp.md`): - `#SCRATCH,1P,2P` — `1P` / `2P` flag for which side has scratch. `0 = no
 * scratch`, `1 = has scratch` per side. - `#FLIPSIDE` — declares the skin is the flippable kind. - `#FLIPRESULT` — flip
 * persists into the result screen. - `#DISABLEFLIP` — skin opts out of flip entirely.
 */
export interface LR2ScratchFlip {
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

export interface LR2Skin {
  name: string;
  width: number;
  height: number;
  images: LR2ImageElement[];
  laneRects: LR2DestinationRect[];
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
      LR2ImageRect[]
    >
  >;
  /**
   * Per-side `#SRC_NOWJUDGE_*` rect collections. `1P` always populated when the skin authored any judge graphic; `2P`
   * is populated only for skins that supply DP-specific positions (LR2 default `play_14.lr2skin`, etc.). Renderers
   * falling back to 1P on the 2P side (because the skin omitted 2P) is acceptable — it parks the plate at the 1P-side
   * coordinates, which is wrong for DP but no worse than the SP-only implementation it replaces.
   */
  judges: Partial<Record<'perfect' | 'great' | 'good' | 'bad' | 'poor', LR2ImageElement[]>>;
  judges2P: Partial<Record<'perfect' | 'great' | 'good' | 'bad' | 'poor', LR2ImageElement[]>>;
  numbers: LR2NumberElement[];
  grooveGauges: LR2GrooveGaugeElement[];
  nowCombos: LR2NowComboElement[];
  judgeLines: LR2JudgeLineElement[];
  measureLines: LR2MeasureLineElement[];
  bgas: LR2BGAElement[];
  texts: LR2TextElement[];
  bargraphs: LR2BarGraphElement[];
  sliders: LR2SliderElement[];
  /**
   * `#SRC_GAUGECHART_1P` / `#SRC_GAUGECHART_2P` entries. Result-screen gauge polylines; populated by `result_sc_l.csv`
   * / `result_sc_r.csv` variants (the no-chart `result_normal.csv` leaves this empty).
   */
  gaugeCharts: LR2GaugeChartElement[];
  /**
   * `#SRC_SCORECHART` entries (1P only — the spec uses `index` to distinguish current / best / target instead of a 2P
   * sibling).
   */
  scoreCharts: LR2ScoreChartElement[];
  buttons: LR2ButtonElement[];
  onMouseElements: LR2OnMouseElement[];
  /** `#SRC_README` viewer entries. Parsed; renderer integration is TBD. */
  readmes: LR2ReadmeElement[];
  /**
   * `#SRC_MOUSECURSOR`. Generally one entry per skin; we keep an array for parity with the other element collections
   * and so a skin that overrides via `#IF` branches works.
   */
  mouseCursors: LR2MouseCursorElement[];
  /** Scene-timing directives (`#STARTINPUT` / `#FADEOUT` / `#CLOSE` / …). */
  timing: LR2SkinTiming;
  /** Scratch-side / DP-flip behavior declared by the skin. */
  scratchFlip: LR2ScratchFlip;
  /** Song-select bar layout. Only populated when the skin defines `#SRC_BAR_BODY` etc. */
  barLayout: LR2BarLayout;
  customOptions: LR2CustomOption[];
  customFiles: LR2CustomFile[];
  /**
   * `#LR2FONT,path` declarations in CSV-stream order. Each entry is the resolved relative path (post-CUSTOMFILE
   * substitution).
   *
   * Indexed independently from `systemFontSizes`: the `font` field in `#SRC_TEXT` first looks up `lr2FontPaths[font]`
   * (bitmap path) and only falls through to `systemFontSizes[font]` (system size) on miss. The two registries are
   * PAIRED by per-kind index — slot 0 means "the 1st bitmap font OR the 1st system font", not "global declaration #0".
   */
  lr2FontPaths: string[];
  /**
   * `#FONT,size,...` declarations in CSV-stream order. See {@link LR2Skin.lr2FontPaths} for the per-kind indexing
   * model. Sizes are the only `#FONT` field LR2 honors — the family / weight / style triplet is ignored because LR2
   * always reads the user's SET UP option for those.
   */
  systemFontSizes: number[];
  transparentColor?: { r: number; g: number; b: number };
  files: ReadonlyMap<string, LR2SkinFileEntry>;
}

import type {
  Lr2BarBodyKind,
  Lr2BarGraphMuki,
  Lr2BarLampKind,
  Lr2BarLevelKind,
  Lr2BarRankKind,
  Lr2BarRivalKind,
  Lr2CustomFile,
  Lr2CustomOption,
  Lr2DestinationRect,
  Lr2NumberAlignment,
  Lr2ScratchFlip,
  Lr2SkinTiming,
  Lr2SliderMuki,
  Lr2TextAlignment,
} from './types.ts';

export interface SourceRect {
  gr: number;
  x: number;
  y: number;
  w: number;
  h: number;
  divx: number;
  divy: number;
  cycle: number;
  timer: number;
  /**
   * CSV-stream declaration index assigned by `parseSource` from `ParseContext.nextDeclarationOrder`. Captures the
   * relative order this `#SRC_*` line appeared at so the renderer can stratify chrome elements (`#SRC_IMAGE` /
   * `#SRC_NUMBER` / `#SRC_SLIDER` / `#SRC_TEXT` / `#SRC_BUTTON` / `#SRC_ONMOUSE`) around the bar list
   * (`#SRC_BAR_BODY`). Internal — only propagated to public element types via the typed `declarationOrder` field on
   * each `Lr2*Element`.
   */
  declarationOrder: number;
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
  side: '1P' | '2P';
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
  /**
   * `#SRC_TEXT` doesn't carry an embedded `SourceRect`, so we stamp the CSV-stream order here directly. Same semantics
   * as the other entries' `source.declarationOrder`.
   */
  declarationOrder: number;
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

interface GaugeChartSourceEntry {
  source: SourceRect;
  index: number;
  fieldWidth: number;
  fieldHeight: number;
  start: number;
  end: number;
  side: '1P' | '2P';
}

interface ScoreChartSourceEntry {
  source: SourceRect;
  index: number;
  fieldWidth: number;
  fieldHeight: number;
  start: number;
  end: number;
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

export interface BarRivalSourceEntry {
  kind: Lr2BarRivalKind;
  source: SourceRect;
}

export interface BarBodySourceEntry {
  kind: Lr2BarBodyKind;
  source: SourceRect;
}

interface BarTitleSourceEntry {
  font: number;
}

export interface BarLevelSourceEntry {
  kind: Lr2BarLevelKind;
  source: SourceRect;
  alignment: Lr2NumberAlignment;
  padding: number;
}

export interface BarLampSourceEntry {
  kind: Lr2BarLampKind;
  source: SourceRect;
}

export interface BarRankSourceEntry {
  kind: Lr2BarRankKind;
  source: SourceRect;
}

export interface ParseContext {
  imagePaths: string[];
  /** Declared `#LR2FONT` paths (declaration index = font index). */
  lr2FontPaths: string[];
  /** Declared `#FONT,size` sizes for system-font fallback. */
  systemFontSizes: number[];
  imageSources: SourceRect[];
  imageDstGroups: Lr2DestinationRect[][];
  noteSources: Map<string, SourceRect[]>;
  nowJudge1PSources: SourceRect[];
  /**
   * Full keyframe chain per judgement id — [first DST, … last DST]. The renderer needs the whole sequence (not just the
   * first row) to play the judge plate's fade-in / fade-out animation off timer 46.
   */
  nowJudge1PDstGroups: Lr2DestinationRect[][];
  /**
   * 2P-side counterparts for DP charts. LR2's `play_14.lr2skin` and any DP-aware skin authors a separate set of
   * `#SRC_NOWJUDGE_2P` / `#DST_NOWJUDGE_2P` rows so the 2P judge plate renders at the 2P-side coordinates rather than
   * overlapping the 1P plate.
   */
  nowJudge2PSources: SourceRect[];
  nowJudge2PDstGroups: Lr2DestinationRect[][];
  numberSources: NumberSourceEntry[];
  numberDstGroups: Lr2DestinationRect[][];
  grooveGaugeSources: GrooveGaugeSourceEntry[];
  grooveGaugeDstGroups: Lr2DestinationRect[][];
  /**
   * `#SRC_NOWCOMBO_*` entries from both sides. The `side` field on each entry distinguishes 1P from 2P so the renderer
   * can pick the right block at runtime.
   */
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
  /**
   * `#SRC_GAUGECHART_1P` and `#SRC_GAUGECHART_2P` staging arrays. Pairing with `#DST_*` mirrors the `imageSources` /
   * `imageDstGroups` pattern: each new SRC starts a new keyframe group; the next DST extends the group at the same
   * array index.
   */
  gaugeChartSources: GaugeChartSourceEntry[];
  gaugeChartDstGroups: Lr2DestinationRect[][];
  /** `#SRC_SCORECHART` staging arrays (1P only — `index` carries side meaning). */
  scoreChartSources: ScoreChartSourceEntry[];
  scoreChartDstGroups: Lr2DestinationRect[][];
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
   * Song-select bar `#SRC_BAR_BODY` definitions (one per kind id 0..9). Sparse — only kinds the skin actually defines
   * have an entry.
   */
  barBodySources: BarBodySourceEntry[];
  /**
   * `#DST_BAR_BODY_OFF` keyframes per slot index 0..29. Sparse like the play-skin DST groups — slot 0 is the topmost
   * off-state position.
   */
  barBodyOffDstGroups: Lr2DestinationRect[][];
  /** `#DST_BAR_BODY_ON` keyframes per slot index 0..29 (focus-state). */
  barBodyOnDstGroups: Lr2DestinationRect[][];
  /** `#BAR_CENTER` value (clamped to slot range at finalization). */
  barCenter: number;
  /** `#BAR_AVAILABLE` value (clamped to slot range at finalization). */
  barAvailable: number;
  /**
   * `#SRC_BAR_TITLE` source. LR2 spec only allows one. We keep the latest one wins to mirror how the LR2 default skin
   * chains an `#IF`-gated alt definition for the focus state.
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
  /**
   * `true` once the parser has seen an explicit `#RESOLUTION,<w>,<h>` directive. When the skin omits the directive
   * entirely we leave this `false` and {@link autoDetectCanvasFromObservedCoordinates} kicks in at the end of the
   * parse, snapping {@link width} / {@link height} to the smallest standard canvas that contains the bulk of the
   * skin's authored DST coordinates. LR2 themes from the 1280×720 / 1920×1080 era frequently ship without
   * `#RESOLUTION` (LITONE4 is the smoking gun — every coord is in 1920×1080 space, header is empty), so the
   * post-parse detection is what keeps the chrome from getting clipped to the legacy 640×480 default canvas.
   */
  explicitResolution: boolean;
  /**
   * Right-bottom corner `(x + w, y + h)` of every `#DST_*` keyframe parsed in this skin. Used by the canvas
   * auto-detector to find the design resolution when `#RESOLUTION` is omitted. We push from
   * {@link appendDestinationKeyframe} so EVERY `#DST_*` lineage contributes — image / number / text / slider / bar
   * body / etc. all share the same canvas. Entries with negative `x` or `y` (animation slide-in / slide-out
   * starting points that arrive from / depart to off-screen) are excluded; including them would skew the
   * percentile-based detection toward the animation reach instead of the rendered canvas.
   */
  observedDstCorners: Array<readonly [number, number]>;
  /**
   * Monotonic counter that increments every time we record a `#SRC_*` declaration the renderer wants z-order context
   * for (currently `#SRC_SLIDER` and the first `#SRC_BAR_BODY`). The counter is process-local to a single skin parse —
   * so a later reference's `declarationOrder > earlier reference's` iff it appeared later in the CSV stream (including
   * across `#INCLUDE`s, which feed back into the same `readLr2Path` call chain).
   */
  nextDeclarationOrder: number;
  /**
   * `nextDeclarationOrder` value assigned to the first `#SRC_BAR_BODY` we saw, or `undefined` when the skin has no bar
   * layout. Used to decide which side of the bar list each chrome element sits on.
   */
  barLayoutDeclarationOrder?: number;
}

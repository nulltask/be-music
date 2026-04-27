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
  texts: Lr2TextElement[];
  bargraphs: Lr2BarGraphElement[];
  sliders: Lr2SliderElement[];
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

interface TextSourceEntry {
  font: number;
  st: number;
  alignment: Lr2TextAlignment;
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
  textSources: TextSourceEntry[];
  textDstGroups: Lr2DestinationRect[][];
  bargraphSources: BarGraphSourceEntry[];
  bargraphDstGroups: Lr2DestinationRect[][];
  sliderSources: SliderSourceEntry[];
  sliderDstGroups: Lr2DestinationRect[][];
  laneRects: Lr2DestinationRect[];
  customOptions: Lr2CustomOption[];
  customFiles: Lr2CustomFile[];
  customFileLookup: Map<string, string>;
  transparentColor?: { r: number; g: number; b: number };
  trueOps: Set<number>;
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

export async function loadLr2SkinFromFiles(files: Iterable<File>): Promise<Lr2Skin | undefined> {
  const sourceFiles = new Map<string, Uint8Array>();
  for (const file of files) {
    const path = normalizePath(file.webkitRelativePath || file.name);
    sourceFiles.set(path, new Uint8Array(await file.arrayBuffer()));
  }
  return loadLr2SkinFromSourceFiles(sourceFiles);
}

export function loadLr2SkinFromSourceFiles(sourceFiles: ReadonlyMap<string, Uint8Array>): Lr2Skin | undefined {
  const entryPath =
    [...sourceFiles.keys()]
      .filter((path) => path.toLowerCase().endsWith('.lr2skin'))
      .sort((left, right) => scoreSkinPath(left) - scoreSkinPath(right) || left.localeCompare(right, 'ja'))[0] ??
    [...sourceFiles.keys()].find((path) => path.toLowerCase().endsWith('.csv'));
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
    textSources: [],
    textDstGroups: [],
    bargraphSources: [],
    bargraphDstGroups: [],
    sliderSources: [],
    sliderDstGroups: [],
    laneRects: [],
    customOptions: [],
    customFiles: [],
    customFileLookup: new Map(),
    trueOps: defaultParseOps(),
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
      const imagePath = context.imagePaths[source.gr];
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
    texts: createTextElements(context),
    bargraphs: createBarGraphElements(context),
    sliders: createSliderElements(context),
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
    } else if (command === '#SRC_TEXT') {
      // #SRC_TEXT,(NULL),font,st,align,edit,panel
      context.textSources.push({
        font: Math.max(0, Math.trunc(toNumber(row[2], 0))),
        st: Math.max(0, Math.trunc(toNumber(row[3], 0))),
        alignment: parseTextAlignment(row[4]),
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
    191, // STAGEFILE absent
    193, // BANNER absent
    195, // BACKBMP absent
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
    // `loop` and the trailing op fields are blank-inherited the same way:
    // a row that only specifies `time,x,y,w,h,...` keeps the original gate.
    if (isBlank(row[16])) {
      dst.loop = previous.loop;
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

function scoreSkinPath(path: string): number {
  const lower = path.toLowerCase();
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

// The chart score's layout: a resolved chart cut into its bars, each with its notes, long notes, mines, tempo changes
// and stops placed on its lanes, for `<be-music-chart-score>` to draw as a column of bars. Pure and runtime-neutral, so
// a server page can lay a chart out as well as the player.

import type {
  LongNoteMode,
  PlayKeyTone,
  PlayLaneKind,
  PlayModeLayout,
  PlayModeLayoutId,
  PlaySide,
  ResolvedChart,
  ResolvedNote,
} from '@be-music/chart-model';

/** One lane of the score, left to right as the play mode lays it out. */
export interface ChartScoreLane {
  /** The lane's visible channel (`11`..`1Z`, `21`..`2Z`). */
  readonly channel: string;
  readonly kind: PlayLaneKind;
  readonly side: PlaySide;
  /** A key's colour class; absent for the scratch and the wheel. */
  readonly tone?: PlayKeyTone;
}

/** A note or a mine in its bar: the lane index and where it sits, 0 at the bar line and 1 at the next one. */
export interface ChartScoreNote {
  readonly lane: number;
  readonly position: number;
}

/**
 * The part of a long note that lies in one bar. A long note crossing bar lines has one segment in every bar it
 * crosses: only the first has its head, and only the last its tail.
 */
export interface ChartScoreLongNote {
  readonly lane: number;
  /** Where the segment starts in the bar (0..1). */
  readonly from: number;
  /** Where the segment ends in the bar (0..1). */
  readonly to: number;
  /** The long note starts in this bar. */
  readonly head: boolean;
  /** The long note ends in this bar. */
  readonly tail: boolean;
  readonly mode: LongNoteMode;
}

/** A tempo change in its bar. */
export interface ChartScoreTempo {
  readonly position: number;
  /** The BPM the readouts show from here on. */
  readonly bpm: number;
}

/** A STOP in its bar. */
export interface ChartScoreStop {
  readonly position: number;
  readonly durationMs: number;
}

/** One bar of the score: a measure of the chart, from its bar line up to the next one. */
export interface ChartScoreBar {
  /** The bar's place in {@link ChartScoreLayout.bars}. */
  readonly index: number;
  /** The measure number (BMS `#mmm`; bmson counts its measures the same way from 0). */
  readonly measure: number;
  /** The bar's length in beats (4 for a 4/4 bar; `#xxx02` 0.75 makes it 3). */
  readonly beats: number;
  /** Where the bar starts and ends, in whole chart milliseconds (the next bar starts at `endMs`). */
  readonly startMs: number;
  readonly endMs: number;
  readonly notes: readonly ChartScoreNote[];
  readonly longNotes: readonly ChartScoreLongNote[];
  readonly mines: readonly ChartScoreNote[];
  readonly tempos: readonly ChartScoreTempo[];
  readonly stops: readonly ChartScoreStop[];
  /** The judged notes that start in this bar (taps and long-note heads). */
  readonly noteCount: number;
  /** The sounds that start in this bar: BGM, keysounds and invisible objects (`ResolvedChart.sampleTriggers`). */
  readonly soundCount: number;
}

/** How {@link layoutChartScore} lays a chart out. */
export interface ChartScoreLayoutOptions {
  /**
   * Leaves measure 0 out when it holds nothing ({@link isChartScoreBarEmpty}), so the score starts at measure 1, as
   * many BMS charts begin with an empty lead-in measure. A measure 0 with anything in it stays.
   */
  readonly omitEmptyFirstBar?: boolean;
}

/** A chart laid out bar by bar ({@link layoutChartScore}). */
export interface ChartScoreLayout {
  /** The play-mode layout the lanes follow (`7`, `14`, `9-pms`, ...). */
  readonly layoutId: PlayModeLayoutId;
  readonly lanes: readonly ChartScoreLane[];
  /** The bars in chart order; a bar of no length (`#xxx02` 0) is left out. */
  readonly bars: readonly ChartScoreBar[];
  /** The BPM the chart starts at. */
  readonly initialBPM: number;
  /** The chart's total judged notes (taps and long-note heads). */
  readonly noteCount: number;
}

/** The most bars {@link layoutChartScore} lays out, against a chart whose bar lines stop moving forwards. */
const MAX_BARS = 10_000;
/** Beats closer than this are the same place: the resolver's beats are sums of measure lengths. */
const EPSILON = 1e-9;

/** Whole chart milliseconds, as PRACTICE and the play's timeline read them. */
function toWholeMs(seconds: number): number {
  return Math.max(0, Math.floor(seconds * 1000 + 1e-6));
}

/**
 * The layout whose lanes take the most of the chart's notes: the one layout of most play modes, or for 9 KEY PMS-STD
 * (`11..15` + `22..25`) or the BME-type `11..19`.
 */
function pickLayout(chart: Pick<ResolvedChart, 'layouts' | 'notes'>): PlayModeLayout | undefined {
  let best: PlayModeLayout | undefined;
  let bestCount = -1;
  for (const layout of chart.layouts) {
    const channels = new Set(layout.lanes.map((lane) => lane.channel));
    for (const zone of layout.freeZones) channels.add(zone.channel);
    let count = 0;
    for (const note of chart.notes) if (channels.has(note.channel)) count += 1;
    if (count > bestCount) {
      best = layout;
      bestCount = count;
    }
  }
  return best;
}

/** Where each bar starts, in beats: bar `n` covers `[heads[n], heads[n + 1])`; the last head closes the last bar. */
function resolveBarHeads(chart: Pick<ResolvedChart, 'beatResolver'>, lastStart: number, lastEnd: number): number[] {
  const heads = [chart.beatResolver.measureToBeat(0, 0)];
  for (let measure = 1; measure <= MAX_BARS; measure += 1) {
    const head = chart.beatResolver.measureToBeat(measure, 0);
    heads.push(head);
    // The bar holding the last thing to start is laid out, and the bars a long note runs on into.
    if (head > lastStart + EPSILON && head + EPSILON >= lastEnd) break;
  }
  return heads;
}

/** The bar `beat` lies in: the last one whose head is at or before it (bars of no length never hold anything). */
function barIndexOf(heads: readonly number[], beat: number): number {
  let low = 0;
  let high = heads.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (heads[middle]! <= beat + EPSILON) low = middle;
    else high = middle - 1;
  }
  return Math.max(0, low);
}

interface MutableBar {
  notes: ChartScoreNote[];
  longNotes: ChartScoreLongNote[];
  mines: ChartScoreNote[];
  tempos: ChartScoreTempo[];
  stops: ChartScoreStop[];
  noteCount: number;
  soundCount: number;
}

/**
 * Lays `chart` out bar by bar, as a printed score shows it: one bar per measure, from the chart's first bar line to the
 * bar holding the last note, mine or sound (and the bars a long note runs on into). Each bar is as long as its measure
 * in beats (`#xxx02`, bmson lines) and timed through the chart's BPM changes and stops, in the whole milliseconds a
 * PRACTICE range reads. Notes go on the lanes of the play mode's layout; a FREE ZONE note goes on its side's scratch.
 * A chart that still carries `#RANDOM` shows its unconditional content, as the song list does.
 */
export function layoutChartScore(
  chart: Pick<ResolvedChart, 'layouts' | 'notes' | 'mines' | 'sampleTriggers' | 'beatResolver' | 'timing' | 'lnMode'>,
  options: ChartScoreLayoutOptions = {},
): ChartScoreLayout {
  const layout = pickLayout(chart);
  const lanes: ChartScoreLane[] = (layout?.lanes ?? []).map((lane) => ({
    channel: lane.channel,
    kind: lane.kind,
    side: lane.side,
    ...(lane.tone !== undefined ? { tone: lane.tone } : {}),
  }));
  const laneIndex = new Map<string, number>(lanes.map((lane, index) => [lane.channel, index]));
  for (const zone of layout?.freeZones ?? []) {
    const scratch = laneIndex.get(zone.scratch);
    if (scratch !== undefined) laneIndex.set(zone.channel, scratch);
  }

  let lastStart = 0;
  let lastEnd = 0;
  const startsAt = (beat: number): void => {
    if (Number.isFinite(beat) && beat > lastStart) lastStart = beat;
  };
  for (const note of chart.notes) {
    startsAt(note.beat);
    if (note.endBeat !== undefined && Number.isFinite(note.endBeat) && note.endBeat > lastEnd) lastEnd = note.endBeat;
  }
  for (const mine of chart.mines) startsAt(mine.beat);
  for (const trigger of chart.sampleTriggers) startsAt(trigger.beat);

  const heads = resolveBarHeads(chart, lastStart, lastEnd);
  const barCount = heads.length - 1;
  const bars: MutableBar[] = Array.from({ length: barCount }, () => ({
    notes: [],
    longNotes: [],
    mines: [],
    tempos: [],
    stops: [],
    noteCount: 0,
    soundCount: 0,
  }));
  const positionIn = (index: number, beat: number): number => {
    const head = heads[index]!;
    const length = heads[index + 1]! - head;
    return length > 0 ? Math.min(1, Math.max(0, (beat - head) / length)) : 0;
  };

  const placeLongNote = (note: ResolvedNote, lane: number, endBeat: number): void => {
    const first = barIndexOf(heads, note.beat);
    for (let index = first; index < barCount; index += 1) {
      const head = heads[index]!;
      const end = heads[index + 1]!;
      if (head >= endBeat - EPSILON && index > first) break;
      const tail = endBeat <= end + EPSILON;
      bars[index]!.longNotes.push({
        lane,
        from: index === first ? positionIn(index, note.beat) : 0,
        to: tail ? positionIn(index, endBeat) : 1,
        head: index === first,
        tail,
        mode: note.lnMode ?? chart.lnMode,
      });
      if (tail) break;
    }
  };

  let noteCount = 0;
  for (const note of chart.notes) {
    const lane = laneIndex.get(note.channel);
    if (lane === undefined || !Number.isFinite(note.beat)) continue;
    const index = barIndexOf(heads, note.beat);
    const bar = bars[index]!;
    bar.noteCount += 1;
    noteCount += 1;
    if (note.kind === 'ln' && note.endBeat !== undefined && note.endBeat > note.beat + EPSILON) {
      placeLongNote(note, lane, note.endBeat);
    } else {
      bar.notes.push({ lane, position: positionIn(index, note.beat) });
    }
  }
  for (const mine of chart.mines) {
    const lane = laneIndex.get(mine.channel);
    if (lane === undefined || !Number.isFinite(mine.beat)) continue;
    const index = barIndexOf(heads, mine.beat);
    bars[index]!.mines.push({ lane, position: positionIn(index, mine.beat) });
  }

  for (const trigger of chart.sampleTriggers) {
    if (Number.isFinite(trigger.beat)) bars[barIndexOf(heads, trigger.beat)]!.soundCount += 1;
  }

  // Tempo changes after the start; the BPM the chart starts at is the layout's.
  const initialBPM = chart.timing.displayBPMAtBeat(heads[0]!);
  let currentBPM = initialBPM;
  for (const point of [...chart.timing.tempoPoints].sort((left, right) => left.beat - right.beat)) {
    const bpm = point.displayBPM ?? point.bpm;
    if (!Number.isFinite(bpm) || !Number.isFinite(point.beat) || point.beat <= heads[0]! + EPSILON) continue;
    if (point.beat > heads[barCount]! + EPSILON) break;
    if (Math.abs(bpm - currentBPM) < 1e-9) continue;
    currentBPM = bpm;
    const index = barIndexOf(heads, point.beat);
    bars[index]!.tempos.push({ position: positionIn(index, point.beat), bpm });
  }
  for (const stop of chart.timing.stopPoints) {
    if (!Number.isFinite(stop.beat) || !(stop.seconds > 0) || stop.beat > heads[barCount]! + EPSILON) continue;
    const index = barIndexOf(heads, stop.beat);
    bars[index]!.stops.push({ position: positionIn(index, stop.beat), durationMs: Math.round(stop.seconds * 1000) });
  }

  const laidOut: ChartScoreBar[] = [];
  for (let measure = 0; measure < barCount; measure += 1) {
    const beats = heads[measure + 1]! - heads[measure]!;
    if (!(beats > EPSILON)) continue;
    const bar = bars[measure]!;
    if (measure === 0 && options.omitEmptyFirstBar === true && barCount > 1 && isChartScoreBarEmpty(bar)) continue;
    const sortByPosition = <T extends { position: number; lane?: number }>(items: T[]): T[] =>
      items.sort((left, right) => left.position - right.position || (left.lane ?? 0) - (right.lane ?? 0));
    laidOut.push({
      index: laidOut.length,
      measure,
      beats,
      startMs: toWholeMs(chart.timing.beatToSeconds(heads[measure]!)),
      endMs: toWholeMs(chart.timing.beatToSeconds(heads[measure + 1]!)),
      notes: sortByPosition(bar.notes),
      longNotes: bar.longNotes,
      mines: sortByPosition(bar.mines),
      tempos: sortByPosition(bar.tempos),
      stops: sortByPosition(bar.stops),
      noteCount: bar.noteCount,
      soundCount: bar.soundCount,
    });
  }
  return {
    layoutId: layout?.id ?? '7',
    lanes,
    bars: laidOut,
    initialBPM,
    noteCount,
  };
}

/**
 * Whether a bar holds nothing: no note, long note or mine, no sound starting in it (BGM included), and no tempo change
 * or stop. A long note running on into the bar counts as something in it.
 */
export function isChartScoreBarEmpty(
  bar: Pick<ChartScoreBar, 'notes' | 'longNotes' | 'mines' | 'tempos' | 'stops' | 'soundCount'>,
): boolean {
  return (
    bar.notes.length === 0 &&
    bar.longNotes.length === 0 &&
    bar.mines.length === 0 &&
    bar.tempos.length === 0 &&
    bar.stops.length === 0 &&
    bar.soundCount === 0
  );
}

/**
 * Packs the bars into columns of at most `columnBeats` beats each, bottom to top, as a printed score fills its columns:
 * the next bar starts a new column once it would overflow the current one, and a bar longer than a column has a column
 * of its own. Returns the bar indices of each column.
 */
export function packChartScoreColumns(bars: readonly Pick<ChartScoreBar, 'beats'>[], columnBeats: number): number[][] {
  const capacity = Number.isFinite(columnBeats) && columnBeats > 0 ? columnBeats : 16;
  const columns: number[][] = [];
  let current: number[] = [];
  let filled = 0;
  bars.forEach((bar, index) => {
    if (current.length > 0 && filled + bar.beats > capacity + EPSILON) {
      columns.push(current);
      current = [];
      filled = 0;
    }
    current.push(index);
    filled += bar.beats;
  });
  if (current.length > 0) columns.push(current);
  return columns;
}

/** A run of whole bars, as `<be-music-chart-score>` selects them: `first` to `last`, both included. */
export interface ChartScoreBarRange {
  readonly first: number;
  readonly last: number;
}

/**
 * The range a press on bar `index` makes: that bar alone, or with `extend` (Shift, or a drag from `anchor`) every bar
 * from `anchor` to it, in either direction.
 */
export function selectChartScoreBars(anchor: number | undefined, index: number, extend: boolean): ChartScoreBarRange {
  if (!extend || anchor === undefined) return { first: index, last: index };
  return { first: Math.min(anchor, index), last: Math.max(anchor, index) };
}

/**
 * A range of bars as chart milliseconds: from the first bar's line up to the line closing the last one, the times a
 * PRACTICE range (`PlayPractice.startMs` / `endMs`) and a replay read. `undefined` for a range outside the layout.
 */
export function chartScoreRangeTimes(
  layout: Pick<ChartScoreLayout, 'bars'>,
  range: ChartScoreBarRange,
): { startMs: number; endMs: number } | undefined {
  const first = layout.bars[Math.min(range.first, range.last)];
  const last = layout.bars[Math.max(range.first, range.last)];
  if (first === undefined || last === undefined) return undefined;
  return { startMs: first.startMs, endMs: Math.max(first.startMs, last.endMs) };
}

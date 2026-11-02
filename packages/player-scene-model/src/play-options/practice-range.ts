import { createMeasureTimeline, type ResolvedChart } from '@be-music/chart-model';

/** The shortest PRACTICE range: `END TIME` lies at least this long after `START TIME` (`PracticeModifier`). */
export const PRACTICE_MIN_RANGE_MS = 1000;

/** One measure start of a chart, where a PRACTICE range handle snaps. */
export interface PracticeRangeMeasure {
  /** The measure number (BMS `#mmm`; bmson counts its measures the same way from 0). */
  readonly measure: number;
  /** Where the measure starts (its bar line), in chart milliseconds. */
  readonly startMs: number;
}

/** What the PRACTICE range picker reads of a chart: its length, measure starts and judged note times. */
export interface PracticeRangeChart {
  /** The chart's length in milliseconds: its last measure end or its last note end, whichever is later. */
  readonly lengthMs: number;
  /**
   * The measure starts in time order, one per time (an empty measure keeps the first number). The last is the bar line
   * that closes the chart's last measure.
   */
  readonly measures: readonly PracticeRangeMeasure[];
  /** When each judged note (tap or long-note head) is hit, in chart milliseconds, sorted. */
  readonly noteTimesMs: readonly number[];
}

/** A PRACTICE range as the play options store it: `endMs` 0 plays to the chart's end. */
export interface PracticeRange {
  readonly startMs: number;
  readonly endMs: number;
}

/** Which handle of the range picker a drag moves. */
export type PracticeRangeHandle = 'start' | 'end';

/**
 * The PRACTICE range picker's view of `chart` (#948), from the chart already resolved: its measure timeline
 * (`createMeasureTimeline`) and its judged notes. Times are whole chart milliseconds, as PRACTICE reads them.
 */
export function resolvePracticeRangeChart(chart: ResolvedChart): PracticeRangeChart {
  const measures: PracticeRangeMeasure[] = [];
  for (const point of createMeasureTimeline(chart.source, chart.timing, chart.beatResolver)) {
    const startMs = Math.max(0, Math.floor(point.seconds * 1000 + 1e-6));
    const previous = measures.at(-1);
    if (previous !== undefined && startMs <= previous.startMs) continue;
    measures.push({ measure: point.measure, startMs });
  }
  const noteTimesMs = chart.notes
    .map((note) => Math.max(0, Math.floor(note.seconds * 1000 + 1e-6)))
    .sort((left, right) => left - right);
  const lengthMs = Math.max(measures.at(-1)?.startMs ?? 0, Math.ceil(chart.lastNoteSeconds * 1000), 1);
  return { lengthMs, measures, noteTimesMs };
}

/** How many notes fall in each of `binCount` equal slices of `[0, lengthMs)`; a note at or past the end counts last. */
export function binPracticeNoteDensity(noteTimesMs: readonly number[], lengthMs: number, binCount: number): number[] {
  const count = Math.max(0, Math.floor(binCount));
  const bins = Array.from({ length: count }, () => 0);
  if (count === 0 || !(lengthMs > 0)) return bins;
  for (const ms of noteTimesMs) {
    const index = Math.min(count - 1, Math.max(0, Math.floor((ms / lengthMs) * count)));
    bins[index] = (bins[index] ?? 0) + 1;
  }
  return bins;
}

/** Where `ms` falls on a graph `width` wide showing `[0, lengthMs]`, clamped to the graph. */
export function practiceTimeToX(ms: number, lengthMs: number, width: number): number {
  if (!(lengthMs > 0)) return 0;
  return Math.min(1, Math.max(0, ms / lengthMs)) * width;
}

/** The chart time at `x` on a graph `width` wide showing `[0, lengthMs]`, clamped to the chart. */
export function practiceXToTime(x: number, lengthMs: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.min(1, Math.max(0, x / width)) * lengthMs;
}

/** The measure `ms` lies in: the last one starting at or before it (the first measure before the chart's first). */
export function findPracticeMeasureAt(
  ms: number,
  measures: readonly PracticeRangeMeasure[],
): PracticeRangeMeasure | undefined {
  let found = measures[0];
  for (const measure of measures) {
    if (measure.startMs > ms) break;
    found = measure;
  }
  return found;
}

/**
 * The range a picker shows for the stored `range`, as the play reads it: END 0 is the chart's end, and END lies at
 * least {@link PRACTICE_MIN_RANGE_MS} after START.
 */
export function resolveShownPracticeRange(range: PracticeRange, lengthMs: number): PracticeRange {
  const startMs = Math.max(0, Math.trunc(range.startMs));
  const endMs = range.endMs > 0 ? Math.trunc(range.endMs) : lengthMs;
  return { startMs, endMs: Math.max(startMs + PRACTICE_MIN_RANGE_MS, endMs) };
}

/** The handle a press at `x` grabs: the nearer one, or on a tie the one on the side pressed. */
export function pickPracticeRangeHandle(x: number, startX: number, endX: number): PracticeRangeHandle {
  const toStart = Math.abs(x - startX);
  const toEnd = Math.abs(x - endX);
  if (toStart !== toEnd) return toStart < toEnd ? 'start' : 'end';
  return x < startX ? 'start' : 'end';
}

/**
 * The stored range after dragging `handle` to `ms` (#948). The handle snaps to the nearest measure start that keeps
 * the range at least {@link PRACTICE_MIN_RANGE_MS} long against the other handle; the end snapping to the bar line that
 * closes the chart stores 0 (to the end). With no such measure start, the handle stops
 * {@link PRACTICE_MIN_RANGE_MS} from the other one.
 */
export function dragPracticeRangeHandle(
  range: PracticeRange,
  handle: PracticeRangeHandle,
  ms: number,
  chart: PracticeRangeChart,
): PracticeRange {
  const shown = resolveShownPracticeRange(range, chart.lengthMs);
  const last = chart.measures.at(-1);
  if (handle === 'start') {
    const latest = shown.endMs - PRACTICE_MIN_RANGE_MS;
    const snapped = nearestStart(
      chart.measures.filter((measure) => measure !== last && measure.startMs <= latest),
      ms,
    );
    return { startMs: snapped ?? Math.max(0, Math.min(Math.round(ms), latest)), endMs: range.endMs };
  }
  const earliest = shown.startMs + PRACTICE_MIN_RANGE_MS;
  const snapped = nearestStart(
    chart.measures.filter((measure) => measure.startMs >= earliest),
    ms,
  );
  const endMs = snapped ?? Math.max(earliest, Math.round(ms));
  return { startMs: range.startMs, endMs: endMs >= chart.lengthMs || endMs === last?.startMs ? 0 : endMs };
}

function nearestStart(measures: readonly PracticeRangeMeasure[], ms: number): number | undefined {
  let best: number | undefined;
  for (const measure of measures) {
    if (best === undefined || Math.abs(measure.startMs - ms) < Math.abs(best - ms)) best = measure.startMs;
  }
  return best;
}

/** `ms` as `m:ss.s`, tenths rounded down (`83_456` → `1:23.4`). */
export function formatPracticeTime(ms: number): string {
  const tenths = Math.max(0, Math.floor(ms / 100));
  const minutes = Math.floor(tenths / 600);
  const seconds = (tenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

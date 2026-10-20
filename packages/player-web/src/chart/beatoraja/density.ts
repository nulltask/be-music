// Note-density readouts for a parsed chart: beatoraja's skin numbers 360-365.
//
// beatoraja reads these from the chart's `SongInformation` (`IntegerPropertyFactory.java` L347-L386 at 8320241d):
// `DENSITY_PEAK=360 (+afterdot 361)` / `DENSITY_END=362 (+afterdot 363)` / `DENSITY_AVERAGE=364 (+afterdot 365)`,
// each the whole part `(int) x` and two decimal digits `(int) (x * 100) % 100`. The densities follow
// `SongInformation(BMSModel)` (`SongInformation.java` L86-L176): notes are counted per second of the chart, a long note
// counting in every second it is held, and
// - peak is the busiest second;
// - average is the mean of the seconds holding at least `totalNotes / seconds / 4` notes;
// - end is the busiest 5-second average from the second where the notes left fit inside the TOTAL-based border.

import { resolveChart, type ResolvedChart } from '@be-music/chart';
import type { BeMusicJSON } from '@be-music/json';

/** A density readout: its whole part and its two decimal digits, as beatoraja's numbers show them. */
export interface DensityReadout {
  whole: number;
  /** `(int) (x * 100) % 100`: `12.345` gives `34`. */
  afterDot: number;
}

/** Density readouts in notes per second. */
export interface ChartDensity {
  /** The busiest second. */
  peak: DensityReadout;
  /** The busiest 5-second average from the TOTAL border on. */
  end: DensityReadout;
  /** The mean of the seconds that hold at least a quarter of the chart's mean. */
  average: DensityReadout;
}

/** The raw densities of a chart, as beatoraja's `SongInformation` stores them. */
export interface ChartDensityValues {
  peak: number;
  end: number;
  average: number;
}

/** beatoraja analyses at most six hours (`MAX_ANALYSIS_DURATION_MILLIS`); a longer chart has no song information. */
const MAX_ANALYSIS_DURATION_MS = 6 * 60 * 60 * 1000;

/** The seconds `SongInformation` averages the end density over (`Math.min(5, ...)`). */
const END_DENSITY_WINDOW_SECONDS = 5;

/** A timeline time in whole milliseconds, truncated as jbms-parser's `TimeLine.getTime()` does (microseconds / 1000). */
function toTimelineMs(seconds: number): number {
  return Math.floor(Math.floor(seconds * 1_000_000 + 1e-3) / 1000);
}

/** A lane object `SongInformation` walks: a tap, a long note's start (held through `heldUntilMs`), or another object. */
interface CountedObject {
  ms: number;
  /** What it adds to its own second: 1 for a tap; 0 for a counted LN end (it swaps the hold for the end) or a mine. */
  notes: number;
  /** A long note's start: the time of its end. It counts once in every second from its own through its end's. */
  heldUntilMs?: number;
}

/**
 * The densities beatoraja's `SongInformation(BMSModel)` computes for `chart` (`SongInformation.java` L86-L176), from the
 * chart's resolved notes. All zero for a chart without timelines or longer than beatoraja analyses.
 */
export function computeBeatorajaChartDensityValues(chart: BeMusicJSON | ResolvedChart): ChartDensityValues {
  const resolved = 'sortedEvents' in chart ? chart : resolveChart(chart);
  const zero = { peak: 0, end: 0, average: 0 };

  // `BMSModel.getLastMilliTime`: the last timeline with a lane object (judged, mine or hidden), a BGM, or a BGA / layer.
  const laneObjects = resolved.notes.length + resolved.mines.length + resolved.invisibleNotes.length;
  let hasTimeline = laneObjects > 0;
  let lastSeconds = hasTimeline ? resolved.lastNoteSeconds : 0;
  const others = [
    ...resolved.sampleTriggers.filter((trigger) => trigger.channel === '01'),
    ...resolved.bga.base,
    ...resolved.bga.layer,
  ];
  for (const other of others) {
    hasTimeline = true;
    lastSeconds = Math.max(lastSeconds, other.seconds);
  }
  const lastTime = toTimelineMs(lastSeconds);
  if (!hasTimeline || lastTime < 0 || lastTime > MAX_ANALYSIS_DURATION_MS) return zero;

  // `SongInformation` walks a long note's end only outside LN mode (`#LNMODE` 1, or none with the LN type the song
  // database reads with); `BMSModel.getTotalNotes` counts the end of a CN / HCN note.
  const chartLNMode = resolved.lnMode;
  const objects: CountedObject[] = [];
  let totalNotes = 0;
  for (const note of resolved.notes) {
    const ms = toTimelineMs(note.seconds);
    if (note.kind === 'ln' && note.endSeconds !== undefined) {
      const endMs = toTimelineMs(note.endSeconds);
      objects.push({ ms, notes: 0, heldUntilMs: endMs });
      totalNotes += (note.lnMode ?? chartLNMode) === 1 ? 1 : 2;
      if (chartLNMode !== 1) objects.push({ ms: endMs, notes: 0 });
    } else {
      objects.push({ ms, notes: 1 });
      totalNotes += 1;
    }
  }
  // A mine lands in a column of its own, outside the counts, but still steps the border down.
  for (const mine of resolved.mines) objects.push({ ms: toTimelineMs(mine.seconds), notes: 0 });
  objects.sort((a, b) => a.ms - b.ms);

  const seconds = Math.floor(lastTime / 1000) + 2;
  const counts = Array.from({ length: seconds }, () => 0);
  const total = resolved.total.value !== undefined && resolved.total.value > 0 ? resolved.total.value : 100;
  let border = Math.trunc(totalNotes * (1 - 100 / total));
  let borderSecond = 0;
  for (const object of objects) {
    const second = Math.floor(object.ms / 1000);
    if (second < 0 || second >= seconds) continue;
    if (object.heldUntilMs !== undefined) {
      const endSecond = Math.min(Math.floor(object.heldUntilMs / 1000), seconds - 1);
      for (let index = second; index <= endSecond; index += 1) counts[index]! += 1;
    }
    counts[second]! += object.notes;
    border -= 1;
    if (border === 0) borderSecond = second;
  }

  const floor = Math.trunc(Math.trunc(totalNotes / seconds) / 4);
  let peak = 0;
  let sum = 0;
  let counted = 0;
  for (const notes of counts) {
    peak = Math.max(peak, notes);
    if (notes >= floor) {
      sum += notes;
      counted += 1;
    }
  }
  const average = counted > 0 ? sum / counted : 0;

  const window = Math.min(END_DENSITY_WINDOW_SECONDS, seconds - borderSecond - 1);
  let end = 0;
  if (window > 0) {
    for (let start = borderSecond; start < seconds - window; start += 1) {
      let notes = 0;
      for (let offset = 0; offset < window; offset += 1) notes += counts[start + offset]!;
      end = Math.max(end, notes / window);
    }
  }
  return { peak, end, average };
}

/** beatoraja's readout of a density: `(int) x` and `(int) (x * 100) % 100`. */
export function toBeatorajaDensityReadout(value: number): DensityReadout {
  if (!Number.isFinite(value) || value < 0) return { whole: 0, afterDot: 0 };
  return { whole: Math.trunc(value), afterDot: Math.trunc(value * 100) % 100 };
}

/** The chart's note-density readouts for beatoraja's numbers 360-365 ({@link computeBeatorajaChartDensityValues}). */
export function computeBeatorajaChartDensity(chart: BeMusicJSON | ResolvedChart): ChartDensity {
  const values = computeBeatorajaChartDensityValues(chart);
  return {
    peak: toBeatorajaDensityReadout(values.peak),
    end: toBeatorajaDensityReadout(values.end),
    average: toBeatorajaDensityReadout(values.average),
  };
}

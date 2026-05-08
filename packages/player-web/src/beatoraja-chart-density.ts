// Note-density readouts for a parsed BMS chart.
//
// ModernChic's `info.lua` authors `value[]` displays for the chart's note density:
// `DENSITY_PEAK=360 (+afterdot 361)` / `DENSITY_END=362 (+afterdot 363)` /
// `DENSITY_AVERAGE=364 (+afterdot 365)`. Notes are bucketed into 1-second wallclock windows;
// peak = max bucket count, end = the bucket containing the chart's last note, average =
// total notes / chart duration.
//
// The afterdot values give the first decimal place — beatoraja's value digits split a float
// into two separate readouts (integer part + first decimal), so authors can render "12.4 NPS"
// as a 2-cell + dot + 1-cell layout. We compute the integer + decimal parts directly to match.

import type { BeMusicEvent, BeMusicJson } from '@be-music/json';

/** Density readout in notes-per-second. Integer part + first decimal. */
export interface ChartDensity {
  /** Peak NPS — the highest count of any 1-second window. */
  peak: { whole: number; afterDot: number };
  /** End NPS — the count of the window containing the chart's last note. */
  end: { whole: number; afterDot: number };
  /** Average NPS — total playable notes / chart duration in seconds. */
  average: { whole: number; afterDot: number };
}

/** Standard 4-beat measure baseline. Authors override via `chart.measures[].length`. */
const BEATS_PER_STANDARD_MEASURE = 4;

/** STOP table units (channel `09` references). 192 units = one 4-beat measure. */
const STOP_UNITS_PER_MEASURE = 192;

/**
 * Compute the chart's note-density readouts. Returns zeros when the chart has no playable
 * notes (degenerate / metadata-only chart).
 *
 * Algorithm:
 *   1. Sort events by chart-beat.
 *   2. Walk segments, accumulating wallclock seconds across BPM changes + STOP events.
 *   3. Whenever a playable note event fires, record its wallclock-seconds offset.
 *   4. Bucket the note-time list into 1-second windows.
 *   5. Peak = max bucket, end = bucket containing the last note, avg = total / duration.
 */
export function computeBeatorajaChartDensity(chart: BeMusicJson): ChartDensity {
  const empty = { whole: 0, afterDot: 0 };
  const measureBaseBeat = computeMeasureBaseBeats(chart);
  if (measureBaseBeat.length === 0) {
    return { peak: empty, end: empty, average: empty };
  }

  // Build a unified timeline: every event with its computed beat. Sort by beat. Walk in beat
  // order, applying BPM transitions and STOP durations to derive wallclock seconds.
  type Entry = { beat: number; kind: 'note' | 'bpm' | 'stop'; payload?: number };
  const entries: Entry[] = [];
  const bpmTable = chart.resources?.bpm ?? {};
  const stopTable = chart.resources?.stop ?? {};
  for (const event of chart.events ?? []) {
    if (event.value === '00' || event.value === '') continue;
    const beat = eventBeat(event, measureBaseBeat);
    if (beat === undefined) continue;
    if (event.channel === '03') {
      const parsed = parseInt(event.value, 16);
      if (Number.isFinite(parsed) && parsed > 0) entries.push({ beat, kind: 'bpm', payload: parsed });
    } else if (event.channel === '08') {
      const looked =
        bpmTable[event.value] ?? bpmTable[event.value.toLowerCase()] ?? bpmTable[event.value.toUpperCase()];
      const bpm =
        typeof looked === 'number' ? looked : typeof looked === 'string' ? Number.parseFloat(looked) : Number.NaN;
      if (Number.isFinite(bpm) && bpm > 0) entries.push({ beat, kind: 'bpm', payload: bpm });
    } else if (event.channel === '09') {
      const looked =
        stopTable[event.value] ?? stopTable[event.value.toLowerCase()] ?? stopTable[event.value.toUpperCase()];
      const stopUnits =
        typeof looked === 'number' ? looked : typeof looked === 'string' ? Number.parseFloat(looked) : Number.NaN;
      if (Number.isFinite(stopUnits) && stopUnits > 0) {
        const durationBeats = (stopUnits / STOP_UNITS_PER_MEASURE) * BEATS_PER_STANDARD_MEASURE;
        entries.push({ beat, kind: 'stop', payload: durationBeats });
      }
    } else if (isPlayableNote(event)) {
      entries.push({ beat, kind: 'note' });
    }
  }
  // Sort: same-beat ordering — BPM first, then stop (applies under new bpm), then notes (which
  // anyway fire AT the start of their beat so the order doesn't matter for density bucketing).
  entries.sort((a, b) => {
    if (a.beat !== b.beat) return a.beat - b.beat;
    const order = (k: Entry['kind']): number => (k === 'bpm' ? 0 : k === 'stop' ? 1 : 2);
    return order(a.kind) - order(b.kind);
  });

  // Walk and convert to wallclock seconds. Note events get their seconds-stamp pushed into a
  // sorted list (entries are already in beat order, so the seconds list comes out sorted).
  const initialBpm = chart.metadata.bpm > 0 ? chart.metadata.bpm : 130;
  let bpm = initialBpm;
  let seconds = 0;
  let cursorBeat = 0;
  const noteSeconds: number[] = [];
  for (const e of entries) {
    if (e.beat > cursorBeat) {
      seconds += ((e.beat - cursorBeat) * 60) / bpm;
      cursorBeat = e.beat;
    }
    if (e.kind === 'bpm' && typeof e.payload === 'number') {
      bpm = e.payload;
    } else if (e.kind === 'stop' && typeof e.payload === 'number') {
      seconds += (e.payload * 60) / bpm;
    } else if (e.kind === 'note') {
      noteSeconds.push(seconds);
    }
  }

  if (noteSeconds.length === 0 || seconds <= 0) {
    return { peak: empty, end: empty, average: empty };
  }

  // Bucket into 1-second windows.
  const totalDurationSec = seconds;
  const lastNoteSec = noteSeconds[noteSeconds.length - 1]!;
  const bucketCount = Math.max(1, Math.ceil(lastNoteSec) + 1);
  const buckets = new Array<number>(bucketCount).fill(0);
  for (const s of noteSeconds) {
    const idx = Math.min(bucketCount - 1, Math.floor(s));
    buckets[idx] += 1;
  }
  let peakNPS = 0;
  for (const b of buckets) {
    if (b > peakNPS) peakNPS = b;
  }
  const endNPS = buckets[Math.min(bucketCount - 1, Math.floor(lastNoteSec))]!;
  const averageNPS = noteSeconds.length / totalDurationSec;

  return {
    peak: splitDecimal(peakNPS),
    end: splitDecimal(endNPS),
    average: splitDecimal(averageNPS),
  };
}

/** Split `12.345` into `{ whole: 12, afterDot: 3 }` (first decimal digit). */
function splitDecimal(value: number): { whole: number; afterDot: number } {
  if (!Number.isFinite(value) || value < 0) return { whole: 0, afterDot: 0 };
  const whole = Math.floor(value);
  const afterDot = Math.floor((value - whole) * 10);
  return { whole, afterDot };
}

function isPlayableNote(event: BeMusicEvent): boolean {
  const ch = event.channel;
  if (ch.length !== 2) return false;
  const lead = ch[0]!;
  return lead === '1' || lead === '2' || lead === '5' || lead === '6';
}

function computeMeasureBaseBeats(chart: BeMusicJson): number[] {
  const lengths = new Map<number, number>();
  let maxMeasure = 0;
  for (const event of chart.events ?? []) {
    if (event.measure > maxMeasure) maxMeasure = event.measure;
  }
  for (const measure of chart.measures ?? []) {
    const idx = Math.max(0, Math.floor(measure.index));
    if (idx > maxMeasure) maxMeasure = idx;
    if (Number.isFinite(measure.length) && measure.length > 0) {
      lengths.set(idx, measure.length);
    }
  }
  const measureBaseBeat: number[] = [];
  let beat = 0;
  for (let m = 0; m <= maxMeasure; m += 1) {
    measureBaseBeat.push(beat);
    const length = lengths.get(m) ?? 1;
    beat += length * BEATS_PER_STANDARD_MEASURE;
  }
  return measureBaseBeat;
}

function eventBeat(event: BeMusicEvent, measureBaseBeat: number[]): number | undefined {
  const base = measureBaseBeat[event.measure];
  if (base === undefined) return undefined;
  const [num, denom] = event.position;
  if (!Number.isFinite(num) || !Number.isFinite(denom) || denom <= 0) return base;
  return base + (num / denom) * BEATS_PER_STANDARD_MEASURE;
}

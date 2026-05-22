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
import {
  collectBeatorajaChartTimedEntries,
  computeBeatorajaMeasureBaseBeats,
  resolveBeatorajaInitialBpm,
} from './timing.ts';

/** Density readout in notes-per-second. Integer part + first decimal. */
export interface ChartDensity {
  /** Peak NPS — the highest count of any 1-second window. */
  peak: { whole: number; afterDot: number };
  /** End NPS — the count of the window containing the chart's last note. */
  end: { whole: number; afterDot: number };
  /** Average NPS — total playable notes / chart duration in seconds. */
  average: { whole: number; afterDot: number };
}

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
  const measureBaseBeat = computeBeatorajaMeasureBaseBeats(chart);
  if (measureBaseBeat.length === 0) {
    return { peak: empty, end: empty, average: empty };
  }

  // Build a unified timeline: every event with its computed beat. Sort by beat. Walk in beat
  // order, applying BPM transitions and STOP durations to derive wallclock seconds.
  const entries = collectBeatorajaChartTimedEntries(chart, measureBaseBeat, (event) =>
    isPlayableNote(event) ? true : undefined,
  );

  // Walk and convert to wallclock seconds. Note events get their seconds-stamp pushed into a
  // sorted list (entries are already in beat order, so the seconds list comes out sorted).
  const initialBpm = resolveBeatorajaInitialBpm(chart);
  let bpm = initialBpm;
  let seconds = 0;
  let cursorBeat = 0;
  const noteSeconds: number[] = [];
  for (const e of entries) {
    if (e.beat > cursorBeat) {
      seconds += ((e.beat - cursorBeat) * 60) / bpm;
      cursorBeat = e.beat;
    }
    if (e.kind === 'bpm') {
      bpm = e.bpm;
    } else if (e.kind === 'stop') {
      seconds += (e.durationBeats * 60) / bpm;
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
  const buckets = Array.from({ length: bucketCount }, () => 0);
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

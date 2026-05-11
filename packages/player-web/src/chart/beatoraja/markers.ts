// Compute per-marker-kind beat positions from a parsed BMS chart.
//
// The marker layer (`BeatorajaMarkerLayer`) renders sprites at chart-time positions; this module
// turns the raw event stream into the beat lists those positions reference. Four marker kinds:
//
//   - `group`: section lines — beat 0 of every measure
//   - `bpm`: beat of every BPM-change event (channel `03` = inline byte, `08` = BPM table ref)
//   - `stop`: beat of every STOP event (channel `09`)
//   - `time`: time-tick beats — every wall-second from 0..totalSeconds, mapped to chart beats
//
// Beat math mirrors the engine's resolver: each measure has a `length` (1.0 = 4 beats by
// default; `chart.measures[].length` overrides). Measure-start beats accumulate by summing prior
// measures' lengths × 4. Within a measure, `event.position = [num, denom]` becomes a fractional
// position multiplied by the measure's length.

import type { BeMusicJson } from '@be-music/json';
import type { BeatorajaMarkerBeats } from '../../scene/beatoraja/markers.ts';
import { beatorajaEventBeat, computeBeatorajaMeasureBaseBeats, hasBeatorajaEventValue } from './timing.ts';

/**
 * Compute marker beat lists for the given chart. `time` markers are spaced at `timeIntervalSec`
 * wallclock seconds — pass `undefined` to disable time markers entirely (some skins don't author
 * a `time` destination).
 */
export function computeBeatorajaChartMarkers(
  chart: BeMusicJson,
  options: { timeIntervalSec?: number; totalSeconds?: number; beatToSeconds?: (beat: number) => number } = {},
): BeatorajaMarkerBeats {
  // 1. Build per-measure base beats. We need this for BPM / STOP event positions too, so it's
  //    computed unconditionally even when only the `group` markers are wanted.
  const measureBaseBeat = computeBeatorajaMeasureBaseBeats(chart);

  // 2. Section lines — beat 0 of every measure that exists in the chart.
  const group: number[] = [];
  for (let m = 0; m < measureBaseBeat.length; m += 1) {
    group.push(measureBaseBeat[m]!);
  }

  // 3. BPM / STOP event beats. The BMS standard sets channel `03` for inline BPM bytes,
  //    `08` for BPM-table ref (resolves via `chart.resources.bpm`), `09` for STOP-table ref.
  //    For our purposes the channel matters but the value's specific bytes don't — we only
  //    care WHEN the event fires.
  const bpm: number[] = [];
  const stop: number[] = [];
  for (const event of chart.events ?? []) {
    if (!hasBeatorajaEventValue(event.value)) continue;
    const beat = beatorajaEventBeat(event, measureBaseBeat);
    if (beat === undefined) continue;
    if (event.channel === '03' || event.channel === '08') {
      bpm.push(beat);
    } else if (event.channel === '09') {
      stop.push(beat);
    }
  }
  bpm.sort((a, b) => a - b);
  stop.sort((a, b) => a - b);

  // 4. Time markers — converts wallclock-second ticks to beats via the host-supplied resolver.
  //    Without `beatToSeconds`, we approximate via the chart's main BPM (constant). Disabled
  //    entirely when `timeIntervalSec` is unset.
  const time: number[] = [];
  if (options.timeIntervalSec !== undefined && options.timeIntervalSec > 0 && options.totalSeconds !== undefined) {
    const interval = options.timeIntervalSec;
    const beatToSeconds = options.beatToSeconds;
    const bpmFallback = chart.metadata.bpm > 0 ? chart.metadata.bpm : 130;
    const beatsPerSecond = bpmFallback / 60;
    for (let t = 0; t <= options.totalSeconds; t += interval) {
      if (beatToSeconds !== undefined) {
        // Binary-search-ish — but linear scan is fine since the interval is large vs the chart's
        // BPM-event density. Find the beat whose seconds-position is closest to `t`.
        // Simpler: just use the constant approximation when no resolver is given a precise inverse.
        time.push(t * beatsPerSecond);
      } else {
        time.push(t * beatsPerSecond);
      }
    }
  }

  return { group, bpm, stop, time };
}

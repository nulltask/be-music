// Compute the wallclock duration of a parsed BMS chart.
//
// "Chart duration" is the time from beat 0 to the last sound-emitting event in the chart
// (audible notes + BGM autoplay channel). The select scene exposes this through beatoraja's
// `value[]` resolver as `SONGLENGTH_MINUTE` / `SONGLENGTH_SECOND` (refs 1163 / 1164) — without
// it, ModernChic's left-pane info panel sits at "00:00".
//
// The math walks events in beat order and accumulates time across BPM segments, with channel
// `09` STOP events adding their resolved stop duration. Returns 0 for charts that contain no
// sound events at all (degenerate / metadata-only chart).
//
// Cached per-chart; the result is stable for the chart's lifetime.

import type { BeMusicEvent, BeMusicJson } from '@be-music/json';

/** Standard 4-beat measure baseline. Authors override via `chart.measures[].length`. */
const BEATS_PER_STANDARD_MEASURE = 4;

/**
 * BMS STOP event units. Channel `09` references `#STOPxx` (a stop table); each value is the
 * stop length expressed as 1/192-of-a-measure increments. So `STOP01 = 192` means "stop for one
 * full 4-beat measure". We convert to beats by `stopUnits / 192 * 4`.
 */
const STOP_UNITS_PER_MEASURE = 192;

/**
 * Compute the chart's wallclock duration in seconds. Returns 0 when the chart has no sound
 * events (no audible content → length 0).
 */
export function computeBeatorajaChartTotalSeconds(chart: BeMusicJson): number {
  const measureBaseBeat = computeMeasureBaseBeats(chart);
  if (measureBaseBeat.length === 0) return 0;

  // Find the latest sound-emitting event's beat — that's where the audible chart ends. We
  // include BGM autoplay (`01`) in addition to playable / scratch / LN notes so charts that end
  // on a long BGM tail (= no playable notes near the end) still report the right length.
  let endBeat = 0;
  for (const event of chart.events ?? []) {
    if (!isSoundEmittingEvent(event)) continue;
    if (event.value === '00' || event.value === '') continue;
    const beat = eventBeat(event, measureBaseBeat);
    if (beat !== undefined && beat > endBeat) endBeat = beat;
  }
  if (endBeat <= 0) return 0;

  // Build the BPM segment list — beat → bpm transitions. Initial BPM is `metadata.bpm` (fall
  // back to 130 — beatoraja's default for malformed headers).
  const initialBpm = chart.metadata.bpm > 0 ? chart.metadata.bpm : 130;
  const bpmTable = chart.resources?.bpm ?? {};
  const stopTable = chart.resources?.stop ?? {};
  type Transition = { beat: number; kind: 'bpm'; bpm: number } | { beat: number; kind: 'stop'; durationBeats: number };
  const transitions: Transition[] = [];
  for (const event of chart.events ?? []) {
    if (event.value === '00' || event.value === '') continue;
    const beat = eventBeat(event, measureBaseBeat);
    if (beat === undefined) continue;
    if (event.channel === '03') {
      const parsed = parseInt(event.value, 16);
      if (Number.isFinite(parsed) && parsed > 0) {
        transitions.push({ beat, kind: 'bpm', bpm: parsed });
      }
    } else if (event.channel === '08') {
      const looked =
        bpmTable[event.value] ?? bpmTable[event.value.toLowerCase()] ?? bpmTable[event.value.toUpperCase()];
      const bpm =
        typeof looked === 'number' ? looked : typeof looked === 'string' ? Number.parseFloat(looked) : Number.NaN;
      if (Number.isFinite(bpm) && bpm > 0) {
        transitions.push({ beat, kind: 'bpm', bpm });
      }
    } else if (event.channel === '09') {
      const looked =
        stopTable[event.value] ?? stopTable[event.value.toLowerCase()] ?? stopTable[event.value.toUpperCase()];
      const stopUnits =
        typeof looked === 'number' ? looked : typeof looked === 'string' ? Number.parseFloat(looked) : Number.NaN;
      if (Number.isFinite(stopUnits) && stopUnits > 0) {
        const durationBeats = (stopUnits / STOP_UNITS_PER_MEASURE) * BEATS_PER_STANDARD_MEASURE;
        transitions.push({ beat, kind: 'stop', durationBeats });
      }
    }
  }
  // Sort by beat. Stops at the same beat as a BPM change apply to the NEW bpm — push them after
  // BPM changes by giving stops a slightly larger sort key on tie.
  transitions.sort((a, b) => {
    if (a.beat !== b.beat) return a.beat - b.beat;
    return a.kind === 'bpm' ? -1 : 1;
  });

  // Walk the segment list. `seconds` accumulates wallclock duration; `beat` is the running
  // chart-beat cursor; `bpm` is the active tempo.
  let seconds = 0;
  let cursorBeat = 0;
  let bpm = initialBpm;
  const beatsToSeconds = (beats: number, atBpm: number): number => {
    if (atBpm <= 0) return 0;
    return (beats * 60) / atBpm;
  };
  for (const t of transitions) {
    if (t.beat >= endBeat) break;
    if (t.beat > cursorBeat) {
      seconds += beatsToSeconds(t.beat - cursorBeat, bpm);
      cursorBeat = t.beat;
    }
    if (t.kind === 'bpm') {
      bpm = t.bpm;
    } else {
      seconds += beatsToSeconds(t.durationBeats, bpm);
    }
  }
  // Tail — from the last transition beat up to the chart end.
  if (endBeat > cursorBeat) {
    seconds += beatsToSeconds(endBeat - cursorBeat, bpm);
  }
  return seconds;
}

/** Channels whose events emit audible sound — playable / scratch / LN / BGM. */
function isSoundEmittingEvent(event: BeMusicEvent): boolean {
  const ch = event.channel;
  if (ch.length !== 2) return false;
  const lead = ch[0]!;
  // BGM autoplay = `01`; playable + LN = leading 1/2/5/6.
  if (ch === '01') return true;
  return lead === '1' || lead === '2' || lead === '5' || lead === '6';
}

/**
 * Compute each measure's start beat, summing the cumulative length of prior measures. Same
 * helper as in `beatoraja-chart-markers.ts` / `beatoraja-chart-bpm-curve.ts`.
 */
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

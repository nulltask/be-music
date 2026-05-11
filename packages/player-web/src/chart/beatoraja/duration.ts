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
import {
  beatorajaEventBeat,
  computeBeatorajaMeasureBaseBeats,
  hasBeatorajaEventValue,
  resolveBeatorajaBpmEventValue,
  resolveBeatorajaStopDurationBeats,
} from './timing.ts';

/**
 * Compute the chart's wallclock duration in seconds. Returns 0 when the chart has no sound
 * events (no audible content → length 0).
 */
export function computeBeatorajaChartTotalSeconds(chart: BeMusicJson): number {
  const measureBaseBeat = computeBeatorajaMeasureBaseBeats(chart);
  if (measureBaseBeat.length === 0) return 0;

  // Find the latest sound-emitting event's beat — that's where the audible chart ends. We
  // include BGM autoplay (`01`) in addition to playable / scratch / LN notes so charts that end
  // on a long BGM tail (= no playable notes near the end) still report the right length.
  let endBeat = 0;
  for (const event of chart.events ?? []) {
    if (!isSoundEmittingEvent(event)) continue;
    if (!hasBeatorajaEventValue(event.value)) continue;
    const beat = beatorajaEventBeat(event, measureBaseBeat);
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
    if (!hasBeatorajaEventValue(event.value)) continue;
    const beat = beatorajaEventBeat(event, measureBaseBeat);
    if (beat === undefined) continue;
    if (event.channel === '03') {
      const bpm = resolveBeatorajaBpmEventValue(event.channel, event.value, bpmTable);
      if (bpm !== undefined && bpm > 0) {
        transitions.push({ beat, kind: 'bpm', bpm });
      }
    } else if (event.channel === '08') {
      const bpm = resolveBeatorajaBpmEventValue(event.channel, event.value, bpmTable);
      if (bpm !== undefined && bpm > 0) {
        transitions.push({ beat, kind: 'bpm', bpm });
      }
    } else if (event.channel === '09') {
      const durationBeats = resolveBeatorajaStopDurationBeats(event.value, stopTable);
      if (durationBeats !== undefined) {
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

import { getPlayModeLayouts } from '@be-music/chart-model';
import type { PreparedPlaybackChartData } from './bootstrap.ts';
import { createInputTokenToChannelsMap, createLaneBindings, resolveLaneDisplayMode } from './lane-layout.ts';
import { withChartOverrides } from './resolved-chart-overrides.ts';
import type { TimedPlayableNote, TimedLandmineNote } from '../playable-notes.ts';

export type SevenToNinePattern = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type SevenToNineType = 0 | 1 | 2;
export interface SevenToNineOptions {
  sevenToNinePattern?: SevenToNinePattern;
  sevenToNineType?: SevenToNineType;
  hRandomThresholdBPM?: number;
}

const SOURCE_CHANNELS = ['11', '12', '13', '14', '15', '18', '19', '16'];
// [first key, scratch, spare], in zero-based POPN lane order.
const PATTERNS = [
  [2, 1, 0],
  [1, 0, 8],
  [2, 0, 1],
  [2, 1, 0],
  [0, 7, 8],
  [0, 8, 7],
  [1, 8, 0],
] as const;

/**
 * beatoraja 0.8.9 ModeModifier, after lane randomization. Mutates only the fresh
 * prepared play; source event channels remain the identities recorded by replays.
 * Long-note tails release their reserved destination after that row's mapping.
 */
export function applySevenToNine(chart: PreparedPlaybackChartData, options: SevenToNineOptions = {}): void {
  const pattern = options.sevenToNinePattern ?? 0;
  const type = options.sevenToNineType ?? 0;
  if (!Number.isInteger(pattern) || pattern < 0 || pattern > 6 || !Number.isInteger(type) || type < 0 || type > 2)
    throw new RangeError('Invalid beatoraja 7-to-9 pattern or scratch type.');
  const bpm = options.hRandomThresholdBPM ?? 120;
  if (!Number.isFinite(bpm)) throw new RangeError('Invalid beatoraja 7-to-9 threshold BPM.');
  chart.sevenToNinePattern = pattern;
  chart.sevenToNineType = type;
  chart.sevenToNineThresholdBPM = bpm;
  chart.sevenToNineApplied = pattern > 0 && chart.resolvedChart.playVariant === '7';
  if (!chart.sevenToNineApplied) return;
  // The upstream seven-key decoder has no slot for #17/FREE ZONE. Do not
  // accidentally turn that ignored source object into a judged ninth-mode key.
  const supported = (note: { channel: string }): boolean => SOURCE_CHANNELS.includes(note.channel);
  for (const notes of [chart.notes, chart.landmineNotes, chart.invisibleNotes])
    for (let index = notes.length - 1; index >= 0; index--) if (!supported(notes[index]!)) notes.splice(index, 1);
  chart.laneSoundNotes = chart.laneSoundNotes.filter(supported);
  if (chart.shadowedNotes) chart.shadowedNotes = chart.shadowedNotes.filter(supported);
  const [keyLane, scLane, restLane] = PATTERNS[pattern]!;
  // The Java source divides a float, then takes ceil, independent of playback speed.
  const threshold = bpm <= 0 ? 0 : Math.ceil(Math.fround(15000 / Math.fround(bpm)));
  const active = Array<number>(9).fill(-1);
  const ends = Array<number>(9).fill(-1);
  const last = Array<number>(9).fill(-100);
  type Note = TimedPlayableNote | TimedLandmineNote;
  type Cell = { note: Note; tail?: boolean; hidden?: boolean; source: number };
  const rows = new Map<number, Cell[]>();
  const add = (beat: number, cell: Cell): void => {
    const row = rows.get(beat) ?? [];
    row.push(cell);
    rows.set(beat, row);
  };
  for (const [notes, hidden] of [
    [chart.notes, false],
    [chart.landmineNotes, false],
    [chart.invisibleNotes, true],
  ] as const) {
    for (const note of notes) {
      const source = SOURCE_CHANNELS.indexOf(note.channel);
      if (source < 0) continue;
      add(note.beat, { note, source, hidden });
      if ('endBeat' in note && note.endBeat !== undefined) add(note.endBeat, { note, source, tail: true });
    }
  }
  for (const [beat, row] of [...rows].sort(([a], [b]) => a - b)) {
    // TimeLine.getTime truncates microseconds to integral milliseconds.
    const now = Math.trunc(chart.resolvedChart.timing.beatToSeconds(beat) * 1000);
    let scratchAtPrimary: boolean;
    if (active[scLane] !== -1 || active[restLane] !== -1) scratchAtPrimary = active[scLane] === 7;
    else if (type === 1) scratchAtPrimary = now - last[scLane]! > threshold || last[scLane]! <= last[restLane]!;
    else if (type === 2) scratchAtPrimary = last[scLane]! <= last[restLane]!;
    else scratchAtPrimary = true;
    for (const cell of row) {
      const destination = cell.source === 7 ? (scratchAtPrimary ? scLane : restLane) : keyLane + cell.source;
      if (!cell.tail) cell.note.channel = `1${destination + 1}`;
      if (cell.hidden) continue;
      if (cell.tail && now === ends[destination]) {
        active[destination] = -1;
        ends[destination] = -1;
      } else {
        if ('endBeat' in cell.note && cell.note.endBeat !== undefined) {
          active[destination] = cell.source;
          if (!cell.tail) ends[destination] = Math.trunc(cell.note.endSeconds! * 1000);
        }
        last[destination] = now;
      }
    }
  }
  chart.resolvedChart = withChartOverrides(chart.resolvedChart, { playVariant: '9', layouts: getPlayModeLayouts('9') });
  chart.laneBindings = createLaneBindings(['11', '12', '13', '14', '15', '16', '17', '18', '19'], { playVariant: '9' });
  chart.inputTokenToChannels = createInputTokenToChannelsMap(chart.laneBindings);
  chart.activeFreeZoneChannels = new Set();
  chart.scorableNotes = [...chart.notes];
  chart.laneDisplayMode = resolveLaneDisplayMode(
    chart.laneBindings.map((lane) => lane.channel),
    { playVariant: '9' },
  );
}

/**
 * The excerpt of a chart its share card shows: the notes of its densest stretch, laid out as lanes. Pure functions over
 * the chart's fingerprint document (the one stored at `charts/{fingerprint}.json`), so the Worker needs neither the
 * chart file nor a parser to draw it.
 */
import { getPlayModeLayouts, type ChartPlayVariant, type PlayLane } from '@be-music/chart';
import type { Box } from '../pages/share-card-safe-area.ts';
import type { ExcerptColor } from './palette.ts';

/** The parts of a fingerprint document (play or chart document) the excerpt reads. */
export interface ExcerptDocument {
  measures: { lengths: ReadonlyArray<readonly [string, string]> };
  notes: ReadonlyArray<{ m: string; p: string; lane: string; end?: { m: string; p: string } }>;
}

/** A note on the beat axis: where it starts and, for a long note, where it ends. */
export interface BeatNote {
  beat: number;
  endBeat?: number;
  /** The lane's visible channel, `11` .. `2Z`. */
  lane: string;
}

/** A rational of the fingerprint documents (`3`, `-1/2`, `3/4`) as a number. */
export function parseRational(value: string): number {
  const slash = value.indexOf('/');
  if (slash < 0) return Number(value);
  return Number(value.slice(0, slash)) / Number(value.slice(slash + 1));
}

/**
 * The beat where each measure starts, for measures 0 .. `count` (a measure is 4 beats unless `lengths` says otherwise,
 * in 4/4 measures).
 */
export function measureStartBeats(lengths: ExcerptDocument['measures']['lengths'], count: number): number[] {
  const byMeasure = new Map(lengths.map(([measure, length]) => [Number(measure), parseRational(length)]));
  const starts = [0];
  for (let measure = 0; measure < count; measure++) {
    starts.push((starts[measure] ?? 0) + 4 * (byMeasure.get(measure) ?? 1));
  }
  return starts;
}

/** The measures the document's notes reach: one past the last measure a note starts or ends in. */
export function documentMeasureCount(document: ExcerptDocument): number {
  let lastMeasure = 0;
  for (const note of document.notes) {
    lastMeasure = Math.max(lastMeasure, Number(note.m), note.end !== undefined ? Number(note.end.m) : 0);
  }
  return lastMeasure + 1;
}

/** The document's notes on the beat axis, in its order (by time, then lane). */
export function documentBeatNotes(document: ExcerptDocument): BeatNote[] {
  const starts = measureStartBeats(document.measures.lengths, documentMeasureCount(document));
  const beatAt = (m: string, p: string) => {
    const measure = Number(m);
    const start = starts[measure] ?? 0;
    return start + ((starts[measure + 1] ?? start + 4) - start) * parseRational(p);
  };
  return document.notes.map((note) => ({
    beat: beatAt(note.m, note.p),
    ...(note.end !== undefined ? { endBeat: beatAt(note.end.m, note.end.p) } : {}),
    lane: note.lane.toUpperCase(),
  }));
}

/** The stretch of a chart an excerpt shows: `beats` beats from `start`, holding `count` notes. */
export interface ExcerptWindow {
  start: number;
  beats: number;
  count: number;
}

/**
 * The window of `beats` beats with the most notes (counted by where they start), starting on a whole beat so bar lines
 * and the beat grid line up; the earliest such window wins a tie. `notes` must be sorted by beat. A chart without notes
 * gets the window at beat 0.
 */
export function densestWindow(notes: readonly BeatNote[], beats: number): ExcerptWindow {
  let best: ExcerptWindow = { start: 0, beats, count: 0 };
  // The candidates (each note's whole beat) ascend, so both ends of the window only move forward.
  let first = 0;
  let end = 0;
  for (const note of notes) {
    const start = Math.floor(note.beat);
    while (first < notes.length && (notes[first]?.beat ?? 0) < start) first++;
    while (end < notes.length && (notes[end]?.beat ?? 0) < start + beats) end++;
    if (end - first > best.count) best = { start, beats, count: end - first };
  }
  return best;
}

export interface ExcerptRect extends Box {
  color: ExcerptColor;
}

/** Where the excerpt goes: the lanes span `box` from top to bottom; the judge line sits at `judgeY`. */
export interface ExcerptFrame {
  box: Box;
  judgeY: number;
  /** The highest a note's head may be: the window's last beat lands here. */
  topY: number;
  noteHeight: number;
  judgeLineHeight: number;
}

/** The lanes of a lane mode, left to right as skins draw them; empty for a mode be-music does not know. */
export function excerptLanes(laneMode: string): readonly PlayLane[] {
  return getPlayModeLayouts(laneMode as ChartPlayVariant)[0]?.lanes ?? [];
}

function noteTone(lane: PlayLane): 'white' | 'blue' | 'red' {
  if (lane.kind !== 'key') return 'red';
  return lane.tone === 'black' ? 'blue' : 'white';
}

/**
 * The rectangles of an excerpt, back to front: lane backgrounds, bar lines, the judge line, long-note bodies, then
 * note heads. Lanes split `frame.box` in whole pixels; a note sits on its beat with its bottom edge, the window's start
 * on the judge line and later beats above it. Notes of lanes the mode does not have are left out.
 */
export function layoutExcerpt(
  notes: readonly BeatNote[],
  laneMode: string,
  window: ExcerptWindow,
  frame: ExcerptFrame,
  measureStarts: readonly number[] = [],
): ExcerptRect[] {
  const lanes = excerptLanes(laneMode);
  if (lanes.length === 0) return [];
  const { box } = frame;
  const laneLeft = (i: number) => box.x + Math.round((box.width * i) / lanes.length);
  const laneIndex = new Map(lanes.map((lane, i) => [lane.channel, i]));
  const pixelsPerBeat = (frame.judgeY - frame.topY) / window.beats;
  const yOf = (beat: number) => frame.judgeY - (beat - window.start) * pixelsPerBeat;
  const rects: ExcerptRect[] = [];
  lanes.forEach((lane, i) => {
    rects.push({
      x: laneLeft(i),
      y: box.y,
      width: laneLeft(i + 1) - laneLeft(i),
      height: box.height,
      color: lane.kind === 'key' && lane.tone === 'black' ? 'lane-dark' : 'lane-light',
    });
  });
  for (const beat of measureStarts) {
    if (beat < window.start || beat > window.start + window.beats) continue;
    rects.push({ x: box.x, y: Math.round(yOf(beat)) - 1, width: box.width, height: 2, color: 'bar-line' });
  }
  rects.push({
    x: box.x,
    y: frame.judgeY,
    width: box.width,
    height: frame.judgeLineHeight,
    color: 'judge-line',
  });
  const visible = notes.filter((note) => note.beat >= window.start && note.beat < window.start + window.beats);
  const heads: ExcerptRect[] = [];
  for (const note of visible) {
    const i = laneIndex.get(note.lane);
    const lane = i !== undefined ? lanes[i] : undefined;
    if (i === undefined || lane === undefined) continue;
    const tone = noteTone(lane);
    const x = laneLeft(i) + 2;
    const width = laneLeft(i + 1) - laneLeft(i) - 4;
    const bottom = Math.round(yOf(note.beat));
    if (note.endBeat !== undefined && note.endBeat > note.beat) {
      // The body runs up to the end, or off the top of the lanes.
      const top = Math.max(box.y, Math.round(yOf(note.endBeat)));
      const inset = Math.max(2, Math.round(width / 6));
      rects.push({ x: x + inset, y: top, width: width - inset * 2, height: bottom - top, color: `long-${tone}` });
      if (top > box.y) {
        heads.push({ x, y: top, width, height: frame.noteHeight, color: `note-${tone}` });
      }
    }
    heads.push({ x, y: bottom - frame.noteHeight, width, height: frame.noteHeight, color: `note-${tone}` });
  }
  return [...rects, ...heads];
}

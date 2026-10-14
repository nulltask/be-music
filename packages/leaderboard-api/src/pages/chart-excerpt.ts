/**
 * The excerpt of a chart a score card shows on its playfield: the notes of the chart's densest stretch, by lane. Pure
 * functions over the chart's fingerprint document (the one stored at `charts/{fingerprint}.json`), free of DOM, Worker
 * and chart-package imports, so the Worker and the client script can both use them.
 */

/** The parts of a fingerprint document (play or chart document) the excerpt reads. */
export interface ExcerptDocument {
  measures: { lengths: ReadonlyArray<readonly [string, string]> };
  notes: ReadonlyArray<{ m: string; p: string; lane: string; end?: { m: string; p: string } }>;
}

/** A note on the beat axis: where it starts and, for a long note, where it ends. */
export interface BeatNote {
  beat: number;
  endBeat?: number;
  /** The lane's visible channel, `11` .. `2Z`, upper case. */
  lane: string;
}

/** The colour of a lane's notes, as the usual BMS lanes: white and blue keys, a red scratch. */
export type ExcerptTone = 'white' | 'blue' | 'red';

/** The excerpt a score card draws: its lanes left to right, and the window's notes and bar lines. */
export interface ChartExcerpt {
  lanes: ExcerptTone[];
  /** The window's length in beats; beats below count from its start. */
  beats: number;
  /** `lane` indexes `lanes`; `end` is a long note's end, which may lie past the window. */
  notes: Array<{ lane: number; beat: number; end?: number }>;
  /** Where measures start inside the window. */
  bars: number[];
}

/** The excerpt's length: two 4/4 measures. */
export const EXCERPT_BEATS = 8;

/** The most lanes a card's playfield shows readably (14 KEY's 16); wider modes keep the decorative playfield. */
export const MAX_EXCERPT_LANES = 16;

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

/** The document's notes on the beat axis, sorted by beat. */
export function documentBeatNotes(document: ExcerptDocument): BeatNote[] {
  const starts = measureStartBeats(document.measures.lengths, documentMeasureCount(document));
  const beatAt = (m: string, p: string) => {
    const measure = Number(m);
    const start = starts[measure] ?? 0;
    return start + ((starts[measure + 1] ?? start + 4) - start) * parseRational(p);
  };
  return document.notes
    .map((note) => ({
      beat: beatAt(note.m, note.p),
      ...(note.end !== undefined ? { endBeat: beatAt(note.end.m, note.end.p) } : {}),
      lane: note.lane.toUpperCase(),
    }))
    .sort((a, b) => a.beat - b.beat);
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

/**
 * The excerpt of `document` on `lanes` (left to right, each its visible channel and tone): the densest window's notes,
 * relative to its start, on the lanes they belong to. Null when there is nothing to draw: no lanes, too many to read,
 * or no note on them.
 */
export function chartExcerpt(
  document: ExcerptDocument,
  lanes: ReadonlyArray<{ channel: string; tone: ExcerptTone }>,
  beats = EXCERPT_BEATS,
): ChartExcerpt | null {
  if (lanes.length === 0 || lanes.length > MAX_EXCERPT_LANES) return null;
  const laneIndex = new Map(lanes.map((lane, i) => [lane.channel.toUpperCase(), i]));
  const notes = documentBeatNotes(document).filter((note) => laneIndex.has(note.lane));
  if (notes.length === 0) return null;
  const window = densestWindow(notes, beats);
  const bars = measureStartBeats(document.measures.lengths, documentMeasureCount(document))
    .filter((beat) => beat >= window.start && beat <= window.start + beats)
    .map((beat) => beat - window.start);
  return {
    lanes: lanes.map((lane) => lane.tone),
    beats,
    notes: notes
      .filter((note) => note.beat >= window.start && note.beat < window.start + beats)
      .map((note) => ({
        lane: laneIndex.get(note.lane) ?? 0,
        beat: note.beat - window.start,
        ...(note.endBeat !== undefined && note.endBeat > note.beat ? { end: note.endBeat - window.start } : {}),
      })),
    bars,
  };
}

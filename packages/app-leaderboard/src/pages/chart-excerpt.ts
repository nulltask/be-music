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

/** One lane of an excerpt: its notes' colour and the side (bank) it belongs to. */
export interface ExcerptLane {
  tone: ExcerptTone;
  side: '1P' | '2P';
}

/**
 * How the lanes share the playfield's width, as the Synesthesia skin lays them out: `iidx` gives each lane a fixed
 * width by kind (scratch, white key, blue key) and parts double play's banks; `shared` splits one side's width evenly
 * (9 KEY).
 */
export type ExcerptLaneWidths = 'iidx' | 'shared';

/** The excerpt a score card draws: its lanes left to right, and the window's notes and bar lines. */
export interface ChartExcerpt {
  lanes: ExcerptLane[];
  widths: ExcerptLaneWidths;
  /** The window's length in beats; beats below count from its start. */
  beats: number;
  /** `lane` indexes `lanes`; `end` is a long note's end, which may lie past the window. */
  notes: Array<{ lane: number; beat: number; end?: number }>;
  /** Where measures start inside the window. */
  bars: number[];
}

/**
 * The Synesthesia skin's playfield in its design pixels (the standard landscape layout,
 * `resolveGameplayLaneGeometry` in packages/player-skin-sdk/src/touch-layout.ts). Mirrored rather than imported: the skin SDK
 * pulls in the player package, which neither the Worker nor the card's client script bundles.
 * - lane widths by kind: `IIDX_LANE_WIDTHS` (packages/player-skin-sdk/src/lane-geometry.ts:21), used for 5 / 7 / 10 / 14 KEY;
 * - the gap between double play's banks: `IIDX_DP_SIDE_GAP` (packages/player-skin-sdk/src/lane-geometry.ts:28);
 * - one side's width (shared out evenly in 9 KEY) and the playfield's height from its top to the judgement line:
 *   `PLAYFIELD` (packages/player-skin-sdk/src/playfield.ts:6, `w: 194`, `y: 0`, `judgementY: 321`).
 */
export const SYNESTHESIA_PLAYFIELD = {
  laneWidths: { scratch: 41, white: 24, black: 19 },
  sideGap: 60,
  sideWidth: 194,
  height: 321,
} as const;

/**
 * The scroll speed the excerpt shows: Synesthesia at HIGH SPEED 2.0, the play's default (`hiSpeed = 2.0`), at which
 * the shared playfield (packages/player-browser/src/view/shared/playfield/notes.ts) moves notes `PIXELS_PER_BEAT * hiSpeed`
 * design pixels a beat (`PIXELS_PER_BEAT = 72`, packages/player-browser/src/stage/design.ts:3).
 */
export const EXCERPT_PIXELS_PER_BEAT = 72 * 2;

/** The excerpt's length: the beats Synesthesia's playfield shows at that speed, 321 / 144 = 2.23. */
export const EXCERPT_BEATS = SYNESTHESIA_PLAYFIELD.height / EXCERPT_PIXELS_PER_BEAT;

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
  lanes: ReadonlyArray<{ channel: string } & ExcerptLane>,
  widths: ExcerptLaneWidths,
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
    lanes: lanes.map((lane) => ({ tone: lane.tone, side: lane.side })),
    widths,
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

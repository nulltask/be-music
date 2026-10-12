import type { ResolvedChart, ScrollTimelinePoint, SpeedTimelinePoint } from '@be-music/chart';
import type { ScrollDistanceMapperLike } from '@be-music/player/core/scroll-distance';

/**
 * Whose note-visibility rules the gameplay view follows this play.
 *
 * - `'lr2'` — notes, mines and bar lines draw while their scrolled position lies between the lane top and the
 *   judgement line, and the walk over the chart ends once a beat lies past the lane top. A late note the player has
 *   not hit yet keeps drawing until it scrolls past the line (or is judged).
 * - `'beatoraja'` — beatoraja's `LaneRenderer`: walk the chart in order from the playhead and stop after the first
 *   timeline past the lane top (drawn in the band above it), so nothing beyond it draws, even what a later negative
 *   `#SCROLL` brings back down. A note, mine or bar line whose time has come is gone, judged or not; a long note stays
 *   while its end is ahead.
 *
 * LR2 has no `#SCROLL` / `#SPEED`, so a chart with either is drawn by beatoraja's rules whatever the ruleset (unless
 * every point is 1, see {@link changesScrollRate}); so is any chart judged under the `beatoraja` ruleset.
 */
export type NoteDrawRules = 'lr2' | 'beatoraja';

/**
 * Whether a chart's `#SCROLL` / `#SPEED` points change how it scrolls: some point other than 1. A chart whose points are
 * all 1 scrolls as one without any, so it needs no distance integrator and keeps the judge ruleset's drawing rules.
 */
export function changesScrollRate(
  scroll: ReadonlyArray<ScrollTimelinePoint>,
  speed: ReadonlyArray<SpeedTimelinePoint>,
): boolean {
  return scroll.some((point) => point.speed !== 1) || speed.some((point) => point.speed !== 1);
}

export function resolveNoteDrawRules(scrolling: boolean, judgeRuleset: string): NoteDrawRules {
  return scrolling || judgeRuleset === 'beatoraja' ? 'beatoraja' : 'lr2';
}

/** What one frame draws of the chart: the playhead and how far up the lane the walk over the chart goes. */
export interface NoteDrawWindow {
  rules: NoteDrawRules;
  currentBeat: number;
  /** Chart time of the playhead, in seconds. */
  nowSeconds: number;
  /** The walk over the beat-sorted notes, mines and bar lines stops past this beat. */
  lastBeat: number;
  /** Bottom edge of the stage, in the lanes' coordinates (y grows downward). */
  stageBottomY: number;
}

export interface NoteDrawWindowInput {
  rules: NoteDrawRules;
  currentBeat: number;
  nowSeconds: number;
  /**
   * The `#SCROLL` / `#SPEED` distance integrator, when the chart has either. One without `firstBeatBeyondDistance`
   * gives the walk no early exit.
   */
  mapper?: Pick<ScrollDistanceMapperLike, 'firstBeatBeyondDistance'>;
  /** The lane's height in beats of scroll distance (lane pixels over pixels per beat). */
  laneBeats: number;
  /**
   * Beats of the chart's lane timelines ({@link collectLaneTimelineBeats}), sorted. Under beatoraja's rules the walk
   * also takes in the first of them past the lane top, as `LaneRenderer` does; omitted, it stops at the lane top.
   */
  timelineBeats?: ArrayLike<number>;
  /** How far above the lane top the LR2 rules still visit, in beats of scroll distance. */
  overscanBeats: number;
  /** Bottom edge of the stage, in the lanes' coordinates (y grows downward). Omitted: the judgement line. */
  stageBottomY?: number;
}

export function resolveNoteDrawWindow(input: NoteDrawWindowInput): NoteDrawWindow {
  const { rules, currentBeat, nowSeconds, mapper, laneBeats, overscanBeats, timelineBeats, stageBottomY = 0 } = input;
  let lastBeat: number;
  if (rules === 'beatoraja') {
    // `LaneRenderer` draws each timeline and then checks `y <= hu`, so the loop stops after drawing the first timeline
    // whose y passed the lane top: that timeline's objects show in the band above the lane, and nothing after it does.
    // `overrunBeat` is where the chart first runs past the lane top; the first timeline after it is the last one drawn.
    const overrunBeat = mapper
      ? (mapper.firstBeatBeyondDistance?.(currentBeat, laneBeats) ?? Number.POSITIVE_INFINITY)
      : currentBeat + laneBeats;
    lastBeat = timelineBeats ? firstBeatAfter(timelineBeats, overrunBeat) : overrunBeat;
  } else {
    lastBeat = mapper ? Number.POSITIVE_INFINITY : currentBeat + laneBeats + overscanBeats;
  }
  return { rules, currentBeat, nowSeconds, lastBeat, stageBottomY };
}

/**
 * The beats of the timelines beatoraja's `LaneRenderer` walks — every note (long-note ends included), mine, invisible
 * note, bar line, BPM change, STOP and `#SCROLL` / `#SPEED` point — sorted and without repeats. Each list may come in any
 * order.
 */
export function collectLaneTimelineBeats(...lists: ReadonlyArray<ArrayLike<number>>): Float64Array {
  let total = 0;
  for (const list of lists) total += list.length;
  const beats = new Float64Array(total);
  let offset = 0;
  for (const list of lists) {
    for (let index = 0; index < list.length; index += 1) beats[offset++] = list[index]!;
  }
  beats.sort();
  let unique = 0;
  for (let index = 0; index < beats.length; index += 1) {
    const beat = beats[index]!;
    if (!Number.isFinite(beat) || (unique > 0 && beats[unique - 1] === beat)) continue;
    beats[unique++] = beat;
  }
  return beats.subarray(0, unique);
}

/** {@link collectLaneTimelineBeats} over a resolved chart. */
export function collectResolvedLaneTimelineBeats(
  chart: Pick<ResolvedChart, 'notes' | 'mines' | 'invisibleNotes' | 'barLines' | 'timing' | 'scroll' | 'speed'>,
): Float64Array {
  const beatsOf = (points: ReadonlyArray<{ beat: number }>): number[] => points.map((point) => point.beat);
  const longNoteEnds: number[] = [];
  for (const note of chart.notes) {
    if (note.endBeat !== undefined) longNoteEnds.push(note.endBeat);
  }
  return collectLaneTimelineBeats(
    beatsOf(chart.notes),
    longNoteEnds,
    beatsOf(chart.mines),
    beatsOf(chart.invisibleNotes),
    chart.barLines,
    beatsOf(chart.timing.tempoPoints),
    beatsOf(chart.timing.stopPoints),
    beatsOf(chart.scroll),
    beatsOf(chart.speed),
  );
}

/** The first of the sorted `beats` strictly after `beat`, or `+Infinity` when none is. */
export function firstBeatAfter(beats: ArrayLike<number>, beat: number): number {
  if (!(beat < Number.POSITIVE_INFINITY)) return beat;
  let low = 0;
  let high = beats.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (beats[middle]! <= beat) low = middle + 1;
    else high = middle;
  }
  return low < beats.length ? beats[low]! : Number.POSITIVE_INFINITY;
}

/** Whether the walk over beat-sorted objects has gone past the frame's window (and can stop). */
export function isPastDrawWindow(window: NoteDrawWindow, beat: number): boolean {
  return beat > window.lastBeat;
}

/**
 * Whether a tap note, mine or bar line at chart time `seconds` still draws. beatoraja draws one only while
 * `tl.getMicroTime() >= microtime` — a note inside its late window that the player has not hit yet is already gone, as
 * is one under a STOP that began at its beat. LR2's rules leave it to the position (see {@link NoteDrawRules}).
 */
export function isDrawnAtTime(window: NoteDrawWindow, seconds: number): boolean {
  return window.rules !== 'beatoraja' || seconds >= window.nowSeconds;
}

/**
 * Whether a long note ending at chart time `endSeconds` still draws: under beatoraja's rules while its end is ahead —
 * not reached yet, held, or let go with its tail still to come (`LaneRenderer` checks the pair's time). LR2's rules
 * leave it to the position.
 */
export function isLongNoteDrawnAtTime(window: NoteDrawWindow, endSeconds: number): boolean {
  return window.rules !== 'beatoraja' || endSeconds >= window.nowSeconds;
}

/**
 * The lowest y (largest value) an object in a lane whose judgement line is at `judgementY` may be drawn at. LR2's
 * rules stop at the line. beatoraja's `LaneRenderer` does not clip, so a note a negative `#SCROLL` puts below the line
 * while its time is still ahead is drawn there; beatoraja's rules let it run down to the bottom of the stage.
 */
export function resolveDrawBottom(window: NoteDrawWindow, judgementY: number): number {
  return window.rules === 'beatoraja' ? Math.max(judgementY, window.stageBottomY) : judgementY;
}

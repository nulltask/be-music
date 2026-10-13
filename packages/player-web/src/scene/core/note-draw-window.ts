import type { ResolvedChart, ScrollTimelinePoint, SpeedTimelinePoint, TempoReversalPoint } from '@be-music/chart';
import type { ScrollDistanceMapperLike } from '@be-music/player/core/scroll-distance';

/**
 * Whose note-visibility rules the gameplay view follows this play. Drawing is not part of a judge ruleset, so the
 * ruleset plays no part in the choice: every chart draws by LR2's rules, and only one LR2 cannot play (with `#SCROLL` /
 * `#SPEED`) draws by beatoraja's.
 *
 * - `'lr2'` — LR2's `DrawNotes` (`LR2body.exe` 0x406710). A note, mine or bar line scrolls down to the judgement line
 *   and stays on it once its beat has passed (its y is capped at the line, never drawn below it). A note or mine goes
 *   only once it is judged and its beat has reached the playhead (a long note: its end), so a late note the player has
 *   not hit yet sits on the line until it is judged a miss, and a note hit early keeps scrolling down to the line. On an
 *   auto lane a note goes once its beat has passed. A long note's head stays on the line until the note goes. A bar
 *   line goes once the playhead passes it, so a STOP that begins on one holds it on the line. The walk over the chart
 *   ends once a beat lies past the lane top.
 * - `'beatoraja'` — beatoraja's `LaneRenderer`: walk the chart in order from the playhead and stop after the first
 *   timeline past the lane top (drawn in the band above it), so nothing beyond it draws, even what a later negative
 *   `#SCROLL` brings back down. A note, mine or bar line whose time has come is gone, judged or not; a long note stays
 *   while its end is ahead, its head on the judgement line once passed.
 *
 * LR2 has no `#SCROLL` / `#SPEED`, so a chart with either is drawn by beatoraja's rules (unless every point is 1, see
 * {@link changesScrollRate}).
 */
export type NoteDrawRules = 'lr2' | 'beatoraja';

/**
 * Whether a chart's `#SCROLL` / `#SPEED` points change how it scrolls: some point other than 1. A chart whose points are
 * all 1 scrolls as one without any, so it needs no distance integrator and keeps LR2's drawing rules.
 */
export function changesScrollRate(
  scroll: ReadonlyArray<ScrollTimelinePoint>,
  speed: ReadonlyArray<SpeedTimelinePoint>,
): boolean {
  return scroll.some((point) => point.speed !== 1) || speed.some((point) => point.speed !== 1);
}

/** The drawing rules for a chart: beatoraja's when it scrolls ({@link changesScrollRate}), LR2's otherwise. */
export function resolveNoteDrawRules(scrolling: boolean): NoteDrawRules {
  return scrolling ? 'beatoraja' : 'lr2';
}

/** What one frame draws of the chart: the playhead and how far up the lane the walk over the chart goes. */
export interface NoteDrawWindow {
  rules: NoteDrawRules;
  currentBeat: number;
  /** Chart time of the playhead, in seconds. */
  nowSeconds: number;
  /**
   * The furthest beat the playhead has reached. It is `currentBeat` except past an LR2 negative-BPM reversal, where the
   * mirrored playhead runs back while what it passed stays passed ({@link resolveReversedDrawClock}).
   */
  reachedBeat: number;
  /** The walk over the beat-sorted notes, mines and bar lines stops past this beat. */
  lastBeat: number;
  /** Bottom edge of the stage, in the lanes' coordinates (y grows downward). */
  stageBottomY: number;
}

export interface NoteDrawWindowInput {
  rules: NoteDrawRules;
  currentBeat: number;
  nowSeconds: number;
  /** The furthest beat the playhead has reached ({@link NoteDrawWindow.reachedBeat}). Omitted: `currentBeat`. */
  reachedBeat?: number;
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
  const {
    rules,
    currentBeat,
    nowSeconds,
    reachedBeat = currentBeat,
    mapper,
    laneBeats,
    overscanBeats,
    timelineBeats,
    stageBottomY = 0,
  } = input;
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
  return { rules, currentBeat, nowSeconds, reachedBeat, lastBeat, stageBottomY };
}

/** The playhead a frame draws from ({@link resolveReversedDrawClock}). */
export interface ReversedDrawClock {
  /** Chart time the drawing rules compare object times against, in seconds. */
  nowSeconds: number;
  /** The furthest beat the playhead has reached. */
  reachedBeat: number;
}

/**
 * The draw clock past an LR2 negative-BPM reversal, for a frame at chart time `nowSeconds` whose (mirrored) display
 * beat is `displayBeat`. Before the reversal, or without one, it is the frame's own. Past it the scroll runs back from
 * the reversal while the judge clock reads `2R − now` (`toJudgeClock`), so an object's time is compared with that
 * mirrored clock, and the furthest beat reached stays the reversal's: an object the playhead passed before the
 * reversal does not come back as the scroll recedes, as LR2's `draw_count` never moves back.
 */
export function resolveReversedDrawClock(
  reversal: TempoReversalPoint | undefined,
  nowSeconds: number,
  displayBeat: number,
): ReversedDrawClock {
  if (reversal === undefined || nowSeconds <= reversal.seconds) {
    return { nowSeconds, reachedBeat: displayBeat };
  }
  return { nowSeconds: 2 * reversal.seconds - nowSeconds, reachedBeat: reversal.beat };
}

/**
 * LR2's `draw_count` per object: once a note or mine has gone under LR2's rules ({@link isDrawnUntilJudged}) it stays
 * gone. Without a negative-BPM reversal the playhead only moves forward, so the per-frame test already never brings an
 * object back; past one the mirrored playhead runs back over objects that went before it, and LR2 does not draw them
 * again. {@link sync} starts over when the playhead's chart time moves back (a restart or a seek), not when the
 * reversal mirrors the scroll.
 */
export class GoneDrawObjects {
  private gone = new WeakSet<JudgedDrawObject>();
  private seconds = Number.NEGATIVE_INFINITY;

  /** Forgets every gone object when `nowSeconds` (the true chart time, not a mirrored one) moves back. */
  sync(nowSeconds: number): void {
    if (nowSeconds < this.seconds) {
      this.gone = new WeakSet();
    }
    this.seconds = nowSeconds;
  }

  /** Whether `object` has gone by this frame or an earlier one. */
  isGone(window: NoteDrawWindow, object: JudgedDrawObject, autoplayed: boolean): boolean {
    if (this.gone.has(object)) return true;
    if (isDrawnUntilJudged(window, object, autoplayed)) return false;
    this.gone.add(object);
    return true;
  }
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
 * is one under a STOP that began at its beat. LR2's rules leave it to the judgement ({@link isDrawnUntilJudged}).
 */
export function isDrawnAtTime(window: NoteDrawWindow, seconds: number): boolean {
  return window.rules !== 'beatoraja' || seconds >= window.nowSeconds;
}

/**
 * Whether a long note ending at chart time `endSeconds` still draws: under beatoraja's rules while its end is ahead —
 * not reached yet, held, or let go with its tail still to come (`LaneRenderer` checks the pair's time). LR2's rules
 * leave it to the judgement ({@link isDrawnUntilJudged}).
 */
export function isLongNoteDrawnAtTime(window: NoteDrawWindow, endSeconds: number): boolean {
  return window.rules !== 'beatoraja' || endSeconds >= window.nowSeconds;
}

/**
 * The lowest y (largest value) an object in a lane whose judgement line is at `judgementY` may be drawn at. LR2's
 * rules stop at the line (and {@link resolveDrawY} holds a passed object there). beatoraja's `LaneRenderer` does not
 * clip, so a note a negative `#SCROLL` puts below the line while its time is still ahead is drawn there; beatoraja's
 * rules let it run down to the bottom of the stage.
 */
export function resolveDrawBottom(window: NoteDrawWindow, judgementY: number): number {
  return window.rules === 'beatoraja' ? Math.max(judgementY, window.stageBottomY) : judgementY;
}

/** What {@link isDrawnUntilJudged} reads off a note, long note or mine: the engine's own `judged` flag. */
export interface JudgedDrawObject {
  beat: number;
  /** A long note's end beat. */
  endBeat?: number;
  judged: boolean;
}

/**
 * Whether a tap note, long note or mine still draws under LR2's rules: LR2 draws a lane's objects from its
 * `draw_count` and advances it past an object only once the object is processed (`active == -1`) and the playhead has
 * reached both its beat and its long-note end (`DrawNotes` 0x407af0-0x407b4c). Nothing else clears an object — a hit
 * only marks it processed — so a note judged early keeps scrolling down to the line and goes at its own beat, and one
 * the player has not hit sits on the line until it is judged a miss (the ruleset's late window, through `judged`). On
 * an auto lane (`autoplayed`) the object goes once the playhead reaches its beat or end, judged or not
 * (0x407cd1-0x407d45). LR2 also draws the object once more on the frame it goes; be-music drops it on that frame.
 *
 * beatoraja's rules leave it to the time ({@link isDrawnAtTime}, {@link isLongNoteDrawnAtTime}).
 */
export function isDrawnUntilJudged(window: NoteDrawWindow, object: JudgedDrawObject, autoplayed: boolean): boolean {
  if (window.rules !== 'lr2') return true;
  return (object.endBeat ?? object.beat) > window.currentBeat || (!autoplayed && !object.judged);
}

/**
 * Where an object whose scrolled position is `y` draws in a lane whose judgement line is at `judgementY`. LR2 caps the
 * position at the line (`if (note_y > 0) note_y = 0`, `DrawNotes` 0x40746c-0x40748e; bar lines 0x406f18-0x406f34), so
 * a passed object that is still drawn sits on the line. beatoraja's rules leave the position as it is.
 */
export function resolveDrawY(window: NoteDrawWindow, y: number, judgementY: number): number {
  return window.rules === 'lr2' && y > judgementY ? judgementY : y;
}

/**
 * Opacity LR2 draws a long note at once it is processed before its end — the head missed, or the note let go early:
 * `0x80` of `0xff` (`DrawNotes` 0x407a25 / 0x407a8d).
 */
export const LR2_DROPPED_LONG_NOTE_ALPHA: number = 0x80 / 0xff;

/**
 * Opacity of a long note in its `state`: half once dropped ({@link LR2_DROPPED_LONG_NOTE_ALPHA}), otherwise full. This
 * is LR2's look and does not hang on the scroll model, so it applies under beatoraja's rules too (beatoraja itself
 * swaps the body image instead).
 */
export function resolveLongNoteAlpha(state: string | undefined): number {
  return state === 'dropped' ? LR2_DROPPED_LONG_NOTE_ALPHA : 1;
}

/**
 * LR2's `draw_count` over objects sorted by beat: the index of the first one not yet gone, starting from `cursor` (an
 * earlier call's result, or 0). Objects before it are past and stay so while the playhead moves on, so a frame need
 * not look at them; one still drawn — a missed note on the line, a long note held across many beats — keeps every
 * later object in reach. Call again from 0 when the playhead moves back or the objects change.
 */
export function advanceDrawCursor<T>(objects: ArrayLike<T>, cursor: number, isGone: (object: T) => boolean): number {
  let index = Math.max(0, cursor);
  while (index < objects.length && isGone(objects[index]!)) index += 1;
  return index;
}

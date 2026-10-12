import type { ScrollDistanceMapperLike } from '@be-music/player/core/scroll-distance';

/**
 * Whose note-visibility rules the gameplay view follows this play.
 *
 * - `'lr2'` — notes, mines and bar lines draw while their scrolled position lies between the lane top and the
 *   judgement line, and the walk over the chart ends once a beat lies past the lane top. A late note the player has
 *   not hit yet keeps drawing until it scrolls past the line (or is judged).
 * - `'beatoraja'` — beatoraja's `LaneRenderer`: walk the chart in order from the playhead and stop after the first
 *   object past the lane top, so nothing beyond it draws, even what a later negative `#SCROLL` brings back down. A
 *   note, mine or bar line whose time has come is gone, judged or not; a long note stays while its end is ahead.
 *
 * LR2 has no `#SCROLL` / `#SPEED`, so a chart with either is drawn by beatoraja's rules whatever the ruleset; so is any
 * chart judged under the `beatoraja` ruleset.
 */
export type NoteDrawRules = 'lr2' | 'beatoraja';

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
  /** The `#SCROLL` / `#SPEED` distance integrator, when the chart has either. */
  mapper?: Pick<ScrollDistanceMapperLike, 'firstBeatBeyondDistance'>;
  /** The lane's height in beats of scroll distance (lane pixels over pixels per beat). */
  laneBeats: number;
  /** How far above the lane top the LR2 rules still visit, in beats of scroll distance. */
  overscanBeats: number;
  /** Bottom edge of the stage, in the lanes' coordinates (y grows downward). Omitted: the judgement line. */
  stageBottomY?: number;
}

export function resolveNoteDrawWindow(input: NoteDrawWindowInput): NoteDrawWindow {
  const { rules, currentBeat, nowSeconds, mapper, laneBeats, overscanBeats, stageBottomY = 0 } = input;
  let lastBeat: number;
  if (rules === 'beatoraja') {
    // `LaneRenderer` stops after the first timeline whose y passed the lane top (`y <= hu` guards the loop). Between
    // two timelines the position moves monotonically, so stopping at the first beat that overruns the lane draws the
    // same notes: whatever lies between that beat and the next timeline is above the lane top anyway.
    lastBeat = mapper ? mapper.firstBeatBeyondDistance(currentBeat, laneBeats) : currentBeat + laneBeats;
  } else {
    lastBeat = mapper ? Number.POSITIVE_INFINITY : currentBeat + laneBeats + overscanBeats;
  }
  return { rules, currentBeat, nowSeconds, lastBeat, stageBottomY };
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

import type { ScrollDistanceMapperLike } from '@be-music/player/core/scroll-distance';

/**
 * Whose note-visibility rules the gameplay view follows this play.
 *
 * - `'lr2'` — notes, mines and bar lines draw while their scrolled position lies between the lane top and the
 *   judgement line, and the walk over the chart ends once a beat lies past the lane top.
 * - `'beatoraja'` — beatoraja's `LaneRenderer`: walk the chart in order from the playhead and stop after the first
 *   object past the lane top, so nothing beyond it draws, even what a later negative `#SCROLL` brings back down.
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
  /** The walk over the beat-sorted notes, mines and bar lines stops past this beat. */
  lastBeat: number;
}

export interface NoteDrawWindowInput {
  rules: NoteDrawRules;
  currentBeat: number;
  /** The `#SCROLL` / `#SPEED` distance integrator, when the chart has either. */
  mapper?: Pick<ScrollDistanceMapperLike, 'firstBeatBeyondDistance'>;
  /** The lane's height in beats of scroll distance (lane pixels over pixels per beat). */
  laneBeats: number;
  /** How far above the lane top the LR2 rules still visit, in beats of scroll distance. */
  overscanBeats: number;
}

export function resolveNoteDrawWindow(input: NoteDrawWindowInput): NoteDrawWindow {
  const { rules, currentBeat, mapper, laneBeats, overscanBeats } = input;
  let lastBeat: number;
  if (rules === 'beatoraja') {
    // `LaneRenderer` stops after the first timeline whose y passed the lane top (`y <= hu` guards the loop). Between
    // two timelines the position moves monotonically, so stopping at the first beat that overruns the lane draws the
    // same notes: whatever lies between that beat and the next timeline is above the lane top anyway.
    lastBeat = mapper ? mapper.firstBeatBeyondDistance(currentBeat, laneBeats) : currentBeat + laneBeats;
  } else {
    lastBeat = mapper ? Number.POSITIVE_INFINITY : currentBeat + laneBeats + overscanBeats;
  }
  return { rules, currentBeat, lastBeat };
}

/** Whether the walk over beat-sorted objects has gone past the frame's window (and can stop). */
export function isPastDrawWindow(window: NoteDrawWindow, beat: number): boolean {
  return beat > window.lastBeat;
}

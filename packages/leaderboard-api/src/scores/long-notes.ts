import type { BeMusicReplay } from '@be-music/player/replay';

/**
 * Whether a replay's chart had long notes: the notes the engine resolved and recorded as `long` (from `#LNTYPE` /
 * `#LNOBJ` / channels `5x` / `6x`, or bmson lengths). FREE ZONE notes are recorded as their own type and do not count.
 */
export function replayHasLongNotes(chart: Pick<BeMusicReplay['chart'], 'notes'>): boolean {
  return chart.notes.some((note) => note.type === 'long');
}

/**
 * The value a chart's `hasLongNotes` should take after a play, or `undefined` when it stays. Unknown (charts registered
 * before it was kept) takes the play's answer; once one play had long notes the chart has them, since `#RANDOM`
 * outcomes can differ.
 */
export function nextHasLongNotes(stored: boolean | null, played: boolean): boolean | undefined {
  if (stored === null) return played;
  return !stored && played ? true : undefined;
}

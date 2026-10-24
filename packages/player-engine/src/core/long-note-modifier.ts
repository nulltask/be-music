import type { LongNoteMode } from '@be-music/chart-model';
import type { TimedPlayableNote } from '../playable-notes.ts';

/** Applies the source's head-only modifier to fresh play notes, retaining the head's keysound and timing. */
export function removeLongNoteTails(
  notes: TimedPlayableNote[],
  mode: 'OFF' | 'LEGACY' | 'REMOVE',
  chartLNMode: LongNoteMode,
): number {
  if (mode === 'OFF') return 0;
  let changed = 0;
  for (const note of notes) {
    if (note.endSeconds === undefined || note.endSeconds <= note.seconds) continue;
    if (mode === 'LEGACY' && (note.longNoteMode ?? chartLNMode) !== 2) continue;
    delete note.endSeconds;
    delete note.endBeat;
    delete note.longNoteMode;
    delete note.visibleUntilBeat;
    changed += 1;
  }
  return changed;
}

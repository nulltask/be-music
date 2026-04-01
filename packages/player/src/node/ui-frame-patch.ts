import type { PlayerUiFrameNote, PlayerUiFramePayload } from '../core/ui-signal-bus.ts';

export interface PlayerUiFrameNoteStateUpdate {
  index: number;
  judged: boolean;
  visibleUntilBeat?: number;
}

export interface PlayerUiFramePatch
  extends Omit<PlayerUiFramePayload, 'notes' | 'landmineNotes' | 'invisibleNotes'> {
  notes?: PlayerUiFrameNote[];
  landmineNotes?: PlayerUiFrameNote[];
  invisibleNotes?: PlayerUiFrameNote[];
  noteStateUpdates?: PlayerUiFrameNoteStateUpdate[];
}

interface NoteStateSnapshot {
  judged: boolean;
  visibleUntilBeat?: number;
}

export function createUiFramePatchBuilder(): (frame: Readonly<PlayerUiFramePayload>) => PlayerUiFramePatch {
  let staticCollectionsSent = false;
  let lastNotes: ReadonlyArray<PlayerUiFrameNote> | undefined;
  let noteStateSnapshots: NoteStateSnapshot[] = [];

  return (frame) => {
    const notesChanged = lastNotes !== frame.notes;
    if (!staticCollectionsSent || notesChanged) {
      staticCollectionsSent = true;
      lastNotes = frame.notes;
      noteStateSnapshots = frame.notes.map((note) => ({
        judged: note.judged,
        visibleUntilBeat: note.visibleUntilBeat,
      }));
      return frame;
    }

    const noteStateUpdates: PlayerUiFrameNoteStateUpdate[] = [];
    for (let index = 0; index < frame.notes.length; index += 1) {
      const note = frame.notes[index]!;
      const previous = noteStateSnapshots[index];
      const nextVisibleUntilBeat = note.visibleUntilBeat;
      if (
        !previous ||
        previous.judged !== note.judged ||
        previous.visibleUntilBeat !== nextVisibleUntilBeat
      ) {
        noteStateSnapshots[index] = {
          judged: note.judged,
          visibleUntilBeat: nextVisibleUntilBeat,
        };
        noteStateUpdates.push({
          index,
          judged: note.judged,
          visibleUntilBeat: nextVisibleUntilBeat,
        });
      }
    }

    return {
      ...frame,
      notes: undefined,
      landmineNotes: undefined,
      invisibleNotes: undefined,
      noteStateUpdates: noteStateUpdates.length > 0 ? noteStateUpdates : undefined,
    };
  };
}

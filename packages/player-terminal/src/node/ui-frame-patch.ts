import type { PlayerUIFrameNote, PlayerUIFramePayload } from '@be-music/player-engine/signals';

export interface PlayerUIFrameNoteStateUpdate {
  index: number;
  judged: boolean;
  visibleUntilBeat?: number;
}

export interface PlayerUIFramePatch extends Omit<PlayerUIFramePayload, 'notes' | 'landmineNotes' | 'invisibleNotes'> {
  notes?: PlayerUIFrameNote[];
  landmineNotes?: PlayerUIFrameNote[];
  invisibleNotes?: PlayerUIFrameNote[];
  noteStateUpdates?: PlayerUIFrameNoteStateUpdate[];
}

interface NoteStateSnapshot {
  judged: boolean;
  visibleUntilBeat?: number;
}

export function createUIFramePatchBuilder(): (frame: Readonly<PlayerUIFramePayload>) => PlayerUIFramePatch {
  let staticCollectionsSent = false;
  let lastNotes: ReadonlyArray<PlayerUIFrameNote> | undefined;
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

    const noteStateUpdates: PlayerUIFrameNoteStateUpdate[] = [];
    for (let index = 0; index < frame.notes.length; index += 1) {
      const note = frame.notes[index]!;
      const previous = noteStateSnapshots[index];
      const nextVisibleUntilBeat = note.visibleUntilBeat;
      if (!previous || previous.judged !== note.judged || previous.visibleUntilBeat !== nextVisibleUntilBeat) {
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

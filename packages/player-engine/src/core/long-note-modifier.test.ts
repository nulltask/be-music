import { expect, test } from 'vite-plus/test';
import { removeLongNoteTails } from './long-note-modifier.ts';
import type { TimedPlayableNote } from '../playable-notes.ts';

function note(channel: string, longNoteMode?: 1 | 2 | 3): TimedPlayableNote {
  return {
    event: { channel, measure: 1, position: [0, 1], value: '01' } as TimedPlayableNote['event'],
    channel,
    beat: 4,
    seconds: 2,
    endBeat: 8,
    endSeconds: 4,
    longNoteMode,
    judged: false,
  };
}

test('OFF preserves all long-note modes', () => {
  const notes = [note('11', 1), note('12', 2), note('16', 3)];
  const before = structuredClone(notes);
  expect(removeLongNoteTails(notes, 'OFF', 1)).toBe(0);
  expect(notes).toEqual(before);
});

test('LEGACY removes charge-note and scratch tails but retains ordinary LN', () => {
  const notes = [note('11', 1), note('12', 2), note('16', 2), note('26', 3)];
  const event = notes[2]!.event;
  expect(removeLongNoteTails(notes, 'LEGACY', 1)).toBe(2);
  expect(notes[0]!.endSeconds).toBe(4);
  expect(notes[3]!.endSeconds).toBe(4);
  for (const value of notes.slice(1, 3)) {
    expect(value.endSeconds).toBeUndefined();
    expect(value.endBeat).toBeUndefined();
    expect(value.longNoteMode).toBeUndefined();
    expect(value.seconds).toBe(2);
  }
  expect(notes[2]!.event).toBe(event);
  expect(notes.map((value) => value.channel)).toEqual(['11', '12', '16', '26']);
});

test('LN REMOVE handles all modes and chart fallback without changing taps', () => {
  const tap = note('13');
  delete tap.endSeconds;
  delete tap.endBeat;
  const notes = [note('11', 1), note('12', 2), note('16', 3), note('26'), tap];
  expect(removeLongNoteTails(notes, 'REMOVE', 1)).toBe(4);
  expect(notes.every((value) => value.endSeconds === undefined)).toBe(true);
  expect(removeLongNoteTails(notes, 'REMOVE', 1)).toBe(0);
  expect(removeLongNoteTails([note('16')], 'LEGACY', 2)).toBe(1);
  expect(removeLongNoteTails([note('16')], 'LEGACY', 1)).toBe(0);
});

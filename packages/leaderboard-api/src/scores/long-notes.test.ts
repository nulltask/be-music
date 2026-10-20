import { describe, expect, test } from 'vite-plus/test';
import type { BeMusicReplay } from '@be-music/player/replay';
import { nextHasLongNotes, replayHasLongNotes } from './long-notes.ts';

const notes = (...types: Array<BeMusicReplay['chart']['notes'][number]['type']>) => ({
  notes: types.map((type, id) => ({ id, channel: '11', type, timeUs: id * 1000 })),
});

describe('replayHasLongNotes', () => {
  test('is true when any note is a long note', () => {
    expect(replayHasLongNotes(notes('normal', 'long', 'normal'))).toBe(true);
  });

  test('is false without long notes, FREE ZONE, mines and invisible notes aside', () => {
    expect(replayHasLongNotes(notes('normal', 'freezone', 'mine', 'invisible'))).toBe(false);
    expect(replayHasLongNotes(notes())).toBe(false);
  });
});

describe('nextHasLongNotes', () => {
  test('an unknown chart takes the play’s answer', () => {
    expect(nextHasLongNotes(null, true)).toBe(true);
    expect(nextHasLongNotes(null, false)).toBe(false);
  });

  test('a play with long notes marks a chart that had none so far', () => {
    expect(nextHasLongNotes(false, true)).toBe(true);
  });

  test('otherwise the chart keeps what it has', () => {
    expect(nextHasLongNotes(false, false)).toBeUndefined();
    expect(nextHasLongNotes(true, false)).toBeUndefined();
    expect(nextHasLongNotes(true, true)).toBeUndefined();
  });
});

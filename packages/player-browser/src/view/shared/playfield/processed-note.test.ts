import { expect, test } from 'vite-plus/test';
import { PROCESSED_NOTE_ALPHA, resolveProcessedNoteAlpha } from './processed-note.ts';

test('dims a judged note only while the option is on', () => {
  expect(resolveProcessedNoteAlpha(true, true)).toBe(PROCESSED_NOTE_ALPHA);
  expect(resolveProcessedNoteAlpha(true, false)).toBe(1);
  expect(resolveProcessedNoteAlpha(false, true)).toBe(1);
  expect(resolveProcessedNoteAlpha(undefined, true)).toBe(1);
  expect(resolveProcessedNoteAlpha(true, undefined)).toBe(1);
});

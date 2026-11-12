import { expect, test } from 'vite-plus/test';
import { resolveHiddenNoteChannels } from './hidden-note-channels.ts';

test('hides the AUTO SCRATCH lanes only while the option is HIDE', () => {
  const scratch = new Set(['16', '26']);
  expect(resolveHiddenNoteChannels('HIDE', scratch)).toBe(scratch);
  expect(resolveHiddenNoteChannels('SHOW', scratch)).toBeUndefined();
  expect(resolveHiddenNoteChannels(undefined, scratch)).toBeUndefined();
});

test('hides nothing while AUTO SCRATCH is off', () => {
  expect(resolveHiddenNoteChannels('HIDE', new Set())).toBeUndefined();
});

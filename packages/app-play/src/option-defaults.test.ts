import { expect, test } from 'vite-plus/test';
import { optionDefault } from './option-defaults.ts';

test('the startup defaults preserve false, zero and empty strings from the layout', () => {
  expect(optionDefault('autoPlay')).toBe(false);
  expect(optionDefault('judgeTimingMs')).toBe(0);
  expect(optionDefault('musicURL')).toBe('');
  expect(optionDefault('gauge')).toBe('GROOVE');
});

test('static defaults reject commands, runtime policies and unknown options', () => {
  for (const id of ['resetSettings', 'workers', 'unknown']) expect(() => optionDefault(id)).toThrow(id);
});

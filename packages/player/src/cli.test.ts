import { expect, test } from 'vitest';
import { parseArgs } from './cli.ts';

test('cli: --audio-backend を解析できる', () => {
  const parsed = parseArgs(['chart.bms', '--audio-backend', 'audio-io', '--auto']);
  expect(parsed.input).toBe('chart.bms');
  expect(parsed.audioBackend).toBe('audio-io');
  expect(parsed.auto).toBe(true);
});

test('cli: 不正な --audio-backend はエラーになる', () => {
  expect(() => parseArgs(['chart.bms', '--audio-backend', 'invalid-backend'])).toThrow(
    'Invalid --audio-backend value: invalid-backend',
  );
});

test('cli: --audio-backend 未指定時は undefined', () => {
  const parsed = parseArgs(['chart.bms']);
  expect(parsed.audioBackend).toBeUndefined();
});

test('cli: --preview で選曲プレビュー音声を有効化できる', () => {
  const parsed = parseArgs(['chart.bms', '--preview']);
  expect(parsed.previewAudio).toBe(true);
});

test('cli: デフォルトでは選曲プレビュー音声は無効', () => {
  const parsed = parseArgs(['chart.bms']);
  expect(parsed.previewAudio).toBe(false);
});

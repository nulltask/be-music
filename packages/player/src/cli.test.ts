import { expect, test } from 'vitest';
import type readline from 'node:readline';
import { parseArgs, resolveResultScreenActionFromKey } from './cli.ts';

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

test('cli: リザルト画面で r キーをリプレイとして解釈できる', () => {
  const action = resolveResultScreenActionFromKey('r', createKey());
  expect(action).toBe('replay');
});

test('cli: リザルト画面で Enter キーを選曲戻りとして解釈できる', () => {
  const action = resolveResultScreenActionFromKey(undefined, createKey('enter'));
  expect(action).toBe('enter');
});

test('cli: リザルト画面で Esc キーを終了として解釈できる', () => {
  const action = resolveResultScreenActionFromKey(undefined, createKey('escape', '\u001b'));
  expect(action).toBe('escape');
});

test('cli: リザルト画面で Ctrl+C を終了として解釈できる', () => {
  const action = resolveResultScreenActionFromKey(undefined, createKey(undefined, '\u0003'));
  expect(action).toBe('ctrl-c');
});

function createKey(name?: string, sequence?: string): readline.Key {
  return {
    name,
    sequence,
    ctrl: false,
    meta: false,
    shift: false,
  };
}

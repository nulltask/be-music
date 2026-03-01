import { describe, expect, test } from 'vitest';
import type readline from 'node:readline';
import { parseArgs, resolveResultScreenActionFromKey } from './cli.ts';
describe('player cli', () => {


test('cli: parses --audio-backend', () => {
  const parsed = parseArgs(['chart.bms', '--audio-backend', 'audio-io', '--auto']);
  expect(parsed.input).toBe('chart.bms');
  expect(parsed.audioBackend).toBe('audio-io');
  expect(parsed.auto).toBe(true);
});

test('cli: throws on invalid --audio-backend', () => {
  expect(() => parseArgs(['chart.bms', '--audio-backend', 'invalid-backend'])).toThrow(
    'Invalid --audio-backend value: invalid-backend',
  );
});

test('cli: leaves --audio-backend undefined when omitted', () => {
  const parsed = parseArgs(['chart.bms']);
  expect(parsed.audioBackend).toBeUndefined();
});

test('cli: enables song-select preview audio with --preview', () => {
  const parsed = parseArgs(['chart.bms', '--preview']);
  expect(parsed.previewAudio).toBe(true);
});

test('cli: disables song-select preview audio by default', () => {
  const parsed = parseArgs(['chart.bms']);
  expect(parsed.previewAudio).toBe(false);
});

test('cli: parses --debug-judge-window', () => {
  const parsed = parseArgs(['chart.bms', '--debug-judge-window', '280']);
  expect(parsed.judgeWindowMs).toBe(280);
  expect(parsed.judgeWindowSource).toBe('debug');
});

test('cli: parses --judge-window as a deprecated alias', () => {
  const parsed = parseArgs(['chart.bms', '--judge-window', '260']);
  expect(parsed.judgeWindowMs).toBe(260);
  expect(parsed.judgeWindowSource).toBe('legacy');
});

test('cli: interprets r as replay on result screen', () => {
  const action = resolveResultScreenActionFromKey('r', createKey());
  expect(action).toBe('replay');
});

test('cli: interprets Enter as return-to-select on result screen', () => {
  const action = resolveResultScreenActionFromKey(undefined, createKey('enter'));
  expect(action).toBe('enter');
});

test('cli: interprets Esc as exit on result screen', () => {
  const action = resolveResultScreenActionFromKey(undefined, createKey('escape', '\u001b'));
  expect(action).toBe('escape');
});

test('cli: interprets Ctrl+C as exit on result screen', () => {
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
});

import { describe, expect, test } from 'vitest';
import type readline from 'node:readline';
import {
  parseArgs,
  resolveCircularSelectableIndex,
  resolvePageSelectableIndex,
  resolveResultScreenActionFromKey,
  resolveSongSelectNavigationAction,
  resolveVisibleEntryRange,
} from './cli.ts';
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

test('cli: interprets Right as song-select next page', () => {
  const action = resolveSongSelectNavigationAction(undefined, createKey('right'));
  expect(action).toBe('page-down');
});

test('cli: interprets Left as song-select previous page', () => {
  const action = resolveSongSelectNavigationAction(undefined, createKey('left'));
  expect(action).toBe('page-up');
});

test('cli: interprets vim h/l as song-select page keys', () => {
  expect(resolveSongSelectNavigationAction('h', createKey())).toBe('page-up');
  expect(resolveSongSelectNavigationAction('l', createKey())).toBe('page-down');
});

test('cli: interprets Ctrl+b/Ctrl+f as song-select page keys', () => {
  expect(resolveSongSelectNavigationAction(undefined, createKey('b', undefined, true))).toBe('page-up');
  expect(resolveSongSelectNavigationAction(undefined, createKey('f', undefined, true))).toBe('page-down');
});

test('cli: resolves circular selectable index', () => {
  expect(resolveCircularSelectableIndex(0, -1, 5)).toBe(4);
  expect(resolveCircularSelectableIndex(4, 1, 5)).toBe(0);
  expect(resolveCircularSelectableIndex(2, 6, 5)).toBe(3);
});

test('cli: resolves visible entry range based on viewport rows', () => {
  expect(resolveVisibleEntryRange(9, 20, 6)).toEqual({ start: 6, end: 12 });
  expect(resolveVisibleEntryRange(0, 20, 6)).toEqual({ start: 0, end: 6 });
  expect(resolveVisibleEntryRange(19, 20, 6)).toEqual({ start: 18, end: 20 });
});

test('cli: resolves page selection using visible row range', () => {
  const selectableIndexes = [0, 2, 4, 7, 9, 11, 14, 16, 19];
  expect(resolvePageSelectableIndex(selectableIndexes, 9, 20, 6, 'down')).toBe(14);
  expect(resolvePageSelectableIndex(selectableIndexes, 9, 20, 6, 'up')).toBe(4);
});

test('cli: wraps page selection as circular list', () => {
  const selectableIndexes = [0, 2, 4, 7, 9, 11, 14, 16, 19];
  expect(resolvePageSelectableIndex(selectableIndexes, 19, 20, 6, 'down')).toBe(0);
  expect(resolvePageSelectableIndex(selectableIndexes, 0, 20, 6, 'up')).toBe(19);
  expect(resolvePageSelectableIndex(selectableIndexes, 19, 20, 6, 'up')).toBe(16);
});

function createKey(name?: string, sequence?: string, ctrl = false): readline.Key {
  return {
    name,
    sequence,
    ctrl,
    meta: false,
    shift: false,
  };
}
});

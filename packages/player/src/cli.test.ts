import { describe, expect, test } from 'vitest';
import type readline from 'node:readline';
import {
  cyclePlayMode,
  formatPlayModeLabel,
  parseArgs,
  resolveCircularSelectableIndex,
  resolvePageSelectableIndex,
  resolvePlayModeFromArgs,
  resolveResultScreenActionFromKey,
  resolveSongSelectNavigationAction,
  resolveVisibleEntryRange,
} from './cli.ts';
describe('player cli', () => {
  test('cli: parses --auto-scratch mode', () => {
    const parsed = parseArgs(['chart.bms', '--auto-scratch']);
    expect(parsed.auto).toBe(false);
    expect(parsed.autoScratch).toBe(true);
    expect(resolvePlayModeFromArgs(parsed)).toBe('auto-scratch');
  });

  test('cli: last explicit mode flag wins', () => {
    const parsedAuto = parseArgs(['chart.bms', '--auto-scratch', '--auto']);
    expect(resolvePlayModeFromArgs(parsedAuto)).toBe('auto');

    const parsedAutoScratch = parseArgs(['chart.bms', '--auto', '--auto-scratch']);
    expect(resolvePlayModeFromArgs(parsedAutoScratch)).toBe('auto-scratch');
  });

  test('cli: cycles song-select mode by a key in three states', () => {
    expect(cyclePlayMode('manual')).toBe('auto-scratch');
    expect(cyclePlayMode('auto-scratch')).toBe('auto');
    expect(cyclePlayMode('auto')).toBe('manual');
  });

  test('cli: formats play mode labels for song-select', () => {
    expect(formatPlayModeLabel('manual')).toBe('MANUAL');
    expect(formatPlayModeLabel('auto-scratch')).toBe('AUTO SCRATCH');
    expect(formatPlayModeLabel('auto')).toBe('AUTO');
  });

  test('cli: rejects removed --audio-backend flag', () => {
    expect(() => parseArgs(['chart.bms', '--audio-backend', 'webaudio'])).toThrow(
      '--audio-backend is no longer supported; node-web-audio-api is always used',
    );
  });

  test('cli: rejects removed audio-io tuning flags', () => {
    expect(() => parseArgs(['chart.bms', '--audio-io-buffer-ms', '12'])).toThrow(
      '--audio-io-buffer-ms is no longer supported; audio-io backend has been removed',
    );
  });

  test('cli: accepts --preview as a no-op and keeps preview always enabled', () => {
    const parsed = parseArgs(['chart.bms', '--preview']);
    expect(parsed.input).toBe('chart.bms');
  });

  test('cli: rejects --no-preview because preview is always enabled', () => {
    expect(() => parseArgs(['chart.bms', '--no-preview'])).toThrow(
      '--no-preview is no longer supported; song preview is always enabled',
    );
  });

  test('cli: parses --debug-judge-window', () => {
    const parsed = parseArgs(['chart.bms', '--debug-judge-window', '280']);
    expect(parsed.judgeWindowMs).toBe(280);
    expect(parsed.judgeWindowSource).toBe('debug');
  });

  test('cli: enables active audio debug overlay', () => {
    const parsed = parseArgs(['chart.bms', '--debug-active-audio']);
    expect(parsed.debugActiveAudio).toBe(true);
  });

  test('cli: parses audio tuning and per-playable volume options', () => {
    const parsed = parseArgs([
      'chart.bms',
      '--play-volume',
      '0.75',
      '--audio-lead-ms',
      '9.5',
      '--audio-lead-max-ms',
      '20',
      '--audio-lead-step-up-ms',
      '2.0',
      '--audio-lead-step-down-ms',
      '0.8',
    ]);
    expect(parsed.playVolume).toBe(0.75);
    expect(parsed.audioLeadMs).toBe(9.5);
    expect(parsed.audioLeadMaxMs).toBe(20);
    expect(parsed.audioLeadStepUpMs).toBe(2);
    expect(parsed.audioLeadStepDownMs).toBe(0.8);
  });

  test('cli: rejects removed audify tuning flags', () => {
    expect(() => parseArgs(['chart.bms', '--audify-high-water-ms', '28'])).toThrow(
      '--audify-high-water-ms is no longer supported; audify backend has been removed',
    );
    expect(() => parseArgs(['chart.bms', '--audify-low-water-ms', '14'])).toThrow(
      '--audify-low-water-ms is no longer supported; audify backend has been removed',
    );
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

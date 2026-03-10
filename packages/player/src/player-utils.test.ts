import { describe, expect, test } from 'vitest';
import { createEmptyJson } from '../../json/src/index.ts';
import { resolveAltModifierLabel, resolveDisplayedPlayLevelValue } from './player-utils.ts';

describe('player utils', () => {
  test('player-utils: uses Option label on macOS', () => {
    expect(resolveAltModifierLabel('darwin')).toBe('Option');
  });

  test('player-utils: uses Alt label on non-macOS platforms', () => {
    expect(resolveAltModifierLabel('win32')).toBe('Alt');
    expect(resolveAltModifierLabel('linux')).toBe('Alt');
  });

  test('player-utils: defaults missing BMS PLAYLEVEL to 3 for display', () => {
    const json = createEmptyJson('bms');
    expect(resolveDisplayedPlayLevelValue(json)).toBe(3);
  });

  test('player-utils: preserves explicit PLAYLEVEL values for display', () => {
    const json = createEmptyJson('bms');
    json.metadata.playLevel = 7.5;
    expect(resolveDisplayedPlayLevelValue(json)).toBe(7.5);
  });

  test('player-utils: preserves string PLAYLEVEL values for display', () => {
    const json = createEmptyJson('bms');
    json.metadata.playLevel = '安心';
    expect(resolveDisplayedPlayLevelValue(json)).toBe('安心');
  });

  test('player-utils: does not synthesize a bmson PLAYLEVEL when missing', () => {
    const json = createEmptyJson('bmson');
    expect(resolveDisplayedPlayLevelValue(json)).toBeUndefined();
  });
});

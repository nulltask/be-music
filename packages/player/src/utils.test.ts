import { describe, expect, test } from 'vitest';
import { createEmptyJson } from '../../json/src/index.ts';
import { resolveAltModifierLabel, resolveDisplayedDifficultyValue, resolveDisplayedPlayLevelValue } from './utils.ts';

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

  test('player-utils: resolves BMS DIFFICULTY values only in the supported 1-5 range', () => {
    const json = createEmptyJson('bms');
    json.metadata.difficulty = 3.9;
    expect(resolveDisplayedDifficultyValue(json)).toBe(3);

    json.metadata.difficulty = 0;
    expect(resolveDisplayedDifficultyValue(json)).toBeUndefined();

    json.metadata.difficulty = 6;
    expect(resolveDisplayedDifficultyValue(json)).toBeUndefined();
  });
});

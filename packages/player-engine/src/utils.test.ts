import { describe, expect, test } from 'vite-plus/test';
import { createEmptyJSON } from '../../chart-source/src/index.ts';
import {
  resolveAltModifierLabel,
  resolveDisplayedDifficulty,
  resolveDisplayedDifficultyValue,
  resolveDisplayedPlayLevelValue,
} from './utils.ts';

describe('player utils', () => {
  test('player-utils: uses Option label on macOS', () => {
    expect(resolveAltModifierLabel('darwin')).toBe('Option');
  });

  test('player-utils: uses Alt label on non-macOS platforms', () => {
    expect(resolveAltModifierLabel('win32')).toBe('Alt');
    expect(resolveAltModifierLabel('linux')).toBe('Alt');
  });

  test('player-utils: defaults missing BMS PLAYLEVEL to 3 for display', () => {
    const json = createEmptyJSON('bms');
    expect(resolveDisplayedPlayLevelValue(json)).toBe(3);
  });

  test('player-utils: preserves explicit PLAYLEVEL values for display', () => {
    const json = createEmptyJSON('bms');
    json.metadata.playLevel = 7.5;
    expect(resolveDisplayedPlayLevelValue(json)).toBe(7.5);
  });

  test('player-utils: preserves string PLAYLEVEL values for display', () => {
    const json = createEmptyJSON('bms');
    json.metadata.playLevel = '安心';
    expect(resolveDisplayedPlayLevelValue(json)).toBe('安心');
  });

  test('player-utils: does not synthesize a bmson PLAYLEVEL when missing', () => {
    const json = createEmptyJSON('bmson');
    expect(resolveDisplayedPlayLevelValue(json)).toBeUndefined();
  });

  test('player-utils: resolves BMS DIFFICULTY values only in the supported 1-5 range', () => {
    const json = createEmptyJSON('bms');
    json.metadata.difficulty = 3.9;
    expect(resolveDisplayedDifficultyValue(json)).toBe(3);

    json.metadata.difficulty = 0;
    expect(resolveDisplayedDifficultyValue(json)).toBeUndefined();

    json.metadata.difficulty = 6;
    expect(resolveDisplayedDifficultyValue(json)).toBeUndefined();
  });

  test('player-utils: shows the declared DIFFICULTY, else one estimated from the names, else from the notes', () => {
    const json = createEmptyJSON('bms');
    json.metadata.title = 'Song';
    json.metadata.subtitle = '[ANOTHER]';
    expect(resolveDisplayedDifficulty(json, { fileName: 'song.bms', noteCount: 300 })).toEqual({
      value: 4,
      basis: 'names',
    });

    json.metadata.difficulty = 3;
    expect(resolveDisplayedDifficulty(json, { fileName: 'song.bms' })).toEqual({ value: 3, basis: 'chart' });

    json.metadata.difficulty = 0;
    json.metadata.subtitle = undefined;
    expect(resolveDisplayedDifficulty(json, { fileName: 'song_7h.bms' })).toEqual({ value: 3, basis: 'names' });
    expect(resolveDisplayedDifficulty(json, { fileName: 'song.bms', noteCount: 300 })).toEqual({
      value: 2,
      basis: 'notes',
    });
    expect(resolveDisplayedDifficulty(json, { fileName: 'song.bms' })).toBeUndefined();
  });
});

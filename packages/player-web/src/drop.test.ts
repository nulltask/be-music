import { describe, expect, test } from 'vitest';
import { isChartFilePath, resolveDropFilePath, splitDroppedSongAndThemeFiles } from './drop.ts';

interface TestFile {
  name: string;
  webkitRelativePath?: string;
}

function file(path: string): TestFile {
  return {
    name: path.split('/').at(-1) ?? path,
    webkitRelativePath: path,
  };
}

describe('drop helpers', () => {
  test('isChartFilePath recognizes supported chart extensions case-insensitively', () => {
    expect(isChartFilePath('song/main.bms')).toBe(true);
    expect(isChartFilePath('song/main.BMSON')).toBe(true);
    expect(isChartFilePath('theme/play_7.lr2skin')).toBe(false);
  });

  test('resolveDropFilePath normalizes archive and browser directory paths', () => {
    expect(resolveDropFilePath(file(String.raw`Root\\Song/../Song/main.bms`))).toBe('Root/Song/main.bms');
  });

  test('splitDroppedSongAndThemeFiles keeps chart-directory assets together', () => {
    const songChart = file('LR2files/Sound/Example/main.bms');
    const songWav = file('LR2files/Sound/Example/kick.wav');
    const themeSkin = file('LR2files/Theme/play_7.lr2skin');
    const themePng = file('LR2files/Theme/parts.png');

    const result = splitDroppedSongAndThemeFiles([songChart, songWav, themeSkin, themePng]);

    expect(result.songFiles).toEqual([songChart, songWav]);
    expect(result.themeFiles).toEqual([themeSkin, themePng]);
  });

  test('splitDroppedSongAndThemeFiles treats chart-at-root drops as song material', () => {
    const chart = file('main.bms');
    const wav = file('kick.wav');
    const result = splitDroppedSongAndThemeFiles([chart, wav]);
    expect(result.songFiles).toEqual([chart, wav]);
    expect(result.themeFiles).toEqual([]);
  });

  test('splitDroppedSongAndThemeFiles treats theme-only drops as theme material', () => {
    const skin = file('Theme/play_7.lr2skin');
    const image = file('Theme/parts.png');
    const result = splitDroppedSongAndThemeFiles([skin, image]);
    expect(result.songFiles).toEqual([]);
    expect(result.themeFiles).toEqual([skin, image]);
  });
});

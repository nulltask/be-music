import { describe, expect, test } from 'vite-plus/test';
import {
  createEagerDropPathPredicate,
  isBeatorajaLuaSkinFilePath,
  isBeatorajaSkinIndicator,
  isChartFilePath,
  isLR2SkinFilePath,
  resolveDropFilePath,
  splitDroppedChartAndThemeFiles,
} from './drop.ts';

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

  test('splitDroppedChartAndThemeFiles keeps chart-directory assets together', () => {
    const songChart = file('LR2files/Sound/Example/main.bms');
    const songWAV = file('LR2files/Sound/Example/kick.wav');
    const themeSkin = file('LR2files/Theme/play_7.lr2skin');
    const themePNG = file('LR2files/Theme/parts.png');

    const result = splitDroppedChartAndThemeFiles([songChart, songWAV, themeSkin, themePNG]);

    expect(result.chartFiles).toEqual([songChart, songWAV]);
    expect(result.themeFiles).toEqual([themeSkin, themePNG]);
  });

  test('splitDroppedChartAndThemeFiles treats chart-at-root drops as song material', () => {
    const chart = file('main.bms');
    const wav = file('kick.wav');
    const result = splitDroppedChartAndThemeFiles([chart, wav]);
    expect(result.chartFiles).toEqual([chart, wav]);
    expect(result.themeFiles).toEqual([]);
  });

  test('splitDroppedChartAndThemeFiles treats theme-only drops as theme material', () => {
    const skin = file('Theme/play_7.lr2skin');
    const image = file('Theme/parts.png');
    const result = splitDroppedChartAndThemeFiles([skin, image]);
    expect(result.chartFiles).toEqual([]);
    expect(result.themeFiles).toEqual([skin, image]);
  });

  test('splitDroppedChartAndThemeFiles keeps sibling folders that share a name prefix apart', () => {
    const chart = file('Songs/A/main.bms');
    const wav = file('Songs/A/sub/kick.wav');
    const neighbour = file('Songs/AB/readme.txt');
    const result = splitDroppedChartAndThemeFiles([chart, wav, neighbour]);
    expect(result.chartFiles).toEqual([chart, wav]);
    expect(result.themeFiles).toEqual([neighbour]);
  });

  test('createEagerDropPathPredicate defers only song-bundle files', () => {
    const isEager = createEagerDropPathPredicate([
      'Pack/Song/main.bms',
      'Pack/Song/kick.wav',
      'Pack/Song/bga/movie.mp4',
      'Theme/play_7.lr2skin',
      'Theme/parts.png',
    ]);
    expect(isEager('Pack/Song/main.bms')).toBe(false);
    expect(isEager('Pack/Song/kick.wav')).toBe(false);
    expect(isEager('Pack/Song/bga/movie.mp4')).toBe(false);
    expect(isEager('Theme/play_7.lr2skin')).toBe(true);
    expect(isEager('Theme/parts.png')).toBe(true);
  });

  test('createEagerDropPathPredicate always opens replays and archives', () => {
    const isEager = createEagerDropPathPredicate(['Song/main.bms', 'Song/run.bmplay.json', 'Song/extra.ZIP']);
    expect(isEager('Song/run.bmplay.json')).toBe(true);
    expect(isEager('Song/extra.ZIP')).toBe(true);
    expect(isEager('Song/main.bms')).toBe(false);
  });

  test('createEagerDropPathPredicate opens everything when no chart was dropped', () => {
    const isEager = createEagerDropPathPredicate(['Theme/play_7.lr2skin', 'Theme/kick.wav']);
    expect(isEager('Theme/play_7.lr2skin')).toBe(true);
    expect(isEager('Theme/kick.wav')).toBe(true);
  });

  test('createEagerDropPathPredicate defers every file when a chart sits at the drop root', () => {
    const isEager = createEagerDropPathPredicate(['main.bms', 'kick.wav', 'Theme/play_7.lr2skin']);
    expect(isEager('kick.wav')).toBe(false);
    expect(isEager('Theme/play_7.lr2skin')).toBe(false);
  });

  test('isLR2SkinFilePath only matches `.lr2skin`', () => {
    expect(isLR2SkinFilePath('Theme/play.lr2skin')).toBe(true);
    expect(isLR2SkinFilePath('Theme/play.LR2SKIN')).toBe(true);
    expect(isLR2SkinFilePath('Theme/play.luaskin')).toBe(false);
    expect(isLR2SkinFilePath('Theme/play.json')).toBe(false);
  });

  test('isBeatorajaLuaSkinFilePath only matches `.luaskin`', () => {
    expect(isBeatorajaLuaSkinFilePath('skin/default/play.luaskin')).toBe(true);
    expect(isBeatorajaLuaSkinFilePath('skin/default/PLAY.LUASKIN')).toBe(true);
    expect(isBeatorajaLuaSkinFilePath('skin/default/play.lr2skin')).toBe(false);
  });

  test('isBeatorajaSkinIndicator triggers on .luaskin and skin-folder JSON', () => {
    expect(isBeatorajaSkinIndicator('skin/default/play24.luaskin')).toBe(true);
    expect(isBeatorajaSkinIndicator('skin/default/play24.json')).toBe(true);
    expect(isBeatorajaSkinIndicator('beatoraja/skin/default/play24.json')).toBe(true);
    expect(isBeatorajaSkinIndicator('Songs/foo/score.json')).toBe(false);
    expect(isBeatorajaSkinIndicator('Songs/foo/main.bmson')).toBe(false);
  });
});

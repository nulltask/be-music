import { BEATORAJA_TEXT, type BeatorajaSkin } from '@be-music/beatoraja-skin';
import { createEmptyJson } from '@be-music/json';
import { Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { BrowserSongEntry } from '../../collection/types.ts';
import { resolveBeatorajaChartImage, resolveBeatorajaSongText } from './shared-scene.ts';

function makeSong(overrides: Partial<BrowserSongEntry> = {}): BrowserSongEntry {
  const chart = createEmptyJson();
  chart.metadata.extras.SUBARTIST = 'movie:artist';
  return {
    id: 'song',
    sourceId: 'source',
    sourceLabel: 'Source',
    sourceKind: 'files',
    chartPath: 'song/main.bms',
    directoryLabel: 'Song Folder',
    fileLabel: 'main.bms',
    title: 'Title',
    subtitle: 'Sub',
    artist: 'Artist',
    genre: 'Genre',
    bpm: 130,
    totalNotes: 1,
    chart,
    ...overrides,
  };
}

const skin = { name: 'Skin Name', author: 'Skin Author' } as BeatorajaSkin;

describe('resolveBeatorajaChartImage', () => {
  it('maps synthetic chart image ids to supplied textures', () => {
    const stageFile = Texture.EMPTY;
    const backBmp = Texture.WHITE;
    const banner = Texture.EMPTY;

    expect(resolveBeatorajaChartImage({ stageFile, backBmp, banner }, -100)).toBe(stageFile);
    expect(resolveBeatorajaChartImage({ stageFile, backBmp, banner }, -101)).toBe(backBmp);
    expect(resolveBeatorajaChartImage({ stageFile, backBmp, banner }, -102)).toBe(banner);
    expect(resolveBeatorajaChartImage({ stageFile }, -999)).toBeUndefined();
    expect(resolveBeatorajaChartImage(undefined, -100)).toBeUndefined();
  });
});

describe('resolveBeatorajaSongText', () => {
  it('resolves shared song, skin, and directory text refs', () => {
    const song = makeSong();

    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.TITLE, { song, skin })).toBe('Title');
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.FULLTITLE, { song, skin })).toBe('Title Sub');
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.GENRE, { song, skin })).toBe('Genre');
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.FULLARTIST, { song, skin })).toBe('Artist movie:artist');
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.SKIN_NAME, { song, skin })).toBe('Skin Name');
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.SKIN_AUTHOR, { song, skin })).toBe('Skin Author');
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.DIRECTORY, { song, skin })).toBe('Song Folder');
  });

  it('lets decide keep table refs visible while result leaves them unresolved', () => {
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.TABLE_NAME, { skin })).toBeUndefined();
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.TABLE_NAME, { skin, tableTextFallback: '' })).toBe('');
  });
});

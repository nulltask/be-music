import { BEATORAJA_TEXT, type BeatorajaSkin } from '@be-music/beatoraja-skin';
import { createEmptyJson } from '@be-music/json';
import { describe, expect, it } from 'vite-plus/test';
import type { BrowserSongEntry } from '../../collection/types.ts';
import { resolveBeatorajaSkinTimingMs, resolveBeatorajaSongText } from './scene-frame.ts';

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

describe('resolveBeatorajaSkinTimingMs', () => {
  it('resolves finite skin timing fields with a fallback', () => {
    expect(resolveBeatorajaSkinTimingMs(250, 500)).toBe(250);
    expect(resolveBeatorajaSkinTimingMs(undefined, 500)).toBe(500);
    expect(resolveBeatorajaSkinTimingMs(Number.NaN, 500)).toBe(500);
    expect(resolveBeatorajaSkinTimingMs(-1, 500, { min: 0 })).toBe(500);
  });
});

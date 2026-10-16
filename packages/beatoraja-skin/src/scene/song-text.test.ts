import { describe, expect, it } from 'vite-plus/test';
import { BEATORAJA_TEXT } from '../runtime-ids.ts';
import { resolveBeatorajaPlayText } from './play-text.ts';
import { joinBeatorajaText, resolveBeatorajaSkinText, resolveBeatorajaSongText } from './song-text.ts';

const SONG = {
  title: 'Song',
  subtitle: '[ANOTHER]',
  genre: 'TECHNO',
  artist: 'Artist',
  subartist: 'obj: Charter',
  directory: 'Pack',
};

describe('resolveBeatorajaSongText', () => {
  it('reads the song texts, joining the full title and the full artist', () => {
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.TITLE, SONG)).toBe('Song');
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.SUBTITLE, SONG)).toBe('[ANOTHER]');
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.FULLTITLE, SONG)).toBe('Song [ANOTHER]');
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.GENRE, SONG)).toBe('TECHNO');
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.ARTIST, SONG)).toBe('Artist');
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.SUBARTIST, SONG)).toBe('obj: Charter');
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.FULLARTIST, SONG)).toBe('Artist obj: Charter');
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.DIRECTORY, SONG)).toBe('Pack');
  });

  it('reads empty without a chart or a field, and undefined for another id', () => {
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.TITLE, undefined)).toBe('');
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.FULLARTIST, { artist: 'A' })).toBe('A');
    expect(resolveBeatorajaSongText(BEATORAJA_TEXT.SKIN_NAME, SONG)).toBeUndefined();
    expect(joinBeatorajaText('a', '', undefined, 'b')).toBe('a b');
  });
});

describe('resolveBeatorajaSkinText', () => {
  it("reads the skin header's name and author", () => {
    expect(resolveBeatorajaSkinText(BEATORAJA_TEXT.SKIN_NAME, { name: 'Skin', author: 'Maker' })).toBe('Skin');
    expect(resolveBeatorajaSkinText(BEATORAJA_TEXT.SKIN_AUTHOR, { name: 'Skin', author: 'Maker' })).toBe('Maker');
    expect(resolveBeatorajaSkinText(BEATORAJA_TEXT.SKIN_NAME, undefined)).toBe('');
    expect(resolveBeatorajaSkinText(BEATORAJA_TEXT.TITLE, undefined)).toBeUndefined();
  });
});

describe('resolveBeatorajaPlayText', () => {
  it("reads the running course's stage titles first, then the song and skin texts", () => {
    const course = {
      kind: 'grade' as const,
      title: 'Dan',
      stages: [{ title: 'One' }, { title: 'Two' }],
      stageIndex: 0,
    };
    const input = { song: SONG, skin: { name: 'Skin' }, course };
    expect(resolveBeatorajaPlayText(BEATORAJA_TEXT.COURSE1_TITLE + 1, input)).toBe('Two');
    expect(resolveBeatorajaPlayText(BEATORAJA_TEXT.COURSE1_TITLE + 2, input)).toBe('');
    expect(resolveBeatorajaPlayText(BEATORAJA_TEXT.TITLE, input)).toBe('Song');
    expect(resolveBeatorajaPlayText(BEATORAJA_TEXT.SKIN_NAME, input)).toBe('Skin');
    expect(resolveBeatorajaPlayText(BEATORAJA_TEXT.COURSE1_TITLE, { song: SONG })).toBeUndefined();
    expect(resolveBeatorajaPlayText(BEATORAJA_TEXT.SEARCHWORD, input)).toBeUndefined();
  });
});

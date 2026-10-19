import {
  BEATORAJA_TEXT,
  TIMER_FADEOUT,
  TIMER_PLAY,
  TIMER_READY,
  TIMER_SCENE_START,
  TIMER_STARTINPUT,
  type BeatorajaSkin,
} from '@be-music/beatoraja-skin';
import { createEmptyJson } from '@be-music/json';
import { describe, expect, it } from 'vite-plus/test';
import type { LibraryChart } from '@be-music/scene-model';
import {
  beatorajaSceneNowMs,
  DEFAULT_BEATORAJA_FADEOUT_MS,
  resolveBeatorajaFadeOutMs,
  resolveBeatorajaSceneTimers,
  resolveBeatorajaSkinTimingMs,
  resolveBeatorajaSongText,
} from './scene-frame.ts';

function makeSong(overrides: Partial<LibraryChart> = {}): LibraryChart {
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

describe('resolveBeatorajaFadeOutMs', () => {
  it("reads the skin's fadeout, else the reference themes' 500 ms", () => {
    expect(resolveBeatorajaFadeOutMs(200)).toBe(200);
    expect(resolveBeatorajaFadeOutMs(800)).toBe(800);
    expect(resolveBeatorajaFadeOutMs(0)).toBe(0);
    expect(resolveBeatorajaFadeOutMs(undefined)).toBe(DEFAULT_BEATORAJA_FADEOUT_MS);
    expect(DEFAULT_BEATORAJA_FADEOUT_MS).toBe(500);
    expect(resolveBeatorajaFadeOutMs(-1)).toBe(500);
    expect(resolveBeatorajaFadeOutMs(Number.NaN)).toBe(500);
  });
});

describe('resolveBeatorajaSceneTimers', () => {
  const clock = { nowMs: 1100, enteredAtMs: 1000 };

  it("runs the scene, input, READY and PLAY timers on the screen's own clock", () => {
    expect(beatorajaSceneNowMs(clock)).toBe(100);
    const timers = resolveBeatorajaSceneTimers({ clock, inputOpenAtMs: 1500 }, 'input');
    expect([...timers]).toEqual([
      [TIMER_SCENE_START, 0],
      [TIMER_STARTINPUT, 500],
      [TIMER_READY, 500],
      [TIMER_PLAY, 500],
    ]);
    expect(timers.has(TIMER_FADEOUT)).toBe(false);
  });

  it('starts READY and PLAY at the entry, and the fade-out once the screen leaves', () => {
    const timers = resolveBeatorajaSceneTimers({ clock, inputOpenAtMs: 1500, leaving: { atMs: 1800 } }, 'entry');
    expect(timers.get(TIMER_READY)).toBe(0);
    expect(timers.get(TIMER_PLAY)).toBe(0);
    expect(timers.get(TIMER_FADEOUT)).toBe(800);
  });
});

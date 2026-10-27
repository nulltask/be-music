import {
  BEATORAJA_TEXT,
  TIMER_FADEOUT,
  TIMER_PLAY,
  TIMER_READY,
  TIMER_SCENE_START,
  TIMER_STARTINPUT,
  type BeatorajaSkin,
} from '@be-music/skin-beatoraja';
import { createEmptyJSON } from '@be-music/chart-source';
import { describe, expect, it } from 'vite-plus/test';
import type { LibraryChart } from '@be-music/player-scene-model';
import {
  beatorajaSceneNowMs,
  DEFAULT_BEATORAJA_FADEOUT_MS,
  resolveBeatorajaFadeOutMs,
  resolveBeatorajaSceneTimers,
  resolveBeatorajaSkinTimingMs,
  resolveBeatorajaChartText,
} from './scene-frame.ts';

function makeSong(overrides: Partial<LibraryChart> = {}): LibraryChart {
  const chart = createEmptyJSON();
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

describe('resolveBeatorajaChartText', () => {
  it('resolves shared song, skin, and directory text refs', () => {
    const chartEntry = makeSong();

    expect(resolveBeatorajaChartText(BEATORAJA_TEXT.TITLE, { chart: chartEntry, skin })).toBe('Title');
    expect(resolveBeatorajaChartText(BEATORAJA_TEXT.FULLTITLE, { chart: chartEntry, skin })).toBe('Title Sub');
    expect(resolveBeatorajaChartText(BEATORAJA_TEXT.GENRE, { chart: chartEntry, skin })).toBe('Genre');
    expect(resolveBeatorajaChartText(BEATORAJA_TEXT.FULLARTIST, { chart: chartEntry, skin })).toBe(
      'Artist movie:artist',
    );
    expect(resolveBeatorajaChartText(BEATORAJA_TEXT.SKIN_NAME, { chart: chartEntry, skin })).toBe('Skin Name');
    expect(resolveBeatorajaChartText(BEATORAJA_TEXT.SKIN_AUTHOR, { chart: chartEntry, skin })).toBe('Skin Author');
    expect(resolveBeatorajaChartText(BEATORAJA_TEXT.DIRECTORY, { chart: chartEntry, skin })).toBe('Song Folder');
  });

  it('lets decide keep table refs visible while result leaves them unresolved', () => {
    expect(resolveBeatorajaChartText(BEATORAJA_TEXT.TABLE_NAME, { skin })).toBeUndefined();
    expect(resolveBeatorajaChartText(BEATORAJA_TEXT.TABLE_NAME, { skin, tableTextFallback: '' })).toBe('');
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

  it('starts supported JSON/Lua result graph and score-update timers at entry, independently of input', () => {
    const timers = resolveBeatorajaSceneTimers({ clock, inputOpenAtMs: 1500 }, 'entry', 'result');
    expect(timers.get(150)).toBe(0);
    expect(timers.get(151)).toBe(0);
    expect(timers.get(152)).toBe(0);
    expect(resolveBeatorajaSceneTimers({ clock, inputOpenAtMs: 1500 }, 'input').has(150)).toBe(false);
    const next = resolveBeatorajaSceneTimers(
      { clock: { enteredAtMs: 9000, nowMs: 9100 }, inputOpenAtMs: 9500 },
      'entry',
      'result',
    );
    expect(next.get(150)).toBe(0);
    expect(next.get(152)).toBe(0);
  });

  it('starts READY and PLAY at the entry, and the fade-out once the screen leaves', () => {
    const timers = resolveBeatorajaSceneTimers({ clock, inputOpenAtMs: 1500, leaving: { atMs: 1800 } }, 'entry');
    expect(timers.get(TIMER_READY)).toBe(0);
    expect(timers.get(TIMER_PLAY)).toBe(0);
    expect(timers.get(TIMER_FADEOUT)).toBe(800);
  });
});

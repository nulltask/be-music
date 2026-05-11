import { BEATORAJA_TEXT, type BeatorajaSkin } from '@be-music/beatoraja-skin';
import { createEmptyJson } from '@be-music/json';
import { Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { BrowserSongEntry } from '../../collection/types.ts';
import type { PixiSceneHost } from '../host.ts';
import {
  attachBeatorajaSceneLoop,
  attachBeatorajaSceneLifecycle,
  createBeatorajaSceneFadeoutTransition,
  createBeatorajaSceneTimerStarts,
  hasBeatorajaSceneFadingTransition,
  hasBeatorajaSceneLockedTransition,
  isBeatorajaSceneInputReady,
  resolveBeatorajaChartImage,
  resolveBeatorajaSkinTimingMs,
  resolveBeatorajaSongText,
} from './shared-scene.ts';

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

describe('beatoraja scene timing helpers', () => {
  it('resolves finite skin timing fields with a fallback', () => {
    expect(resolveBeatorajaSkinTimingMs(250, 500)).toBe(250);
    expect(resolveBeatorajaSkinTimingMs(undefined, 500)).toBe(500);
    expect(resolveBeatorajaSkinTimingMs(Number.NaN, 500)).toBe(500);
    expect(resolveBeatorajaSkinTimingMs(-1, 500, { min: 0 })).toBe(500);
  });

  it('creates the common scene timer ladder', () => {
    const timers = createBeatorajaSceneTimerStarts({ inputDelayMs: 500, readyAtMs: 0, playAtMs: 100 });

    expect(timers.get(0)).toBe(0);
    expect(timers.get(1)).toBe(500);
    expect(timers.get(40)).toBe(0);
    expect(timers.get(41)).toBe(100);
  });

  it('checks input readiness relative to scene start', () => {
    expect(isBeatorajaSceneInputReady(1000, 500, 1499)).toBe(false);
    expect(isBeatorajaSceneInputReady(1000, 500, 1500)).toBe(true);
  });
});

describe('beatoraja scene transition helpers', () => {
  it('constructs a fadeout transition that stamps the scene timer map', () => {
    let nowMs = 10;
    let completed = 0;
    const timerStartedAt = new Map<number, number>();
    const transition = createBeatorajaSceneFadeoutTransition({
      skin: { fadeout: 50 },
      getElapsedMs: () => nowMs,
      timerStartedAt,
      onComplete: () => {
        completed += 1;
      },
    });

    transition.begin();
    expect(timerStartedAt.get(2)).toBe(10);
    nowMs = 59;
    transition.tick();
    expect(completed).toBe(0);
    nowMs = 60;
    transition.tick();
    transition.tick();
    expect(completed).toBe(1);
  });

  it('detects fading and locked transition states', () => {
    const idle = { isFadingOut: () => false, isCompleted: () => false };
    const fading = { isFadingOut: () => true, isCompleted: () => false };
    const completed = { isFadingOut: () => false, isCompleted: () => true };

    expect(hasBeatorajaSceneFadingTransition(idle, undefined)).toBe(false);
    expect(hasBeatorajaSceneFadingTransition(idle, fading)).toBe(true);
    expect(hasBeatorajaSceneLockedTransition(idle, completed)).toBe(true);
  });
});

describe('attachBeatorajaSceneLoop', () => {
  it('attaches and detaches the ticker callback', () => {
    const added: Array<() => void> = [];
    const removed: Array<() => void> = [];
    const host = {
      app: {
        ticker: {
          add: (callback: () => void) => added.push(callback),
          remove: (callback: () => void) => removed.push(callback),
        },
      },
    } as unknown as PixiSceneHost;
    let ticks = 0;

    const attachment = attachBeatorajaSceneLoop(
      host,
      () => {
        ticks += 1;
      },
      () => undefined,
    );

    expect(added).toHaveLength(1);
    added[0]!();
    expect(ticks).toBe(1);
    attachment.dispose();
    expect(removed[0]).toBe(added[0]);
  });
});

describe('attachBeatorajaSceneLifecycle', () => {
  it('creates timers, transitions, and loop attachment together', () => {
    const added: Array<() => void> = [];
    const host = {
      app: {
        ticker: {
          add: (callback: () => void) => added.push(callback),
          remove: () => undefined,
        },
      },
    } as unknown as PixiSceneHost;
    let nowMs = 0;
    let ticks = 0;
    let completed = 0;

    const lifecycle = attachBeatorajaSceneLifecycle({
      host,
      skin: { fadeout: 10 },
      inputDelayMs: 500,
      readyAtMs: 0,
      playAtMs: 0,
      getElapsedMs: () => nowMs,
      tick: () => {
        ticks += 1;
      },
      handleKeyDown: () => undefined,
      transitionCompletions: [
        () => {
          completed += 1;
        },
      ],
    });

    expect(lifecycle.timerStartedAt.get(1)).toBe(500);
    expect(lifecycle.timerStartedAt.get(40)).toBe(0);
    expect(lifecycle.transitions).toHaveLength(1);
    added[0]!();
    expect(ticks).toBe(1);

    lifecycle.transitions[0]!.begin();
    expect(lifecycle.timerStartedAt.get(2)).toBe(0);
    nowMs = 10;
    lifecycle.transitions[0]!.tick();
    expect(completed).toBe(1);
  });
});

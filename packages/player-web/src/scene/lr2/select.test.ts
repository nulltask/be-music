import { createEmptyJson } from '@be-music/json';
import { describe, expect, it } from 'vite-plus/test';
import { DEFAULT_PLAY_OPTIONS, isInsideLr2DefaultSearchBox } from './select.ts';
import { computeSelectOps, resolveKeyModeOp, SELECT_DYNAMIC_OPS } from '../select-ops.ts';
import type { BrowserBrowseEntry, BrowserSongEntry } from '../../collection/types.ts';

/**
 * Builds a minimal `BrowserSongEntry` for tests. Only the fields `matchesSearchQuery` consults are populated; the rest
 * get placeholder values that satisfy the type without affecting the filter.
 */
function makeSongEntry(overrides: Partial<BrowserSongEntry>): BrowserBrowseEntry {
  const song: BrowserSongEntry = {
    id: 'test:song',
    sourceId: 'test',
    sourceLabel: 'test',
    sourceKind: 'files',
    chartPath: 'test/song.bms',
    directoryLabel: 'test',
    fileLabel: 'song.bms',
    title: 'Untitled',
    totalNotes: 0,
    chart: createEmptyJson(),
    ...overrides,
  };
  return { kind: 'song', song };
}

describe('select ops', () => {
  it('seeds empty-list defaults without a focused song', () => {
    const ops = computeSelectOps(undefined, new Set(), DEFAULT_PLAY_OPTIONS);
    expect(ops.has(SELECT_DYNAMIC_OPS.BGA_ABSENT)).toBe(true);
    expect(ops.has(SELECT_DYNAMIC_OPS.LN_ABSENT)).toBe(true);
    expect(ops.has(SELECT_DYNAMIC_OPS.TEXT_ABSENT)).toBe(true);
    expect(ops.has(SELECT_DYNAMIC_OPS.KEYS_7)).toBe(true);
    expect(ops.has(41)).toBe(true);
    expect(ops.has(31)).toBe(true);
  });

  it('uses shared chart play-variant classification for key-mode ops', () => {
    const entry = makeSongEntry({
      chartPath: 'test/song.pms',
      chart: {
        ...createEmptyJson(),
        events: [{ measure: 0, channel: '22', position: [0, 1], value: '01' }],
      },
    });
    if (entry.kind !== 'song') throw new Error('expected song entry');
    expect(resolveKeyModeOp(entry.song)).toBe(SELECT_DYNAMIC_OPS.KEYS_9);
  });
});

describe('isInsideLr2DefaultSearchBox', () => {
  it('accepts the LR2 default search-box chrome on the canonical 1280x720 design canvas', () => {
    expect(isInsideLr2DefaultSearchBox({ width: 1280, height: 720, x: 460, y: 561 })).toBe(true);
  });

  it('keeps the fallback rectangle boundaries inclusive to match the select-view click path', () => {
    expect(isInsideLr2DefaultSearchBox({ width: 1280, height: 720, x: 0, y: 540 })).toBe(true);
    expect(isInsideLr2DefaultSearchBox({ width: 1280, height: 720, x: 920, y: 582 })).toBe(true);
  });

  it('rejects clicks just outside the LR2 default search-box rectangle', () => {
    expect(isInsideLr2DefaultSearchBox({ width: 1280, height: 720, x: -0.01, y: 561 })).toBe(false);
    expect(isInsideLr2DefaultSearchBox({ width: 1280, height: 720, x: 920.01, y: 561 })).toBe(false);
    expect(isInsideLr2DefaultSearchBox({ width: 1280, height: 720, x: 460, y: 539.99 })).toBe(false);
    expect(isInsideLr2DefaultSearchBox({ width: 1280, height: 720, x: 460, y: 582.01 })).toBe(false);
  });

  it('does not apply the hardcoded fallback to custom design sizes', () => {
    expect(isInsideLr2DefaultSearchBox({ width: 640, height: 480, x: 460, y: 561 })).toBe(false);
    expect(isInsideLr2DefaultSearchBox({ width: 1280, height: 800, x: 460, y: 561 })).toBe(false);
  });
});

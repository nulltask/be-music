import { createEmptyJson } from '@be-music/json';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAY_OPTIONS,
  isInsideLr2DefaultSearchBox,
  matchesSearchQuery,
  wrappedCursorDelta,
} from './pixi-select.ts';
import { computeSelectOps, resolveKeyModeOp, SELECT_DYNAMIC_OPS } from './select-ops.ts';
import type { BrowserBrowseEntry, BrowserSongEntry } from './types.ts';

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

describe('matchesSearchQuery', () => {
  it('returns true for any entry on an empty query', () => {
    // Empty-query short-circuit is what lets `currentEntries` pass the unfiltered list through without touching it.
    // Asserting on it here locks in that behavior so later changes don't accidentally reintroduce a filter pass on
    // every render.
    expect(matchesSearchQuery(makeSongEntry({ title: 'Whatever' }), '')).toBe(true);
  });

  it('matches the title case-insensitively', () => {
    const entry = makeSongEntry({ title: 'Alternate Ignition' });
    expect(matchesSearchQuery(entry, 'alternate')).toBe(true);
    expect(matchesSearchQuery(entry, 'ignition')).toBe(true);
    expect(matchesSearchQuery(entry, 'IGNITION'.toLowerCase())).toBe(true);
  });

  it('matches the artist field', () => {
    const entry = makeSongEntry({ title: 'song', artist: 'YAMD' });
    expect(matchesSearchQuery(entry, 'yamd')).toBe(true);
  });

  it('matches the genre field', () => {
    const entry = makeSongEntry({ title: 'song', genre: 'Electro' });
    expect(matchesSearchQuery(entry, 'electro')).toBe(true);
  });

  it('matches the subtitle field', () => {
    const entry = makeSongEntry({ title: 'song', subtitle: 'Insane mix' });
    expect(matchesSearchQuery(entry, 'insane')).toBe(true);
  });

  it('matches the file label as a fallback', () => {
    // File labels surface chart-difficulty hints that authors sometimes embed in the filename (e.g. `[7K HARD].bms`).
    // Searching by that keyword should land the right chart even when the title / artist don't carry the keyword.
    const entry = makeSongEntry({ title: 'song', fileLabel: 'sleepless [7K SP HYPER].bms' });
    expect(matchesSearchQuery(entry, '7k sp hyper')).toBe(true);
  });

  it('returns false when no field contains the query', () => {
    const entry = makeSongEntry({ title: 'song', artist: 'YAMD', genre: 'Electro' });
    expect(matchesSearchQuery(entry, 'jazz')).toBe(false);
  });

  it('handles missing optional fields gracefully', () => {
    // `subtitle` / `artist` / `genre` are optional. The matcher shouldn't throw when they're absent, just skip those
    // candidates and keep checking the remaining fields.
    const entry = makeSongEntry({ title: 'song' });
    expect(matchesSearchQuery(entry, 'song')).toBe(true);
    expect(matchesSearchQuery(entry, 'missing')).toBe(false);
  });

  it('matches folder entries on label only', () => {
    // Folder bars don't have artist / genre fields — the matcher falls back to label-only comparison so navigating into
    // folder X via search uses the folder's own name as the search target.
    const folderEntry: BrowserBrowseEntry = {
      kind: 'folder',
      folder: {
        label: 'LunaticCrave',
        songs: [],
      },
    };
    expect(matchesSearchQuery(folderEntry, 'lunatic')).toBe(true);
    expect(matchesSearchQuery(folderEntry, 'unrelated')).toBe(false);
  });
});

describe('DEFAULT_PLAY_OPTIONS', () => {
  it('seeds LR2-style visual options for the first gameplay mount', () => {
    expect(DEFAULT_PLAY_OPTIONS.hiSpeed).toBe(2.5);
    expect(DEFAULT_PLAY_OPTIONS.bga).toBe('ON');
    expect(DEFAULT_PLAY_OPTIONS.bgaSize).toBe('EXTEND');
    expect(DEFAULT_PLAY_OPTIONS.scoreGraph).toBe(true);
    expect(DEFAULT_PLAY_OPTIONS.gauge1P).toBe('GROOVE');
    expect(DEFAULT_PLAY_OPTIONS.gauge2P).toBe('GROOVE');
  });
});

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

describe('wrappedCursorDelta', () => {
  it('returns 0 when the list is empty', () => {
    // Defensive — divide-by-zero math would yield NaN otherwise, which downstream `listScrollOffset` accumulation would
    // then poison for the rest of the session.
    expect(wrappedCursorDelta(0, 0)).toBe(0);
    expect(wrappedCursorDelta(5, 0)).toBe(0);
  });

  it('passes short trips through unchanged', () => {
    // A move that already fits inside the half-window doesn't need wrapping — wrapping is only useful for collapsing a
    // big jump back to a "short visible step in the opposite direction".
    expect(wrappedCursorDelta(1, 10)).toBe(1);
    expect(wrappedCursorDelta(-1, 10)).toBe(-1);
    expect(wrappedCursorDelta(3, 10)).toBe(3);
    expect(wrappedCursorDelta(-4, 10)).toBe(-4);
  });

  it('collapses long forward jumps to a backward step (and vice versa)', () => {
    // Last → first via a single down keypress: rawDelta = -(N-1). With N=10 that's -9, which should animate as +1 step
    // forward (the visually shorter path around the ring).
    expect(wrappedCursorDelta(9, 10)).toBe(-1);
    expect(wrappedCursorDelta(-9, 10)).toBe(1);
    expect(wrappedCursorDelta(8, 10)).toBe(-2);
  });

  it('preserves keypress direction for 2-element rings', () => {
    // Regression: with 2 folders/songs in the list, pressing the down arrow used to wrap to -1 (slide cursor visually
    // upward) instead of the expected +1. Pin the fix so a future tweak doesn't reintroduce the inversion.
    expect(wrappedCursorDelta(1, 2)).toBe(1);
    expect(wrappedCursorDelta(-1, 2)).toBe(-1);
  });

  it('preserves keypress direction for 3-element rings', () => {
    // Same reasoning as the 2-element case — a +1 forward step is the natural interpretation of pressing down even when
    // the ring is small.
    expect(wrappedCursorDelta(1, 3)).toBe(1);
    expect(wrappedCursorDelta(-1, 3)).toBe(-1);
    // Cross-ring wrap (last → first via down): rawDelta = -2, shorter path is +1.
    expect(wrappedCursorDelta(-2, 3)).toBe(1);
    expect(wrappedCursorDelta(2, 3)).toBe(-1);
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

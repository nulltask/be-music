import { createEmptyJson } from '@be-music/json';
import { describe, expect, it } from 'vitest';
import { matchesSearchQuery } from './pixi-select.ts';
import type { BrowserBrowseEntry, BrowserSongEntry } from './types.ts';

/**
 * Builds a minimal `BrowserSongEntry` for tests. Only the fields
 * `matchesSearchQuery` consults are populated; the rest get
 * placeholder values that satisfy the type without affecting the
 * filter.
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
    // Empty-query short-circuit is what lets `currentEntries` pass
    // the unfiltered list through without touching it. Asserting on
    // it here locks in that behaviour so later changes don't
    // accidentally reintroduce a filter pass on every render.
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
    // File labels surface chart-difficulty hints that authors
    // sometimes embed in the filename (e.g. `[7K HARD].bms`).
    // Searching by that keyword should land the right chart even
    // when the title / artist don't carry the keyword.
    const entry = makeSongEntry({ title: 'song', fileLabel: 'sleepless [7K SP HYPER].bms' });
    expect(matchesSearchQuery(entry, '7k sp hyper')).toBe(true);
  });

  it('returns false when no field contains the query', () => {
    const entry = makeSongEntry({ title: 'song', artist: 'YAMD', genre: 'Electro' });
    expect(matchesSearchQuery(entry, 'jazz')).toBe(false);
  });

  it('handles missing optional fields gracefully', () => {
    // `subtitle` / `artist` / `genre` are optional. The matcher
    // shouldn't throw when they're absent, just skip those
    // candidates and keep checking the remaining fields.
    const entry = makeSongEntry({ title: 'song' });
    expect(matchesSearchQuery(entry, 'song')).toBe(true);
    expect(matchesSearchQuery(entry, 'missing')).toBe(false);
  });

  it('matches folder entries on label only', () => {
    // Folder bars don't have artist / genre fields — the matcher
    // falls back to label-only comparison so navigating into
    // folder X via search uses the folder's own name as the
    // search target.
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

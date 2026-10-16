import type { LibraryChart, LibraryEntry } from '../library/entries.ts';
import type { BrowseSort } from './list-options.ts';

/**
 * Case-insensitive text order in the runtime's locale: `a.localeCompare(b, undefined, { sensitivity: 'base' })` as one
 * collator, so sorting thousands of bars does not set one up per comparison.
 */
const TEXT_COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base' });

/** Folders sort before charts, charts before courses (a list never mixes them today; this keeps the order sensible). */
const KIND_RANK: Readonly<Record<LibraryEntry['kind'], number>> = { folder: 0, song: 1, course: 2 };

/**
 * The bars in `sort` order ({@link BrowseSort}), as a new array. Folders sort by label under every order but `OFF` and
 * `LASTPLAY`; courses keep their order. The sort is stable: bars that compare equal keep the library's order.
 */
export function sortLibraryEntries(entries: readonly LibraryEntry[], sort: BrowseSort): LibraryEntry[] {
  if (sort === 'OFF' || sort === 'LASTPLAY') return [...entries];
  const indexed = entries.map((entry, index) => ({ entry, index }));
  indexed.sort((a, b) => {
    const cmp = compareEntries(a.entry, b.entry, sort);
    return cmp !== 0 ? cmp : a.index - b.index;
  });
  return indexed.map((item) => item.entry);
}

function compareEntries(a: LibraryEntry, b: LibraryEntry, sort: BrowseSort): number {
  if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (a.kind === 'folder' && b.kind === 'folder') return TEXT_COLLATOR.compare(a.folder.label, b.folder.label);
  if (a.kind === 'song' && b.kind === 'song') return compareCharts(a.song, b.song, sort);
  return 0;
}

function compareCharts(a: LibraryChart, b: LibraryChart, sort: BrowseSort): number {
  switch (sort) {
    case 'LEVEL': {
      const levelA = sortablePlayLevel(a.playLevel);
      const levelB = sortablePlayLevel(b.playLevel);
      if (levelA !== levelB) return levelA - levelB;
      return TEXT_COLLATOR.compare(a.title, b.title);
    }
    case 'TITLE':
    case 'CLEAR':
      return TEXT_COLLATOR.compare(a.title, b.title);
    case 'ARTIST':
      return TEXT_COLLATOR.compare(a.artist ?? '', b.artist ?? '');
    case 'GENRE':
      return TEXT_COLLATOR.compare(a.genre ?? '', b.genre ?? '');
    case 'BPM':
      return (a.bpm ?? 0) - (b.bpm ?? 0);
    case 'NOTES':
      return a.totalNotes - b.totalNotes;
    case 'OFF':
    case 'LASTPLAY':
      return 0;
  }
}

/**
 * A `#PLAYLEVEL` (a number, or text in some bmson files and BMS variants) as a sort key; a missing or non-numeric level
 * sorts after every other.
 */
function sortablePlayLevel(value: number | string | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  }
  return Number.POSITIVE_INFINITY;
}

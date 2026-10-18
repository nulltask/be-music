import type { LibraryEntry } from '../library/entries.ts';

/** The form a search text filters by: trimmed and lower-cased, so `" Ignition "` and `"ignition"` list the same bars. */
export function normalizeSearchQuery(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Whether a bar matches a lower-cased search query ({@link normalizeSearchQuery}); every bar matches an empty one. A
 * chart matches when its title, subtitle, artist, genre or file label contains the query (authors put difficulty hints
 * such as `[7K HARD]` in file names), a folder on its label, a course on its name.
 */
export function matchesSearchQuery(entry: LibraryEntry, lowerQuery: string): boolean {
  if (lowerQuery.length === 0) return true;
  if (entry.kind === 'folder') {
    return entry.folder.label.toLowerCase().includes(lowerQuery);
  }
  if (entry.kind === 'course') {
    return entry.course.definition.name.toLowerCase().includes(lowerQuery);
  }
  const chart = entry.chart;
  const haystacks: Array<string | undefined> = [
    chart.title,
    chart.subtitle,
    chart.artist,
    chart.genre,
    chart.fileLabel,
  ];
  for (const value of haystacks) {
    if (typeof value === 'string' && value.toLowerCase().includes(lowerQuery)) {
      return true;
    }
  }
  return false;
}

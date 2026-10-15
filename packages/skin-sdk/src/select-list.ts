import type { BrowserBrowseEntry } from './song.ts';

/** One row of the select list to draw this frame. */
export interface SelectListRow {
  /** Index into `frame.entries`. */
  entryIndex: number;
  /**
   * Where the row sits, in rows from the top of the list window: 0 for the first row, fractional while the list is
   * pulled (`frame.listScroll`), -1 < slot < 0 for a row sliding out at the top. Its top is `listTop + slot * rowHeight`.
   */
  slot: number;
  /** How much of the row is inside the window, 0..1: fade the row by it so rows slide in and out at the edges. */
  alpha: number;
}

/**
 * The rows of the select list to draw, top to bottom: the window's rows (`firstVisibleIndex`, `visibleRows`) moved up
 * by `listScroll` (as a fraction of `rowHeight`), plus the row sliding in at the edge it opens. At rest it is exactly
 * the window, each row at a whole slot with alpha 1. Rows past either end of `entries` are left out.
 */
export function selectListRows(
  frame: {
    readonly entries: readonly unknown[];
    readonly firstVisibleIndex: number;
    readonly visibleRows: number;
    readonly listScroll?: number;
  },
  rowHeight: number,
): SelectListRow[] {
  const shift = rowHeight > 0 ? Math.max(-1, Math.min(1, (frame.listScroll ?? 0) / rowHeight)) : 0;
  const rows: SelectListRow[] = [];
  for (let offset = -1; offset <= frame.visibleRows; offset += 1) {
    const entryIndex = frame.firstVisibleIndex + offset;
    if (entryIndex < 0 || entryIndex >= frame.entries.length) continue;
    const slot = offset - shift;
    const alpha = Math.max(0, Math.min(1, Math.min(slot + 1, frame.visibleRows - slot)));
    if (alpha <= 0) continue;
    rows.push({ entryIndex, slot, alpha });
  }
  return rows;
}

/** The headline of a select-list row: a song's title, a folder's name, or a course's name. */
export function browseEntryTitle(entry: BrowserBrowseEntry): string {
  if (entry.kind === 'song') return entry.song.title;
  if (entry.kind === 'course') return entry.course.definition.name;
  return entry.folder.label;
}

/**
 * The count a row shows in place of a song's facts: a folder's charts (or courses, for a course folder), or a course's
 * stages with how many are missing from the collection. `undefined` for a song row.
 */
export function browseEntryCount(entry: BrowserBrowseEntry): string | undefined {
  if (entry.kind === 'song') return undefined;
  if (entry.kind === 'course') {
    const stages = entry.course.stages.length;
    const missing = entry.course.stages.filter((stage) => stage.song === undefined).length;
    return `${stages} stage${stages === 1 ? '' : 's'}${missing > 0 ? ` · ${missing} missing` : ''}`;
  }
  const courses = entry.folder.courses;
  if (courses !== undefined) return `${courses.length} course${courses.length === 1 ? '' : 's'}`;
  const charts = entry.folder.songs.length;
  return `${charts} chart${charts === 1 ? '' : 's'}`;
}

/**
 * The short badge a row shows where a song shows its level: `DIR` for a folder, `DAN` for a dan course, `CRS` for
 * another course, and the level (or `-`) for a song.
 */
export function browseEntryBadge(entry: BrowserBrowseEntry): string {
  if (entry.kind === 'folder') return 'DIR';
  if (entry.kind === 'course') return entry.course.definition.kind === 'grade' ? 'DAN' : 'CRS';
  return entry.song.playLevel !== undefined ? String(entry.song.playLevel) : '-';
}

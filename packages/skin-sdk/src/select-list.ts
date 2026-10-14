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

/**
 * Skinless select geometry. Render and pointer hit-tests must stay in lockstep —
 * PLAY / AUTO / SEARCH / list rows all read from this object.
 */
export const DEFAULT_SELECT_LAYOUT = {
  designWidth: 640,
  designHeight: 480,
  listX: 320,
  listTop: 54,
  listBottomInset: 26,
  rowHeight: 28,
  listWidth: 304,
  play: { x: 24, y: 312, w: 82, h: 28 },
  auto: { x: 112, y: 312, w: 180, h: 28 },
  search: { x: 12, y: 376, w: 292, h: 28 },
} as const;

export function defaultSelectListWidth(designWidth: number): number {
  return designWidth - DEFAULT_SELECT_LAYOUT.listX - 16;
}

export function isInsideDefaultSelectList(x: number, y: number, designHeight: number): boolean {
  const { listX, listTop, listBottomInset } = DEFAULT_SELECT_LAYOUT;
  return x >= listX && y >= listTop && y <= designHeight - listBottomInset;
}

export function resolveDefaultSelectVisibleWindow(
  selectedIndex: number,
  entryCount: number,
  designHeight: number,
): { start: number; visibleRows: number } {
  const { listTop, listBottomInset, rowHeight } = DEFAULT_SELECT_LAYOUT;
  const listBottom = designHeight - listBottomInset;
  const visibleRows = Math.max(1, Math.floor((listBottom - listTop) / rowHeight));
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(visibleRows / 2), Math.max(0, entryCount - visibleRows)));
  return { start, visibleRows };
}

export function defaultSelectEntryIndexAt(
  y: number,
  selectedIndex: number,
  entryCount: number,
  designHeight: number,
): number | undefined {
  if (entryCount <= 0) return undefined;
  const { listTop, rowHeight } = DEFAULT_SELECT_LAYOUT;
  const { start, visibleRows } = resolveDefaultSelectVisibleWindow(selectedIndex, entryCount, designHeight);
  const visibleRow = Math.floor((y - listTop) / rowHeight);
  if (visibleRow < 0 || visibleRow >= visibleRows) return undefined;
  const entryIndex = start + visibleRow;
  if (entryIndex < 0 || entryIndex >= entryCount) return undefined;
  return entryIndex;
}

export function isInsideRect(
  x: number,
  y: number,
  rect: { x: number; y: number; w: number; h: number },
): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

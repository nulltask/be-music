/**
 * Shared geometry for the skinless song-select list. Render and pointer hit-testing MUST read these numbers from the
 * same object — a drift of even one pixel desyncs clicks from the visible rows.
 */
export const DEFAULT_SELECT_LAYOUT = {
  listX: 320,
  listTop: 54,
  listBottomInset: 26,
  rowHeight: 28,
  listRightInset: 16,
  play: { x: 24, y: 312, w: 82, h: 28 },
  autoPlay: { x: 112, y: 312, w: 180, h: 28 },
  search: { x: 12, y: 376, w: 292, h: 28 },
} as const;

export interface DefaultSelectVisibleWindow {
  start: number;
  visibleRows: number;
}

export function defaultSelectListWidth(designWidth: number): number {
  return designWidth - DEFAULT_SELECT_LAYOUT.listX - DEFAULT_SELECT_LAYOUT.listRightInset;
}

export function defaultSelectListBottom(designHeight: number): number {
  return designHeight - DEFAULT_SELECT_LAYOUT.listBottomInset;
}

export function resolveDefaultSelectVisibleWindow(
  selectedIndex: number,
  entryCount: number,
  designHeight: number,
): DefaultSelectVisibleWindow {
  const listBottom = defaultSelectListBottom(designHeight);
  const visibleRows = Math.max(
    1,
    Math.floor((listBottom - DEFAULT_SELECT_LAYOUT.listTop) / DEFAULT_SELECT_LAYOUT.rowHeight),
  );
  const start = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(visibleRows / 2), Math.max(0, entryCount - visibleRows)),
  );
  return { start, visibleRows };
}

export function isInsideDefaultSelectList(x: number, y: number, designHeight: number): boolean {
  const listBottom = defaultSelectListBottom(designHeight);
  return x >= DEFAULT_SELECT_LAYOUT.listX && y >= DEFAULT_SELECT_LAYOUT.listTop && y <= listBottom;
}

export function defaultSelectEntryIndexAt(y: number, start: number, entryCount: number): number | undefined {
  const visibleRow = Math.floor((y - DEFAULT_SELECT_LAYOUT.listTop) / DEFAULT_SELECT_LAYOUT.rowHeight);
  const entryIndex = start + visibleRow;
  if (entryIndex < 0 || entryIndex >= entryCount) return undefined;
  return entryIndex;
}

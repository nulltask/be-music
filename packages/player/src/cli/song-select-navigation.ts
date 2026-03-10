import type readline from 'node:readline';

export type ResultScreenAction = 'enter' | 'escape' | 'ctrl-c' | 'replay';
export type SongSelectPageDirection = 'up' | 'down';
export type SongSelectDifficultyFilter = 1 | 2 | 3 | 4 | 5;
export type SongSelectNavigationAction =
  | 'move-up'
  | 'move-down'
  | 'page-up'
  | 'page-down'
  | 'first'
  | 'last'
  | 'confirm'
  | 'toggle-auto'
  | 'increase-high-speed'
  | 'decrease-high-speed'
  | 'escape'
  | 'ctrl-c';

export function resolveSongSelectNavigationAction(
  chunk: string | undefined,
  key: readline.Key,
): SongSelectNavigationAction | undefined {
  if (key.sequence === '\u0003') {
    return 'ctrl-c';
  }
  const lowerChunk = typeof chunk === 'string' ? chunk.toLowerCase() : '';
  const keyName = key.name?.toLowerCase();

  if (keyName === 'up' || lowerChunk === 'k') {
    return 'move-up';
  }
  if (keyName === 'down' || lowerChunk === 'j') {
    return 'move-down';
  }
  if (keyName === 'left' || keyName === 'pageup' || lowerChunk === 'h' || (key.ctrl && keyName === 'b')) {
    return 'page-up';
  }
  if (keyName === 'right' || keyName === 'pagedown' || lowerChunk === 'l' || (key.ctrl && keyName === 'f')) {
    return 'page-down';
  }
  if (keyName === 'home' || lowerChunk === 'g') {
    return 'first';
  }
  if (keyName === 'end' || chunk === 'G') {
    return 'last';
  }
  if (keyName === 'return' || keyName === 'enter') {
    return 'confirm';
  }
  if (chunk === 's') {
    return 'increase-high-speed';
  }
  if (chunk === 'S') {
    return 'decrease-high-speed';
  }
  if (lowerChunk === 'a') {
    return 'toggle-auto';
  }
  if (keyName === 'escape' || key.sequence === '\u001b') {
    return 'escape';
  }
  return undefined;
}

export function resolveSongSelectDifficultyFilter(
  chunk: string | undefined,
): SongSelectDifficultyFilter | null | undefined {
  if (chunk === '0') {
    return null;
  }
  if (chunk === '1' || chunk === '2' || chunk === '3' || chunk === '4' || chunk === '5') {
    return Number.parseInt(chunk, 10) as SongSelectDifficultyFilter;
  }
  return undefined;
}

export function resolveCircularSelectableIndex(current: number, delta: number, length: number): number {
  if (!Number.isFinite(length) || length <= 0) {
    return 0;
  }
  const safeCurrent = Number.isFinite(current) ? Math.floor(current) : 0;
  const safeDelta = Number.isFinite(delta) ? Math.floor(delta) : 0;
  const next = (safeCurrent + safeDelta) % length;
  return next >= 0 ? next : next + length;
}

export function resolveVisibleEntryRange(
  selectedIndex: number,
  entryCount: number,
  listRows: number,
): { start: number; end: number } {
  const safeEntryCount = Number.isFinite(entryCount) ? Math.max(0, Math.floor(entryCount)) : 0;
  const safeListRows = Number.isFinite(listRows) ? Math.max(1, Math.floor(listRows)) : 1;
  if (safeEntryCount <= 0) {
    return { start: 0, end: 0 };
  }
  const safeSelectedIndex = Number.isFinite(selectedIndex)
    ? Math.max(0, Math.min(safeEntryCount - 1, Math.floor(selectedIndex)))
    : 0;
  const page = Math.floor(safeSelectedIndex / safeListRows);
  const start = page * safeListRows;
  const end = Math.min(safeEntryCount, start + safeListRows);
  return { start, end };
}

export function resolvePageSelectableIndex(
  selectableIndexes: number[],
  selectedIndex: number,
  entryCount: number,
  listRows: number,
  direction: SongSelectPageDirection,
): number {
  if (selectableIndexes.length === 0) {
    return 0;
  }
  const { start, end } = resolveVisibleEntryRange(selectedIndex, entryCount, listRows);
  if (direction === 'down') {
    const next = selectableIndexes.find((index) => index >= end);
    return typeof next === 'number' ? next : selectableIndexes[0]!;
  }

  for (let index = selectableIndexes.length - 1; index >= 0; index -= 1) {
    const candidate = selectableIndexes[index]!;
    if (candidate < start) {
      return candidate;
    }
  }
  return selectableIndexes[selectableIndexes.length - 1]!;
}

export function resolveResultScreenActionFromKey(
  chunk: string | undefined,
  key: readline.Key,
): ResultScreenAction | undefined {
  if (key.sequence === '\u0003') {
    return 'ctrl-c';
  }
  const keyName = key.name?.toLowerCase();
  if (keyName === 'return' || keyName === 'enter') {
    return 'enter';
  }
  if (keyName === 'escape' || key.sequence === '\u001b') {
    return 'enter';
  }
  if (typeof chunk === 'string' && chunk.toLowerCase() === 'r') {
    return 'replay';
  }
  return undefined;
}

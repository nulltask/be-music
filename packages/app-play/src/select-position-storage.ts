// The select screen's position kept across visits: the open folders, the cursor and the bar under it, so the next visit
// opens where the player left. Only the position is kept; the search, the favourites and the list options are not.
import type { BrowseSnapshot } from '@be-music/player-scene-model';

/** `localStorage` key of the select screen's position on the last visit. */
export const SELECT_POSITION_STORAGE_KEY = 'be-music.select-position';

/**
 * The position part of `snapshot`, or `undefined` when no bar was under the cursor (an empty library): keeping that
 * would replace a position the next visit can still find with the top of an empty list.
 */
export function selectPositionOf(snapshot: BrowseSnapshot | undefined): BrowseSnapshot | undefined {
  if (snapshot?.focusKey === undefined) return undefined;
  return { folderPath: [...snapshot.folderPath], cursors: [...snapshot.cursors], focusKey: snapshot.focusKey };
}

/** A stored position, or `undefined` when it is missing or not one. */
export function parseStoredSelectPosition(raw: string | null | undefined): BrowseSnapshot | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const { folderPath, cursors, focusKey } = value as Record<string, unknown>;
  if (!Array.isArray(folderPath) || !folderPath.every((label) => typeof label === 'string')) return undefined;
  if (
    !Array.isArray(cursors) ||
    cursors.length !== folderPath.length + 1 ||
    !cursors.every((cursor) => Number.isSafeInteger(cursor) && cursor >= 0)
  ) {
    return undefined;
  }
  if (typeof focusKey !== 'string' || focusKey === '') return undefined;
  return { folderPath, cursors, focusKey };
}

/** The position kept from the last visit, or `undefined` when none is kept or storage is blocked. */
export function readStoredSelectPosition(
  storage: Pick<Storage, 'getItem'> | undefined = defaultStorage(),
): BrowseSnapshot | undefined {
  try {
    return parseStoredSelectPosition(storage?.getItem(SELECT_POSITION_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

/** Keeps the position of `snapshot` for the next visit; a snapshot with no bar under the cursor keeps the last one. */
export function storeSelectPosition(
  snapshot: BrowseSnapshot | undefined,
  storage: Pick<Storage, 'setItem'> | undefined = defaultStorage(),
): void {
  const position = selectPositionOf(snapshot);
  if (position === undefined) return;
  try {
    storage?.setItem(SELECT_POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Private windows / blocked storage: the next visit opens at the top.
  }
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

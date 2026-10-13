import { groupSongsByFolder, type BrowserSongEntry } from '@be-music/player-web/collection';
import type { PixiSongSelectNavigation } from '@be-music/player-web/scenes';

/**
 * Where the select screen opens after a drop: in the dropped folder when the drop added one, or on the folder list with
 * the cursor on the first of them when it added several. Undefined when the drop added no songs (a theme or a play log
 * alone), so the screen stays where it was.
 *
 * Folders are the select screen's top-level groups (`groupSongsByFolder`), so a dropped pack opens as the pack, and a
 * dropped song folder as that song.
 */
export function navigationAfterDrop(
  songs: readonly BrowserSongEntry[],
  previousSongIds: ReadonlySet<string>,
): PixiSongSelectNavigation | undefined {
  const added = songs.filter((song) => !previousSongIds.has(song.id));
  if (added.length === 0) return undefined;
  const addedLabels = new Set(groupSongsByFolder(added).map((folder) => folder.label));
  if (addedLabels.size === 1) return { folderPath: [...addedLabels], selectedIndex: 0 };
  const folders = groupSongsByFolder(songs);
  const first = folders.findIndex((folder) => addedLabels.has(folder.label));
  return { folderPath: [], selectedIndex: Math.max(0, first) };
}

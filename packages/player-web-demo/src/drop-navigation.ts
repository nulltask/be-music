import { groupChartsByFolder, type BrowseSnapshot, type LibraryChart } from '@be-music/scene-model';

/**
 * Where the select screen opens after a drop, as a browse snapshot (`@be-music/scene-model`): in the dropped folder when
 * the drop added one, or on the folder list with the cursor on the first of them when it added several. Undefined when
 * the drop added no songs (a theme or a play log alone), so the screen stays where it was.
 *
 * Folders are the select screen's top-level groups (`groupChartsByFolder`), so a dropped pack opens as the pack, and a
 * dropped song folder as that song. Chart folders come first at the root, so a folder's place among them is its bar.
 */
export function navigationAfterDrop(
  songs: readonly LibraryChart[],
  previousSongIds: ReadonlySet<string>,
): BrowseSnapshot | undefined {
  const added = songs.filter((song) => !previousSongIds.has(song.id));
  if (added.length === 0) return undefined;
  const addedLabels = new Set(groupChartsByFolder(added).map((folder) => folder.label));
  const folders = groupChartsByFolder(songs);
  const first = Math.max(
    0,
    folders.findIndex((folder) => addedLabels.has(folder.label)),
  );
  if (addedLabels.size === 1) return { folderPath: [...addedLabels], cursors: [first, 0] };
  return { folderPath: [], cursors: [first] };
}

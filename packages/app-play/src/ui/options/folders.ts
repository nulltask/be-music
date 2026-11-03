// Layout and persistence helpers for the player's Options dialog (`OptionsDialog`). The tabs, the folder titles, their
// order, and which ones start open live here so the structure reads in one place and stays testable; `index.ts` binds
// the controllers.

import {
  defaultStorage,
  folderPath,
  readFolderOpenStates,
  storeFolderOpenStates,
  type PlayerStorage,
} from '../../player-storage.ts';
export * from '../../player-storage.ts';

/** An Options dialog folder: its title and whether it starts open before the user has opened or closed it. */
export interface OptionFolderSpec {
  readonly title: string;
  readonly open: boolean;
}

/**
 * Every folder of the Options dialog, top to bottom. A folder a tab holds (`OPTIONS_TABS`) is a section that is always
 * open; the folders inside those sections collapse, and start open or closed as `open` says.
 */
export const OPTION_FOLDERS = {
  playOptions: { title: 'Play options', open: true },
  replayView: { title: 'Replay / ghost', open: false },
  tempo: { title: 'Tempo', open: true },
  course: { title: 'Course', open: true },
  skin: { title: 'Skin & display', open: false },
  beatorajaSkins: { title: 'Beatoraja skins', open: true },
  skinSettings: { title: 'Skin settings', open: true },
  addSkin: { title: 'Add skin', open: false },
  audio: { title: 'Audio', open: true },
  compressor: { title: 'Compressor', open: false },
  compressorStages: { title: 'Stages', open: true },
  library: { title: 'Library & records', open: false },
  replaySlots: { title: 'Replay slots', open: true },
  bgaTranscode: { title: 'BGA video transcode', open: false },
  capture: { title: 'Capture', open: false },
  leaderboard: { title: 'Leaderboard', open: false },
  developer: { title: 'Developer', open: false },
} as const satisfies Record<string, OptionFolderSpec>;

/**
 * The Options dialog's tabs, left to right: Play (Play options), Tempo & course, Skin & display, Audio, Library (the
 * status, opening files, Library & records and Capture), Leaderboard and Developer.
 */
export const OPTIONS_TABS = [
  'Play',
  'Tempo & course',
  'Skin & display',
  'Audio',
  'Library',
  'Leaderboard',
  'Developer',
] as const;

/** Public folder state used by the dialog's persistence logic. */
export interface FolderNode {
  readonly title: string | undefined;
  expanded: boolean;
  readonly children: readonly unknown[];
  on(event: 'fold', callback: (event: { expanded: boolean }) => void): unknown;
}

/** Folder paths exclude the root dialog and tab page titles, preserving earlier stored keys. */
export function folderEntries(root: FolderNode): { folder: FolderNode; titles: readonly string[] }[] {
  const entries: { folder: FolderNode; titles: readonly string[] }[] = [];
  const walk = (node: unknown, titles: readonly string[]): void => {
    if (typeof node !== 'object' || node === null) return;
    const container = node as { children?: readonly unknown[]; pages?: readonly unknown[] };
    let path = titles;
    if ('expanded' in node && 'title' in node && 'on' in node && Array.isArray(container.children)) {
      const folder = node as FolderNode;
      path = node === root ? [] : [...titles, folder.title ?? ''];
      entries.push({ folder, titles: path });
    }
    for (const child of container.children ?? []) walk(child, path);
    for (const page of container.pages ?? []) walk(page, path);
  };
  walk(root, []);
  return entries;
}

/** Restore child folder states before subscribing; the root dialog always starts closed. */
export function rememberFolderOpenStates(
  root: FolderNode,
  storage: PlayerStorage | undefined = defaultStorage(),
  onFold?: () => void,
): void {
  const states = readFolderOpenStates(storage);
  const entries = folderEntries(root).filter(({ folder }) => folder !== root);
  for (const { folder, titles } of entries) {
    const remembered = states[folderPath(titles)];
    if (remembered !== undefined) folder.expanded = remembered;
  }
  for (const { folder, titles } of entries) {
    folder.on('fold', () => {
      states[folderPath(titles)] = folder.expanded;
      storeFolderOpenStates(states, storage);
      onFold?.();
    });
  }
}

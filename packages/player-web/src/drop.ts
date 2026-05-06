import { dirname, normalizePath } from '@be-music/utils/core';

export interface BrowserDropFileLike {
  readonly name: string;
  readonly webkitRelativePath?: string;
}

export interface SplitDroppedSongAndThemeFilesResult<TFile extends BrowserDropFileLike> {
  themeFiles: TFile[];
  songFiles: TFile[];
}

const CHART_EXTENSIONS = new Set(['.bms', '.bme', '.bml', '.pms', '.bmson']);

export function isChartFilePath(path: string): boolean {
  return CHART_EXTENSIONS.has(extensionOf(path));
}

/**
 * `true` when the dropped file looks like an LR2 skin entry. Used to gate the LR2 theme loader so a stray text file
 * inside a chart pack doesn't reset the active theme to "no LR2 theme".
 */
export function isLr2SkinFilePath(path: string): boolean {
  return extensionOf(path) === '.lr2skin';
}

/**
 * `true` when the dropped file looks like a beatoraja Lua skin entry. We treat `.luaskin` as the unambiguous marker;
 * `.json` is too generic to count by itself (charts ship `score.json`, packs ship `info.json`, etc.). The discovery
 * pass inspects neighbouring `.json` files once a `.luaskin` is confirmed.
 */
export function isBeatorajaLuaSkinFilePath(path: string): boolean {
  return extensionOf(path) === '.luaskin';
}

/**
 * Heuristic for "this dropped folder probably contains a beatoraja skin theme". Used to gate the beatoraja theme
 * loader the same way {@link isLr2SkinFilePath} gates LR2's. Triggers on:
 *
 * - any `.luaskin` file (definitive),
 * - or a `.json` file whose path includes a `skin/` segment (matches the standard `beatoraja/skin/<name>/…` layout).
 */
export function isBeatorajaSkinIndicator(path: string): boolean {
  if (isBeatorajaLuaSkinFilePath(path)) return true;
  if (extensionOf(path) !== '.json') return false;
  const lower = path.toLowerCase();
  return lower.includes('/skin/') || lower.startsWith('skin/');
}

export function resolveDropFilePath(file: BrowserDropFileLike): string {
  return normalizePath(file.webkitRelativePath || file.name);
}

export function splitDroppedSongAndThemeFiles<TFile extends BrowserDropFileLike>(
  files: readonly TFile[],
): SplitDroppedSongAndThemeFilesResult<TFile> {
  const songDirPrefixes = new Set<string>();
  for (const file of files) {
    const path = resolveDropFilePath(file);
    if (isChartFilePath(path)) {
      songDirPrefixes.add(dirname(path));
    }
  }

  if (songDirPrefixes.size === 0) {
    return { themeFiles: [...files], songFiles: [] };
  }

  const isSongPath = (path: string): boolean => {
    for (const dir of songDirPrefixes) {
      if (dir === '') {
        return true;
      }
      if (path === dir || path.startsWith(`${dir}/`)) {
        return true;
      }
    }
    return false;
  };

  const themeFiles: TFile[] = [];
  const songFiles: TFile[] = [];
  for (const file of files) {
    const path = resolveDropFilePath(file);
    if (isSongPath(path)) {
      songFiles.push(file);
    } else {
      themeFiles.push(file);
    }
  }
  return { themeFiles, songFiles };
}

function extensionOf(path: string): string {
  const dotIndex = path.lastIndexOf('.');
  return dotIndex >= 0 ? path.slice(dotIndex).toLowerCase() : '';
}

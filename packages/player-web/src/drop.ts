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

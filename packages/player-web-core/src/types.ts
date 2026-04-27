import type { BeMusicJson } from '@be-music/json';

export type BrowserSongSourceKind = 'directory' | 'zip' | 'files';

export interface BrowserSongAssetSource {
  id: string;
  kind: BrowserSongSourceKind;
  label: string;
  files: ReadonlyMap<string, Uint8Array>;
}

export interface BrowserSongEntry {
  id: string;
  sourceId: string;
  sourceLabel: string;
  sourceKind: BrowserSongSourceKind;
  chartPath: string;
  directoryLabel: string;
  fileLabel: string;
  title: string;
  subtitle?: string;
  artist?: string;
  genre?: string;
  playLevel?: number | string;
  bpm?: number;
  totalNotes: number;
  chart: BeMusicJson;
}

export interface BrowserSongCollection {
  sources: BrowserSongAssetSource[];
  songs: BrowserSongEntry[];
  errors: Array<{ sourceId: string; path?: string; message: string }>;
}

/**
 * One folder of songs surfaced by `groupSongsByFolder`. The label is
 * the human-readable folder name (top-level directory inside the
 * source, falling back to the source label) and `songs` are all the
 * BMS charts whose `directoryLabel` resolves to it.
 */
export interface BrowserFolderNode {
  label: string;
  songs: readonly BrowserSongEntry[];
}

/**
 * One entry in the bar list when navigating the song collection. A
 * select view either shows folder bars (when at the root) or song
 * bars (when inside a folder).
 */
export type BrowserBrowseEntry =
  | { kind: 'folder'; folder: BrowserFolderNode }
  | { kind: 'song'; song: BrowserSongEntry };

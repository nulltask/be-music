import type { BeMusicJson } from '@be-music/json';

/** Where a song came from: a dropped directory, a zip, or loose files. */
export type BrowserSongSourceKind = 'directory' | 'zip' | 'files';

/** One chart in the song collection: its metadata and the parsed chart. */
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

/**
 * One folder of songs surfaced by `groupSongsByFolder`. The label is the human-readable folder name (top-level
 * directory inside the source, falling back to the source label) and `songs` are all the BMS charts whose
 * `directoryLabel` resolves to it.
 */
export interface BrowserFolderNode {
  label: string;
  songs: readonly BrowserSongEntry[];
}

/**
 * One entry in the bar list when navigating the song collection. A select view either shows folder bars (when at the
 * root) or song bars (when inside a folder).
 */
export type BrowserBrowseEntry =
  | { kind: 'folder'; folder: BrowserFolderNode }
  | { kind: 'song'; song: BrowserSongEntry };

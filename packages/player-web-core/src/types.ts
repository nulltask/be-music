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

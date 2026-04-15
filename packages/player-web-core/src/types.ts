import type { BeMusicJson, BeMusicPlayLevel } from '@be-music/json';

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
  subartist?: string;
  genre?: string;
  comment?: string;
  bannerPath?: string;
  previewContinueKey?: string;
  totalNotes?: number;
  player?: number;
  difficulty?: number;
  rank?: number;
  rankLabel?: string;
  playLevel?: BeMusicPlayLevel;
  bpm?: number;
  bpmInitial?: number;
  bpmMin?: number;
  bpmMax?: number;
  chart: BeMusicJson;
}

export interface BrowserSongCollectionError {
  sourceId: string;
  path?: string;
  message: string;
}

export interface BrowserSongCollection {
  sources: BrowserSongAssetSource[];
  songs: BrowserSongEntry[];
  errors: BrowserSongCollectionError[];
}

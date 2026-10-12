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
  /** The notes a play scores: judged notes without FREE ZONE tails; mines and invisible objects are not notes. */
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

/** A song image a host can hand a skin: the chart's `#STAGEFILE`, `#BANNER`, or `#BACKBMP`. */
export type BeMusicSongImageKind = 'stageFile' | 'banner' | 'backBmp';

/**
 * Clear lamp of a play or a best record, worst first: not played, failed, then the gauge the chart was cleared on
 * (ASSIST EASY … EX HARD), FULL COMBO (no BAD / POOR), PERFECT (no GOOD or worse), and MAX (every note a PGREAT).
 */
export type BeMusicClearLamp =
  | 'NO_PLAY'
  | 'FAILED'
  | 'ASSIST_EASY'
  | 'EASY'
  | 'NORMAL'
  | 'HARD'
  | 'EX_HARD'
  | 'FULL_COMBO'
  | 'PERFECT'
  | 'MAX';

/** The player's best record on one chart, as a host keeps it. */
export interface BeMusicSongRecord {
  /** Best clear lamp so far. */
  lamp: BeMusicClearLamp;
  exScore?: number;
  maxCombo?: number;
  /** Fewest BAD + POOR. */
  missCount?: number;
  /** How many times the chart was played. */
  playCount?: number;
}

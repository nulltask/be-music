import type { BeMusicJson } from '@be-music/json';

export type BrowserSongSourceKind = 'directory' | 'zip' | 'files';

/**
 * Asset payload kept inside a {@link BrowserSongAssetSource}. Each file from the dropped bundle is either:
 *
 * - **`Uint8Array`** — bytes already in memory. Used for small files that are accessed synchronously by parsers / image
 *   decoders (`.bms`, `.bmson`, `.bmp`, `.png`, `.tga`, `.csv`, `.dxa`, `.lr2skin`, …).
 * - **`File`** — lazy reference. The bytes haven't been materialized yet and will be read on demand via
 *   `loadAssetBytes`. Used for audio (`.wav`, `.ogg`, `.mp3`, `.opus`, `.flac`, `.oga`) where a single drop can carry
 *   gigabytes of WAV samples that are only needed for the currently-playing chart.
 *
 * Consumers that always hand a non-audio path call the existing sync helpers and receive the `Uint8Array` branch by
 * construction. Audio consumers go through `loadAssetBytes` / `resolveChartAudioAsset` to handle the lazy branch
 * transparently.
 */
export type BrowserSongAssetEntry = Uint8Array | File;

export interface BrowserSongAssetSource {
  id: string;
  kind: BrowserSongSourceKind;
  label: string;
  files: ReadonlyMap<string, BrowserSongAssetEntry>;
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

/**
 * Phases reported by the dropped-folder loaders so a host UI can show a meaningful "Loading…" state instead of a frozen
 * unresponsive screen.
 *
 * - `enumerating` — walking the dropped FileSystem entries to collect every nested file. Total is unknown while
 *   walking, so `total` is `-1` and `current` ticks upward.
 * - `reading` — slurping each collected `File` into a `Uint8Array`. This is the dominant cost for large zip / folder
 *   drops.
 * - `parsing` — running `parseBms` / `parseBmson` on each chart file inside the source, building `BrowserSongEntry`s.
 * - `theme` — loading the LR2 theme bundle (skins + BGM + system sounds). Theme work happens in parallel internally;
 *   events fire as each sub-task lands so the bar still moves.
 */
export type LoadProgressPhase = 'enumerating' | 'reading' | 'parsing' | 'theme';

export interface LoadProgress {
  phase: LoadProgressPhase;
  /** 1-based "items completed so far" — 0 when the phase starts. */
  current: number;
  /** Expected total. `-1` while still being discovered. */
  total: number;
  /** Friendly per-item label (filename / sub-task) for the UI. */
  label?: string;
}

export type LoadProgressCallback = (progress: LoadProgress) => void;

import type { BrowserSongEntry, BrowserSongSourceKind } from '@be-music/skin-sdk';
import type { BrowserDroppedFile } from './dropped-file.ts';

export type {
  BrowserBrowseEntry,
  BrowserFolderNode,
  BrowserSongEntry,
  BrowserSongSourceKind,
} from '@be-music/skin-sdk';

/**
 * Asset payload kept inside a {@link BrowserSongAssetSource}. Each file from the dropped bundle is either:
 *
 * - **`Uint8Array`** — bytes already in memory. Used for small files that are accessed synchronously by parsers / image
 *   decoders (`.bms`, `.bmson`, `.bmp`, `.png`, `.tga`, `.csv`, `.dxa`, `.lr2skin`, …).
 * - **`File` / `DeferredDroppedFile`** — lazy reference. The bytes haven't been materialized yet and will be read on
 *   demand via `loadAssetBytes`; a `DeferredDroppedFile` from a folder drop hasn't even been opened yet. Used for audio (`.wav`, `.ogg`, `.mp3`, `.opus`, `.flac`, `.oga`) where a single drop can carry
 *   gigabytes of WAV samples that are only needed for the currently-playing chart.
 *
 * Consumers that always hand a non-audio path call the existing sync helpers and receive the `Uint8Array` branch by
 * construction. Audio consumers go through `loadAssetBytes` / `resolveChartAudioAsset` to handle the lazy branch
 * transparently.
 */
export type BrowserSongAssetEntry = Uint8Array | BrowserDroppedFile;

export interface BrowserSongAssetSource {
  id: string;
  kind: BrowserSongSourceKind;
  label: string;
  files: ReadonlyMap<string, BrowserSongAssetEntry>;
}

export interface BrowserSongCollection {
  sources: BrowserSongAssetSource[];
  songs: BrowserSongEntry[];
  errors: Array<{ sourceId: string; path?: string; message: string }>;
}

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

import { zipSync } from 'fflate';
import { describe, expect, test, vi } from 'vitest';
import {
  BrowserSongCollectionStore,
  loadSongCollectionFromFiles,
  resolveChartAudioAsset,
  resolveChartImageAsset,
  resolveChartPlayVariant,
} from './collection.ts';
import type { BeMusicEvent, BeMusicJson } from '../../../json/src/index.ts';
import type { BrowserSongAssetEntry, BrowserSongAssetSource, BrowserSongEntry, LoadProgress } from './types.ts';

/**
 * The drag-drop loader fires `LoadProgress` events as it walks the `reading` and `parsing` phases so the host UI can
 * show a determinate progress bar. Without progress, a thousand-file folder drop looks indistinguishable from a frozen
 * page. These tests pin the contract: every file produces a reading event, every chart produces a parsing event, and
 * the totals stay in sync with the actual work.
 *
 * The fixture `File`s are minimal stubs — `arrayBuffer()` returns a tiny but valid BMS chart so
 * `loadSongCollectionFromFiles` actually parses them and we exercise the parsing-phase emitter end-to-end.
 */

function makeFile(path: string, contents = ''): File {
  // Browsers in node's vitest environment expose the global `File` class; the chart parser only consults `name`,
  // `webkitRelativePath`, and `arrayBuffer()`, so a thin stub is enough — no need to spin up a real Blob.
  const bytes = new TextEncoder().encode(contents);
  const stub: Partial<File> = {
    name: path.split('/').at(-1) ?? path,
    webkitRelativePath: path,
    arrayBuffer: () => Promise.resolve(bytes.buffer),
  };
  return stub as File;
}

function makeZipFile(name: string, entries: Record<string, string>): File {
  const zipped = zipSync(
    Object.fromEntries(Object.entries(entries).map(([path, contents]) => [path, new TextEncoder().encode(contents)])),
  );
  const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
  return {
    name,
    webkitRelativePath: '',
    size: zipped.byteLength,
    arrayBuffer: () => Promise.resolve(buffer),
  } as File;
}

const MINIMAL_BMS = ['#TITLE Test', '#BPM 120', '#PLAYER 1', '#00111:0F'].join('\n');

describe('loadSongCollectionFromFiles progress events', () => {
  test('reports the reading phase with a monotonic current and a guaranteed terminal event', async () => {
    const events: LoadProgress[] = [];
    await loadSongCollectionFromFiles(
      [makeFile('Song/main.bms', MINIMAL_BMS), makeFile('Song/kick.wav'), makeFile('Song/snare.wav')],
      { onProgress: (event) => events.push(event) },
    );
    const reading = events.filter((event) => event.phase === 'reading');
    // Reads are pooled in parallel and per-file progress is throttled to ~30 fps so a 4000-file drop doesn't generate a
    // 4000-call storm. The contract is therefore relaxed: - At least an initial 0/N + a terminal N/N event must fire. -
    // `current` must never go backwards. - The last event hits 100% (drives the host's "load done" transition).
    expect(reading.length).toBeGreaterThanOrEqual(2);
    expect(reading[0]).toMatchObject({ current: 0, total: 3 });
    expect(reading.at(-1)).toMatchObject({ current: 3, total: 3 });
    const currents = reading.map((event) => event.current);
    for (let i = 1; i < currents.length; i += 1) {
      expect(currents[i]!).toBeGreaterThanOrEqual(currents[i - 1]!);
    }
  });

  test('reports a parsing event per chart file (skipping non-charts)', async () => {
    const events: LoadProgress[] = [];
    await loadSongCollectionFromFiles(
      [
        makeFile('Pack/A/main.bms', MINIMAL_BMS),
        makeFile('Pack/A/kick.wav'),
        makeFile('Pack/B/extra.bms', MINIMAL_BMS),
      ],
      { onProgress: (event) => events.push(event) },
    );
    const parsing = events.filter((event) => event.phase === 'parsing');
    // Two BMS charts → "0 / 2" prelude + per-chart events == 3 events.
    expect(parsing.length).toBe(3);
    expect(parsing[0]).toMatchObject({ current: 0, total: 2 });
    expect(parsing.at(-1)).toMatchObject({ current: 2, total: 2 });
  });

  test('omits the parsing prelude when no chart files are present', async () => {
    // A theme-only / no-chart drop must NOT emit a "0 / 0" parsing event — the UI would otherwise flash a determinate
    // "Parsing 0 / 0" before disappearing, which is jarring.
    const events: LoadProgress[] = [];
    await loadSongCollectionFromFiles([makeFile('Theme/cover.png')], {
      onProgress: (event) => events.push(event),
    });
    expect(events.some((event) => event.phase === 'parsing')).toBe(false);
  });

  test('survives without an onProgress callback (calls are guarded)', async () => {
    // The progress hook is optional; supplying no options must not throw. Acts as a safety net so existing callers (and
    // tests) that haven't migrated keep working.
    const collection = await loadSongCollectionFromFiles([makeFile('Song/main.bms', MINIMAL_BMS)]);
    expect(collection.songs.length).toBe(1);
  });

  test('loads charts from zip archives', async () => {
    const collection = await loadSongCollectionFromFiles([makeZipFile('Pack.zip', { 'Song/main.bms': MINIMAL_BMS })]);

    expect(collection.sources).toHaveLength(1);
    expect(collection.sources[0]?.kind).toBe('zip');
    expect(collection.songs.map((song) => song.chartPath)).toEqual(['Song/main.bms']);
  });

  test('rejects oversized zip archives before reading their bytes', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const oversized = {
      name: 'Huge.zip',
      webkitRelativePath: '',
      size: Number.MAX_SAFE_INTEGER,
      arrayBuffer,
    } as unknown as File;

    const collection = await loadSongCollectionFromFiles([oversized]);

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(collection.sources).toHaveLength(0);
    expect(collection.errors[0]).toMatchObject({
      sourceId: 'zip:Huge.zip',
    });
    expect(collection.errors[0]?.message).toContain('ZIP archive is too large');
  });
});

describe('BrowserSongCollectionStore', () => {
  test('appendFromFiles accumulates drops with collision-safe source and song ids', async () => {
    const store = new BrowserSongCollectionStore();

    const first = await store.appendFromFiles([makeFile('PackA/main.bms', MINIMAL_BMS)]);
    expect(first).toBe(store.collection);
    expect(first.sources).toHaveLength(1);
    expect(first.songs).toHaveLength(1);
    expect(first.sources[0]?.id).toMatch(/^drop1-/u);
    expect(first.songs[0]?.id).toMatch(/^drop1-/u);
    expect(first.songs[0]?.sourceId).toBe(first.sources[0]?.id);

    const second = await store.appendFromFiles([makeFile('PackB/main.bms', MINIMAL_BMS)]);
    expect(second).toBe(store.collection);
    expect(second.sources).toHaveLength(2);
    expect(second.songs).toHaveLength(2);
    expect(second.sources.map((source) => source.id)).toEqual(['drop1-files:0', 'drop2-files:0']);
    expect(second.songs.map((song) => song.sourceId)).toEqual(['drop1-files:0', 'drop2-files:0']);
  });

  test('loadFromFiles replaces the collection and resets the next append prefix', async () => {
    const store = new BrowserSongCollectionStore();
    await store.appendFromFiles([makeFile('PackA/main.bms', MINIMAL_BMS)]);

    const replaced = await store.loadFromFiles([makeFile('PackB/main.bms', MINIMAL_BMS)]);
    expect(replaced).toBe(store.collection);
    expect(replaced.sources.map((source) => source.id)).toEqual(['files:0']);
    expect(replaced.songs.map((song) => song.sourceId)).toEqual(['files:0']);

    const appended = await store.appendFromFiles([makeFile('PackC/main.bms', MINIMAL_BMS)]);
    expect(appended.sources.map((source) => source.id)).toEqual(['files:0', 'drop1-files:0']);
    expect(appended.songs.map((song) => song.sourceId)).toEqual(['files:0', 'drop1-files:0']);
  });

  test('loadFromDrop replaces the collection from DataTransfer files', async () => {
    const store = new BrowserSongCollectionStore();
    await store.appendFromFiles([makeFile('PackA/main.bms', MINIMAL_BMS)]);

    const loaded = await store.loadFromDrop({
      files: [makeFile('PackB/main.bms', MINIMAL_BMS)],
    } as unknown as DataTransfer);
    expect(loaded).toBe(store.collection);
    expect(loaded.sources.map((source) => source.id)).toEqual(['files:0']);
    expect(loaded.songs.map((song) => song.sourceId)).toEqual(['files:0']);
  });
});

/**
 * Minimal `BrowserSongEntry` factory for `resolveChartPlayVariant` tests. Only the fields the resolver consults
 * (`chartPath` for the `.pms` extension hint, `chart.events[*].channel` for lane usage, `chart.bms.player` for the
 * legacy `#PLAYER=3` 9K marker) are populated — everything else is left at minimal defaults.
 */
function makeSong(params: { chartPath: string; channels?: ReadonlyArray<string>; player?: number }): BrowserSongEntry {
  const events: BeMusicEvent[] = (params.channels ?? []).map((channel, index) => ({
    measure: 1,
    channel,
    position: [index, Math.max(1, params.channels?.length ?? 1)],
    value: '01',
  }));
  const chart = {
    events,
    bms: { player: params.player } as BeMusicJson['bms'],
    bmson: { info: { modeHint: undefined } } as BeMusicJson['bmson'],
  } as BeMusicJson;
  return {
    chartPath: params.chartPath,
    chart,
  } as BrowserSongEntry;
}

describe('resolveChartPlayVariant', () => {
  test('classifies SP 5K (channels 11..15 only)', () => {
    expect(resolveChartPlayVariant(makeSong({ chartPath: 'Song/main.bms', channels: ['11', '12', '15'] }))).toBe('5');
  });

  test('classifies SP 7K (channel 18 / 19 present)', () => {
    expect(resolveChartPlayVariant(makeSong({ chartPath: 'Song/main.bme', channels: ['11', '15', '18', '19'] }))).toBe(
      '7',
    );
  });

  test('classifies DP 14K (2P-side keyboard 6 / 7)', () => {
    expect(resolveChartPlayVariant(makeSong({ chartPath: 'Song/main.bme', channels: ['11', '18', '21', '28'] }))).toBe(
      '14',
    );
  });

  test('classifies DP 10K (2P-side keyboard, no 6 / 7)', () => {
    expect(resolveChartPlayVariant(makeSong({ chartPath: 'Song/main.bme', channels: ['11', '21', '25'] }))).toBe('10');
  });

  test('PMS / 9 KEY: `.pms` extension wins regardless of channel layout', () => {
    // A `.pms` chart can use either the BME-COMPAT channel layout (`16..19`) or the PMS-STD layout (`22..25`). The
    // extension alone is enough to commit to `play_9.lr2skin`.
    expect(
      resolveChartPlayVariant(
        makeSong({ chartPath: 'Song/main.pms', channels: ['11', '12', '13', '14', '15', '16', '17', '18', '19'] }),
      ),
    ).toBe('9');
    expect(
      resolveChartPlayVariant(makeSong({ chartPath: 'Song/main.PMS', channels: ['11', '15', '22', '23', '24', '25'] })),
    ).toBe('9');
  });

  test('PMS / 9 KEY: `#PLAYER=3` paired with channel 17 is the legacy `.bms` marker', () => {
    expect(
      resolveChartPlayVariant(
        makeSong({ chartPath: 'Song/main.bms', channels: ['11', '15', '17', '18', '19'], player: 3 }),
      ),
    ).toBe('9');
  });

  test('PMS / 9 KEY: any of `22..25` (without traditional IIDX 2P channels `21`/`26..29`) routes to 9', () => {
    // PMS-STD detection: presence of any POPN-specific channel (`22..25`) combined with the ABSENCE
    // of `21` / `26..29` (the genuine IIDX 2P-side channels). Holds across `.bme` / `.bms` extensions
    // and across various 1P-side configurations (with / without scratch, with / without 6-7K). User-
    // reported symptom: charts that author PMS-STD content under a non-`.pms` extension were silently
    // classified as IIDX `'10'` / `'14'` and the engine's POPN-9 lane bindings on `22..25` were lost.
    expect(
      resolveChartPlayVariant(
        makeSong({ chartPath: 'Song/main.bme', channels: ['11', '12', '13', '14', '15', '22', '23', '24', '25'] }),
      ),
    ).toBe('9');
    // Hybrid PMS-STD with 1P scratch — non-standard authoring but `22..25` is the POPN-specific
    // discriminator, so still POPN-9.
    expect(
      resolveChartPlayVariant(
        makeSong({
          chartPath: 'Song/main.bme',
          channels: ['11', '12', '13', '14', '15', '16', '22', '23', '24', '25'],
        }),
      ),
    ).toBe('9');
    // Sparse — single POPN-side channel use.
    expect(resolveChartPlayVariant(makeSong({ chartPath: 'Song/main.bms', channels: ['11', '15', '22'] }))).toBe('9');
    // Genuine IIDX 5K DP — has scratch on both sides AND channel `21`. PMS-STD detection requires the
    // ABSENCE of `21`/`26..29`, so this stays at `'10'`.
    expect(
      resolveChartPlayVariant(
        makeSong({ chartPath: 'Song/main.bms', channels: ['11', '15', '16', '21', '22', '25', '26'] }),
      ),
    ).toBe('10');
  });

  test('PMS / 9 KEY: a `.bme` chart that authors all of `11..19` on `#PLAYER 1` is BME POPN-9', () => {
    // POPN-9 charts authored as `.bme` (the BME-COMPAT layout — `16`/`17`/`18`/`19` as POPN keys 6-9
    // instead of IIDX scratch / FREE-ZONE / 6 / 7) typically populate every one of `11..19`. IIDX 7K
    // uses at most 8 of those (`11..15 + 16 + 18 + 19`), so a full 1P keyboard is a strong POPN-9 signal.
    // Without this detection the chart fell through to `'7'` and the engine bound `16` as scratch and
    // `17` as FREE-ZONE.
    expect(
      resolveChartPlayVariant(
        makeSong({ chartPath: 'Song/main.bme', channels: ['11', '12', '13', '14', '15', '16', '17', '18', '19'] }),
      ),
    ).toBe('9');
  });
});

/**
 * Builds a tiny in-memory song source for testing the chart-asset resolver. The `files` map keys are relative paths
 * (matching how `loadSongCollectionFromFiles` populates the source); the chart path is fixed so each test only varies
 * the asset-side bytes.
 */
function makeAssetSource(files: Record<string, Uint8Array>): BrowserSongAssetSource {
  const map = new Map<string, BrowserSongAssetEntry>();
  for (const [key, value] of Object.entries(files)) {
    map.set(key, value);
  }
  // Only `files` is read by `resolveChartImageAsset`; the identity / label fields are required by the structural type
  // but never consulted here. Keep them tagged with the kind that drag-drop loaders produce so any future code path
  // that does branch on `kind` still gets a plausible value.
  return {
    id: 'test-source',
    kind: 'directory',
    label: 'test',
    files: map,
  };
}

describe('resolveChartImageAsset', () => {
  test('walks image-codec fallbacks (.png → .jpg → ...) for a `#BMPxx` declared as `.bmp`', () => {
    // Classic case the resolver was designed for: chart says `_logo.bmp` but the song folder ships `_logo.png`. We
    // expect the PNG bytes back.
    const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const source = makeAssetSource({ 'Song/_logo.png': PNG_BYTES });
    const entry = resolveChartImageAsset(source, 'Song/main.bms', '_logo.bmp');
    expect(entry).toBe(PNG_BYTES);
  });

  test('does NOT fall back to a same-basename `.png` when the chart referenced a video file', () => {
    // Regression: BMS charts often ship a still cover frame as `_scualee.png` alongside the actual `_scualee.mpg`.
    // Walking image candidates first would resolve `_scualee.mpg` to the PNG bytes, which then go through the video
    // pipeline (the BGA loader keys off the declared path's extension, not the resolved bytes), causing ffmpeg.wasm to
    // detect `png_pipe` and emit a frozen 1-frame MP4. We must short-circuit on video extensions and only return the
    // verbatim path.
    const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const MPG_BYTES = new Uint8Array([0x00, 0x00, 0x01, 0xb3]);
    const source = makeAssetSource({
      'Song/_scualee.png': PNG_BYTES,
      'Song/_scualee.mpg': MPG_BYTES,
    });
    const entry = resolveChartImageAsset(source, 'Song/main.bms', '_scualee.mpg');
    expect(entry).toBe(MPG_BYTES);
  });

  test('returns undefined for a `.mpg` reference when only a same-basename `.png` exists', () => {
    // Corollary of the regression test above — the resolver must refuse to silently substitute the PNG. The caller can
    // then fall back to whatever video-only logic it wants (skip the BGA, log a warning, etc.); pretending the asset
    // was found would just kick the surprise downstream.
    const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const source = makeAssetSource({ 'Song/_scualee.png': PNG_BYTES });
    const entry = resolveChartImageAsset(source, 'Song/main.bms', '_scualee.mpg');
    expect(entry).toBeUndefined();
  });

  test('handles every supported video extension consistently (no image fallback)', () => {
    // Locks in the contract for all extensions matched by the BGA loader's `isVideoExtension` regex — adding one there
    // without updating `imageFallbackPaths` would silently re-introduce the PNG fallback bug for the new extension.
    const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const VIDEO_EXTENSIONS = ['mpg', 'mpeg', 'mp4', 'm4v', 'avi', 'mov', 'wmv', 'webm', 'mkv'];
    for (const ext of VIDEO_EXTENSIONS) {
      const source = makeAssetSource({ 'Song/clip.png': PNG_BYTES });
      expect(resolveChartImageAsset(source, 'Song/main.bms', `clip.${ext}`)).toBeUndefined();
    }
  });
});

describe('resolveChartAudioAsset', () => {
  test('falls back through codec extensions when the chart-declared `.wav` is absent', () => {
    // Classic case the resolver was designed for: chart says `kick.wav` but the song folder ships `kick.ogg`. The codec
    // walk should pick up the OGG bytes.
    const OGG_BYTES = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);
    const source = makeAssetSource({ 'Song/kick.ogg': OGG_BYTES });
    const entry = resolveChartAudioAsset(source, 'Song/main.bms', 'kick.wav');
    expect(entry).toBe(OGG_BYTES);
  });

  test('appends extensions when the chart-declared name has no extension at all', () => {
    // bmson 1.0.0 spec: "A file extension may be omitted. […] Try piano.wav, piano.ogg, piano.m4a, …". Without this
    // fallback path, `name: "piano"` would never resolve to `piano.wav` on disk.
    const WAV_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    const source = makeAssetSource({ 'Song/piano.wav': WAV_BYTES });
    const entry = resolveChartAudioAsset(source, 'Song/main.bms', 'piano');
    expect(entry).toBe(WAV_BYTES);
  });

  test('respects the codec-priority order (opus → ogg → mp3 → wav → m4a) when multiple are present', () => {
    const OPUS_BYTES = new Uint8Array([1]);
    const OGG_BYTES = new Uint8Array([2]);
    const MP3_BYTES = new Uint8Array([3]);
    const WAV_BYTES = new Uint8Array([4]);
    const source = makeAssetSource({
      'Song/snare.opus': OPUS_BYTES,
      'Song/snare.ogg': OGG_BYTES,
      'Song/snare.mp3': MP3_BYTES,
      'Song/snare.wav': WAV_BYTES,
    });
    // Even though the chart authored `.wav`, the codec walk prefers `.opus` first since it ships the smallest payload
    // for browsers that support it.
    expect(resolveChartAudioAsset(source, 'Song/main.bms', 'snare.wav')).toBe(OPUS_BYTES);
  });

  test('honors the BMS #PATH_WAV prefix when supplied by the caller', () => {
    // Spec — `#PATH_WAV wav/` + `#WAV01 kick.wav` should resolve to `wav/kick.wav` on disk. The prefixed form is tried
    // first; the bare name is the fallback.
    const PREFIXED_BYTES = new Uint8Array([1, 2, 3]);
    const source = makeAssetSource({ 'Song/wav/kick.wav': PREFIXED_BYTES });
    expect(resolveChartAudioAsset(source, 'Song/main.bms', 'kick.wav', { pathPrefix: 'wav/' })).toBe(PREFIXED_BYTES);
  });

  test('falls back to the bare path when the #PATH_WAV-prefixed form is absent', () => {
    const BARE_BYTES = new Uint8Array([7, 8, 9]);
    const source = makeAssetSource({ 'Song/kick.wav': BARE_BYTES });
    // Prefix-joined `wav/kick.wav` doesn't exist; resolver should fall through to `kick.wav`.
    expect(resolveChartAudioAsset(source, 'Song/main.bms', 'kick.wav', { pathPrefix: 'wav/' })).toBe(BARE_BYTES);
  });

  test('does NOT double-prefix when the sample path already includes the #PATH_WAV directory', () => {
    // `wav/kick.wav` with `#PATH_WAV wav/` should NOT produce a `wav/wav/kick.wav` candidate; the resolver picks up the
    // bare-path candidate (which already includes `wav/`).
    const PREFIXED_BYTES = new Uint8Array([5, 6, 7]);
    const source = makeAssetSource({ 'Song/wav/kick.wav': PREFIXED_BYTES });
    expect(resolveChartAudioAsset(source, 'Song/main.bms', 'wav/kick.wav', { pathPrefix: 'wav/' })).toBe(
      PREFIXED_BYTES,
    );
  });

  test('falls back to .m4a when only AAC ships', () => {
    // The bmson spec example explicitly mentions `.m4a` as a valid codec; this exercises the new entry in the candidate
    // list.
    const M4A_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]);
    const source = makeAssetSource({ 'Song/voice.m4a': M4A_BYTES });
    expect(resolveChartAudioAsset(source, 'Song/main.bms', 'voice.wav')).toBe(M4A_BYTES);
    expect(resolveChartAudioAsset(source, 'Song/main.bms', 'voice')).toBe(M4A_BYTES);
  });
});

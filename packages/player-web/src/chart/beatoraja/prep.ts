// Slim chart-asset preparation pipeline for the beatoraja gameplay path.
//
// `PixiGameplayView.prepare()` does the same job for the LR2 path, but its prep is deeply tied to view
// state (private fields, deferred init across `prepareSong` / `prepareAudio` / `prepareBga`, mid-flight
// `disposed` checks). Extracting it would be a 600-line refactor that risks LR2 regressions. Instead this
// module reuses the same shared helpers (`@be-music/chart`, `@be-music/parser`, `@be-music/audio-renderer`,
// `@be-music/player/core/bga-timeline`) to assemble a self-contained `EngineDriverAudioContext` + BGA
// bundle for `PixiBeatorajaGameplayView`.
//
// What it covers:
//   - `#RANDOM` / `#SETRANDOM` / `#SWITCH` resolution (`resolvePlayChart`), unless the caller resolved already.
//   - Web Audio bus + `AudioContext` construction (latency hint = 'interactive', master volume from
//     `#VOLWAV`).
//   - Per-`#WAVxx` slot decode → `decodedSamples`.
//   - `#WAVCMD` + `#EXWAV` volume multipliers → `wavCmdVolumeMultipliers`.
//   - bmson 1.0 sample slicing → `bmsonSlicePlayback`.
//   - BGA timeline (`base` / `layer` / `poor`) + per-`#BMPxx` texture decode.
//
// What it explicitly does NOT cover (the LR2 view handles these for itself; for beatoraja we use the
// engine to drive playback so we don't need them on the prep side):
//   - Note playback array preparation (the engine does this internally via `preparePlaybackChartData`).
//   - `#SCROLL` / `#SPEED` distance integrators (the engine handles per-beat physics).
//   - Random-mode lane shuffles (those are a play-mode option not yet surfaced for the beatoraja path).
//   - DP flip — applied at gameplay-view construction (`flipDpChart` in `scene/beatoraja/gameplay`)
//     rather than here, since the flip toggle comes from `BeatorajaPlayerOptions` which the prep
//     pipeline doesn't see. Both produce the same end-state chart.
//
// Caller lifecycle:
//
//     const prep = await prepareBeatorajaGameplayChart({ song, source });
//     const view = new PixiBeatorajaGameplayView({
//       chart: prep.chart,
//       audio: prep.audio,
//       bgaCues: prep.bga.cues,
//       bgaTextures: prep.bga.textures,
//       …
//     });
//     // …play the chart…
//     prep.dispose();   // closes the AudioContext + destroys BGA textures

import { Texture } from 'pixi.js';
import { runWithConcurrency } from '@be-music/utils/core';
import {
  collectBmsExWavVolumeMultipliers,
  collectBmsWavCmdVolumeMultipliers,
  resolveChart,
  volWavToLinearGain,
} from '@be-music/chart';
import { resolveBmsBase, type BeMusicEvent, type BeMusicJson } from '@be-music/json';
import type { RandomDraws } from '@be-music/chart';
import { resolvePlayChart, type ResolvedPlayChart } from '@be-music/player/core/engine';
import { createBmsonSamplePlaybackMap } from '@be-music/audio-renderer/triggers';
import {
  buildAudioBus,
  type AudioBusHandle,
  type BuildAudioBusOptions,
  type CompressorMode,
} from '../../runtime/audio-bus.ts';
import type { EngineDriverAudioContext } from '../../runtime/engine-driver.ts';
import { loadAssetBytes, resolveChartAudioAsset, resolveChartBgaAsset } from '../../collection/collection.ts';
import { loadVideoTextureFromBytes, type VideoTranscodeOptions } from '../../media/textures.ts';
import { logger } from '../../logger.ts';
import type { BgaCue } from '../../scene/core/gameplay-bga.ts';
import { isVideoExtension, toBrowserBgaTimeline } from '../../scene/core/gameplay-bga.ts';
import type { BrowserSongAssetSource, BrowserSongEntry } from '../../collection/types.ts';
import type { WebAudioSessionSlicePlayback } from '../../runtime/web-audio-session.ts';
import {
  clampPlayTempo,
  resolveSamplePlaybackRate,
  resolveSampleStretchRates,
  stretchDecodedSamples,
  stretchSlicePlayback,
  type TempoPitchMode,
  type TimeStretchAlgorithm,
} from '../../runtime/play-tempo.ts';

const log = logger('beatoraja-prep');

const AUDIO_DECODE_CONCURRENCY = 8;
const BGA_DECODE_CONCURRENCY = 4;

export interface PrepareBeatorajaGameplayChartOptions {
  song: BrowserSongEntry;
  source: BrowserSongAssetSource;
  /**
   * Compressor routing mode for the audio bus. Defaults to `'split'` (per-bus compression on key + bgm,
   * with a master compressor fronting both). Pass `'off'` to bypass every compressor stage.
   */
  audioCompressorMode?: CompressorMode;
  /** Initial audio-bus state (stage toggles, keysound / BGM volumes, compressor tuning) from the host's UI. */
  audioBusOptions?: BuildAudioBusOptions;
  /**
   * The chart an upstream scene already resolved for this play (`resolvePlayChart(song.chart)` from
   * `@be-music/player`), e.g. the decide screen's bpmgraph. When set, the prep uses its chart and draws verbatim, so
   * decide and gameplay show and play the same `#RANDOM` branches. Without it the prep resolves the chart itself.
   */
  preResolved?: ResolvedPlayChart;
  /** How a video BGA the browser can't play is transcoded (size cap, WebCodecs encode), as the LR2 path takes it. */
  bgaTranscode?: VideoTranscodeOptions;
  /**
   * The play tempo (`clampPlayTempo`; default 1). The prep readies the audio and the video BGA for it: samples play
   * `tempo` times as fast (or are stretched to it, see {@link tempoPitchMode}) and videos run at it. The host passes the
   * same value as the view's `engineOptions.speed`.
   */
  tempo?: number;
  /** How a tempo change sounds: `pitch` (default) moves the pitch, `keep-pitch` stretches the samples and keeps it. */
  tempoPitchMode?: TempoPitchMode;
  /** The time stretcher keep pitch uses: `signalsmith` (default) or `wsola`. */
  tempoStretchAlgorithm?: TimeStretchAlgorithm;
}

export interface PreparedBeatorajaGameplayChart {
  /** Resolved chart (after `#IF` / `#RANDOM` control flow). */
  chart: BeMusicJson;
  /**
   * The `#RANDOM` / `#SWITCH` draws `chart` was resolved with. Hand them to the gameplay view's
   * `engineOptions.randomDraws` so the engine's RANDOM summary (and later the play log) names this resolution.
   */
  randomDraws: RandomDraws;
  /** Owning `AudioContext`. Closed by {@link dispose}. */
  audioContext: AudioContext;
  /** Audio bus pre-wired to the AudioContext destination. */
  audioBus: AudioBusHandle;
  /** Engine driver inputs ready to hand to `runEngineDriver` / `PixiBeatorajaGameplayView`. */
  audio: EngineDriverAudioContext;
  /** BGA timeline + decoded textures. Both can be empty when the chart has no BGA. */
  bga: {
    textures: Map<string, Texture>;
    cues: { base: BgaCue[]; layer: BgaCue[]; poor: BgaCue[] };
    /**
     * `<video>` elements for keys whose `#BMPxx` resolved to a video file (mpg / mp4 /
     * webm etc). The BGA layer pauses / plays / seeks these on cue boundaries — same key
     * space as `textures`, sparse population (only video keys present). Empty when the
     * chart has no video BGAs.
     */
    videoElements: Map<string, HTMLVideoElement>;
  };
  /** Closes the AudioContext and destroys BGA textures. Idempotent. */
  dispose: () => Promise<void>;
}

/**
 * One-shot async pipeline that assembles every per-chart resource the beatoraja gameplay path needs.
 * Designed so the caller awaits a single promise and receives a ready-to-mount bundle.
 */
export async function prepareBeatorajaGameplayChart(
  options: PrepareBeatorajaGameplayChartOptions,
): Promise<PreparedBeatorajaGameplayChart> {
  const { song, source } = options;

  // 1. Resolve `#IF` / `#RANDOM` control flow once so every later step (and the engine) sees the same branches. A
  // caller that already resolved the chart for an upstream scene hands that resolution in, so it is not drawn twice.
  const { chart, randomDraws } = options.preResolved ?? resolvePlayChart(song.chart);

  // 2. Audio context + bus.
  const audioContext = new AudioContext({ latencyHint: 'interactive' });
  // Pre-warm the context — most browsers ship it in `suspended` state until the first user gesture and
  // the first `node.start()` would otherwise pay a one-time ramp-up tax.
  void audioContext.resume().catch(() => undefined);
  const audioBus = buildAudioBus(audioContext, options.audioCompressorMode ?? 'split', options.audioBusOptions);
  // `#VOLWAV` master volume scaling; charts that omit the directive, or set it outside beatoraja's 0 < n < 200 range,
  // stay at unity.
  audioBus.setMasterGain(volWavToLinearGain(chart.bms.volWav));

  // 3. Decode every `#WAVxx` slot in parallel. Audio entries are stored as lazy `File` references in the
  // dropped-source map — `loadAssetBytes` does the on-demand `arrayBuffer()` unwrap.
  const decodedSamples = new Map<string, AudioBuffer>();
  const wavPaths = Object.values(chart.resources.wav).filter((path): path is string => typeof path === 'string');
  const pathWavPrefix = typeof chart.bms.pathWav === 'string' ? chart.bms.pathWav : undefined;
  await runWithConcurrency(wavPaths, AUDIO_DECODE_CONCURRENCY, async (path) => {
    const entry = resolveChartAudioAsset(source, song.chartPath, path, { pathPrefix: pathWavPrefix });
    const bytes = await loadAssetBytes(entry);
    if (!bytes) return;
    try {
      const decoded = await audioContext.decodeAudioData(bytes.slice().buffer);
      decodedSamples.set(normalizePath(path), decoded);
    } catch (error) {
      // Browsers vary in codec support; unsupported samples are silently skipped (matches LR2 behavior).
      log.debug('decode skipped', { path, error });
    }
  });

  // Keep pitch: the samples are stretched to the play tempo once, here, and then play at their own pitch.
  const tempo = clampPlayTempo(options.tempo);
  const pitchMode = options.tempoPitchMode ?? 'pitch';
  if (pitchMode === 'keep-pitch' && tempo !== 1) {
    await stretchDecodedSamples(
      audioContext,
      decodedSamples,
      resolveSampleStretchRates(chart.resources.wav, normalizePath, tempo),
      options.tempoStretchAlgorithm ?? 'signalsmith',
    );
  }

  // 4. WAVCMD + EXWAV volume multipliers. Both fold into the same map; same-slot entries multiply.
  const wavCmdVolumeMultipliers = collectBmsWavCmdVolumeMultipliers(chart.bms.wavCmds, resolveBmsBase(chart));
  for (const [slot, multiplier] of collectBmsExWavVolumeMultipliers(chart.bms.exWav)) {
    const previous = wavCmdVolumeMultipliers.get(slot) ?? 1;
    wavCmdVolumeMultipliers.set(slot, previous * multiplier);
  }

  // 5. bmson 1.0 sample-slice playback map (skipped for BMS / json charts that don't slice).
  const resolved = resolveChart(chart, { randomDraws, chartPath: song.chartPath, inferBmsLnTypeWhenMissing: true });
  const timingResolver = resolved.timing;
  const beatResolver = resolved.beatResolver;
  const bmsonSlices: ReadonlyMap<BeMusicEvent, WebAudioSessionSlicePlayback> | undefined =
    chart.sourceFormat === 'bmson'
      ? createBmsonSamplePlaybackMap(chart, timingResolver, chart.events.slice(), beatResolver)
      : undefined;
  // Slices index into the samples, which keep pitch stretched.
  const bmsonSlicePlayback =
    bmsonSlices !== undefined && pitchMode === 'keep-pitch' ? stretchSlicePlayback(bmsonSlices, tempo) : bmsonSlices;

  // 6. BGA timeline.
  const cues = toBrowserBgaTimeline(resolved.bga);

  // 7. BGA bitmap decode. Skips video extensions (we'd need WebCodecs / MSE plumbing to play them and
  // the LR2 path's video pipeline isn't shared here yet).
  const referencedKeys = new Set<string>();
  for (const list of [cues.base, cues.layer, cues.poor]) {
    for (const cue of list) {
      if (cue.bmpKey !== undefined) referencedKeys.add(cue.bmpKey);
    }
  }
  const bgaTextures = new Map<string, Texture>();
  // Video-element map for keys whose `#BMPxx` resolves to a video file (mpg / mp4 / webm
  // etc). The BGA layer pauses / plays / seeks these elements when their texture becomes
  // active, mirroring beatoraja's video-BGA behavior. Empty when the chart only ships
  // still-image BGAs.
  const bgaVideoElements = new Map<string, HTMLVideoElement>();
  // Object URLs created by the video loader — must be revoked at dispose to free the
  // underlying memory (Blob references hang around forever otherwise). Stored in parallel
  // with `bgaVideoElements` for symmetric cleanup.
  const bgaVideoObjectUrls: string[] = [];
  await runWithConcurrency([...referencedKeys], BGA_DECODE_CONCURRENCY, async (key) => {
    const path = chart.resources.bmp[key];
    if (typeof path !== 'string') return;
    // The image / video resolver, as the LR2 path uses: it tries the other image extensions for a still, and the other
    // video extensions for a video (`_bga.mpg` re-encoded to `_bga.mp4`), but never an image for a video.
    const resolved = resolveChartBgaAsset(source, song.chartPath, path);
    const bytes = await loadAssetBytes(resolved?.entry);
    if (!bytes) return;
    // Video paths route through the LR2-derived video loader. Browsers that can't
    // natively decode the source codec fall through to the libav / ffmpeg.wasm
    // transcode path inside `loadVideoTextureFromBytes`.
    if (isVideoExtension(path)) {
      try {
        const handle = await loadVideoTextureFromBytes(resolved?.path ?? path, bytes, options.bgaTranscode);
        if (handle === undefined) return;
        handle.texture.label = `bga[${key}]:video`;
        handle.video.muted = true;
        handle.video.loop = false;
        handle.video.playsInline = true;
        // Start paused — the BGA layer triggers `.play()` when this key becomes the
        // active cue. Seeking to 0 first guarantees frame-0 is already decoded so the
        // first paint isn't black.
        handle.video.pause();
        // The video runs at the play tempo, so its time stays the chart time since its cue.
        handle.video.defaultPlaybackRate = tempo;
        handle.video.playbackRate = tempo;
        bgaTextures.set(key, handle.texture);
        bgaVideoElements.set(key, handle.video);
        bgaVideoObjectUrls.push(handle.objectUrl);
      } catch (error) {
        log.debug('bga video decode skipped', { key, path, error });
      }
      return;
    }
    try {
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
      const bitmap = await createImageBitmap(blob);
      const texture = Texture.from(bitmap);
      texture.label = `bga[${key}]`;
      bgaTextures.set(key, texture);
    } catch (error) {
      log.debug('bga decode skipped', { key, path, error });
    }
  });

  // 8. Package up.
  const audio: EngineDriverAudioContext = {
    audioContext,
    audioBus,
    decodedSamples,
    wavCmdVolumeMultipliers,
    bmsonSlicePlayback,
    playbackRate: resolveSamplePlaybackRate(pitchMode, tempo),
  };

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    // Pause + clear src on every video element BEFORE destroying textures — destroying the
    // VideoSource while the element is still playing leaves orphan frame requests on the
    // browser's compositor thread.
    for (const video of bgaVideoElements.values()) {
      try {
        video.pause();
        video.src = '';
        video.load();
      } catch {
        // Already-detached / disposed.
      }
    }
    bgaVideoElements.clear();
    for (const url of bgaVideoObjectUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Already revoked.
      }
    }
    bgaVideoObjectUrls.length = 0;
    for (const texture of bgaTextures.values()) {
      try {
        // BGA textures are exclusive to this chart; the gameplay view's BGA layer doesn't outlive
        // `dispose()`, so destroying the underlying `TextureSource` is safe.
        texture.destroy(true);
      } catch {
        // Already-destroyed textures are fine — Pixi v8 idempotently no-ops the second destroy.
      }
    }
    bgaTextures.clear();
    decodedSamples.clear();
    try {
      await audioContext.close();
    } catch (error) {
      log.warn('audio context close failed', error);
    }
  };

  return {
    chart,
    randomDraws,
    audioContext,
    audioBus,
    audio,
    bga: { textures: bgaTextures, cues, videoElements: bgaVideoElements },
    dispose,
  };
}

/**
 * Lower-cased + slash-normalized path key matching the LR2 path's convention. Keeps audio lookups
 * consistent across drag-and-drop archives whose entries vary in case.
 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

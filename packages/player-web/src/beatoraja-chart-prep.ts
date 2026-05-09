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
//   - `#RANDOM` / `#SETRANDOM` / `#SWITCH` resolution.
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
//   - DP flip — applied at gameplay-view construction (`flipDpChart` in `pixi-beatoraja-gameplay`)
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
import {
  collectBmsExWavVolumeMultipliers,
  collectBmsWavCmdVolumeMultipliers,
  createBeatResolver,
} from '@be-music/chart';
import { resolveBmsBase, type BeMusicEvent, type BeMusicJson } from '@be-music/json';
import { resolveBmsControlFlow } from '@be-music/parser';
import { createBmsonSamplePlaybackMap, createTimingResolver } from '@be-music/audio-renderer/triggers';
import { buildBgaTimelines, type BgaTimelines } from '@be-music/player/core/bga-timeline';
import { buildAudioBus, type AudioBusHandle, type CompressorMode } from './audio-bus.ts';
import type { EngineDriverAudioContext } from './engine-driver.ts';
import { loadAssetBytes, resolveChartAudioAsset } from './library.ts';
import { loadVideoTextureFromBytes } from './lr2-textures.ts';
import { logger } from './logger.ts';
import type { BgaCue } from './pixi-gameplay-bga.ts';
import { isVideoExtension } from './pixi-gameplay-bga.ts';
import type { BrowserSongAssetSource, BrowserSongEntry } from './types.ts';
import type { WebAudioSessionSlicePlayback } from './web-audio-session.ts';

const log = logger('beatoraja-prep');

export interface PrepareBeatorajaGameplayChartOptions {
  song: BrowserSongEntry;
  source: BrowserSongAssetSource;
  /**
   * Compressor routing mode for the audio bus. Defaults to `'split'` (per-bus compression on key + bgm,
   * with a master compressor fronting both). Pass `'off'` to bypass every compressor stage.
   */
  audioCompressorMode?: CompressorMode;
  /**
   * Pre-resolved chart from a prior `resolveBmsControlFlow(song.chart)` call. When set, the prep
   * skips the resolve step and uses this chart verbatim. Required when the host already resolved
   * the chart for an upstream scene (e.g. the decide screen's bpmgraph), since
   * `resolveBmsControlFlow` re-evaluates `#RANDOM` on every call — running it twice would pick
   * different branches and produce a different chart between decide and gameplay.
   */
  preResolvedChart?: BeMusicJson;
}

export interface PreparedBeatorajaGameplayChart {
  /** Resolved chart (after `#IF` / `#RANDOM` control flow). */
  chart: BeMusicJson;
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

  // 1. Resolve `#IF` / `#RANDOM` control flow so every later step sees the same chosen branches.
  // When the caller supplies `preResolvedChart`, skip the resolve — `resolveBmsControlFlow` rolls
  // `#RANDOM` fresh each call, and rolling twice (decide-side + gameplay-side) would pick
  // different branches per scene. The decide flow resolves once and threads the result through.
  const chart = options.preResolvedChart ?? resolveBmsControlFlow(song.chart, { random: Math.random });

  // 2. Audio context + bus.
  const audioContext = new AudioContext({ latencyHint: 'interactive' });
  // Pre-warm the context — most browsers ship it in `suspended` state until the first user gesture and
  // the first `node.start()` would otherwise pay a one-time ramp-up tax.
  void audioContext.resume().catch(() => undefined);
  const audioBus = buildAudioBus(audioContext, options.audioCompressorMode ?? 'split');
  // `#VOLWAV` master volume scaling; charts that omit the directive stay at unity.
  const volWav = chart.bms.volWav;
  if (typeof volWav === 'number' && Number.isFinite(volWav) && volWav >= 0) {
    audioBus.setMasterGain(volWav / 100);
  }

  // 3. Decode every `#WAVxx` slot in parallel. Audio entries are stored as lazy `File` references in the
  // dropped-source map — `loadAssetBytes` does the on-demand `arrayBuffer()` unwrap.
  const decodedSamples = new Map<string, AudioBuffer>();
  const wavPaths = Object.values(chart.resources.wav).filter((path): path is string => typeof path === 'string');
  const pathWavPrefix = typeof chart.bms.pathWav === 'string' ? chart.bms.pathWav : undefined;
  await Promise.all(
    wavPaths.map(async (path) => {
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
    }),
  );

  // 4. WAVCMD + EXWAV volume multipliers. Both fold into the same map; same-slot entries multiply.
  const wavCmdVolumeMultipliers = collectBmsWavCmdVolumeMultipliers(chart.bms.wavCmds, resolveBmsBase(chart));
  for (const [slot, multiplier] of collectBmsExWavVolumeMultipliers(chart.bms.exWav)) {
    const previous = wavCmdVolumeMultipliers.get(slot) ?? 1;
    wavCmdVolumeMultipliers.set(slot, previous * multiplier);
  }

  // 5. bmson 1.0 sample-slice playback map (skipped for BMS / json charts that don't slice).
  const timingResolver = createTimingResolver(chart);
  const beatResolver = createBeatResolver(chart);
  const bmsonSlicePlayback: ReadonlyMap<BeMusicEvent, WebAudioSessionSlicePlayback> | undefined =
    chart.sourceFormat === 'bmson'
      ? createBmsonSamplePlaybackMap(chart, timingResolver, chart.events.slice(), beatResolver)
      : undefined;

  // 6. BGA timeline.
  const bgaTimelines: BgaTimelines = buildBgaTimelines(chart, timingResolver);
  const cues = {
    base: bgaTimelines.base.map(toBrowserCue),
    layer: [...bgaTimelines.layer, ...bgaTimelines.layer2]
      .sort((left, right) => left.seconds - right.seconds)
      .map(toBrowserCue),
    poor: bgaTimelines.poor.map(toBrowserCue),
  };

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
  await Promise.all(
    [...referencedKeys].map(async (key) => {
      const path = chart.resources.bmp[key];
      if (typeof path !== 'string') return;
      const entry = resolveChartAudioAsset(source, song.chartPath, path, { pathPrefix: undefined });
      const bytes = await loadAssetBytes(entry);
      if (!bytes) return;
      // Video paths route through the LR2-derived video loader. Browsers that can't
      // natively decode the source codec fall through to the libav / ffmpeg.wasm
      // transcode path inside `loadVideoTextureFromBytes`.
      if (isVideoExtension(path)) {
        try {
          const handle = await loadVideoTextureFromBytes(path, bytes);
          if (handle === undefined) return;
          handle.texture.label = `bga[${key}]:video`;
          handle.video.muted = true;
          handle.video.loop = false;
          handle.video.playsInline = true;
          // Start paused — the BGA layer triggers `.play()` when this key becomes the
          // active cue. Seeking to 0 first guarantees frame-0 is already decoded so the
          // first paint isn't black.
          handle.video.pause();
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
    }),
  );

  // 8. Package up.
  const audio: EngineDriverAudioContext = {
    audioContext,
    audioBus,
    decodedSamples,
    wavCmdVolumeMultipliers,
    bmsonSlicePlayback,
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
    audioContext,
    audioBus,
    audio,
    bga: { textures: bgaTextures, cues, videoElements: bgaVideoElements },
    dispose,
  };
}

function toBrowserCue(cue: { seconds: number; key?: string }): BgaCue {
  return { seconds: cue.seconds, bmpKey: cue.key };
}

/**
 * Lower-cased + slash-normalized path key matching the LR2 path's convention. Keeps audio lookups
 * consistent across drag-and-drop archives whose entries vary in case.
 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

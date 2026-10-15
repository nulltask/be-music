// Chart-asset preparation for the beatoraja gameplay path: one awaited bundle (`EngineDriverAudioContext` + BGA) for
// `PixiBeatorajaGameplayView`.
//
// The audio and BGA preparation itself is shared with the LR2 / built-in view (`PixiGameplayView.prepare()`), so the two
// families decode, stretch and key their assets the same way:
//   - `chart/play-audio.ts` — AudioContext + bus (`#VOLWAV`), `#WAVxx` decode (keep-pitch stretch), `#WAVCMD` / `#EXWAV`.
//   - `chart/play-bga.ts` — `#BMPxx` / bmson BGA images and videos, layer chroma key, `#BGAxx` sub-regions.
//
// This module adds what only the beatoraja path needs:
//   - `#RANDOM` / `#SETRANDOM` / `#SWITCH` resolution (`resolvePlayChart`), unless the caller resolved already.
//   - bmson 1.0 sample slicing → `bmsonSlicePlayback`.
//   - The BGA cue timeline (`base` / `layer` / `poor`).
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

import type { Texture } from 'pixi.js';
import { resolveChart } from '@be-music/chart';
import type { BeMusicEvent, BeMusicJson } from '@be-music/json';
import type { RandomDraws } from '@be-music/chart';
import { resolvePlayChart, type ResolvedPlayChart } from '@be-music/player/core/engine';
import { createBmsonSamplePlaybackMap } from '@be-music/audio-renderer/triggers';
import type { AudioBusHandle, BuildAudioBusOptions, CompressorMode } from '../../runtime/audio-bus.ts';
import type { EngineDriverAudioContext } from '../../runtime/engine-driver.ts';
import type { VideoTranscodeOptions } from '../../media/textures.ts';
import { loadPlayBga, releaseVideo, type PlayBgaResources } from '../play-bga.ts';
import { destroyUniqueTextures } from '../../scene/pixi-utils.ts';
import { logger } from '../../logger.ts';
import type { BgaCue } from '../../scene/core/gameplay-bga.ts';
import { toBrowserBgaTimeline } from '../../scene/core/gameplay-bga.ts';
import type { BrowserSongAssetSource, BrowserSongEntry } from '../../collection/types.ts';
import type { WebAudioSessionSlicePlayback } from '../../runtime/web-audio-session.ts';
import { collectChartVolumeMultipliers, createPlayAudioGraph, loadPlaySamples } from '../play-audio.ts';
import {
  clampPlayTempo,
  resolveSamplePlaybackRate,
  stretchSlicePlayback,
  type TempoPitchMode,
  type TimeStretchAlgorithm,
} from '../../runtime/play-tempo.ts';

const log = logger('beatoraja-prep');

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

  // 2. Audio context + bus (with `#VOLWAV`), and 3. every `#WAVxx` sample decoded (stretched for keep pitch) — the same
  // preparation the LR2 / built-in view runs (`chart/play-audio.ts`).
  const { audioContext, audioBus } = createPlayAudioGraph(
    chart,
    options.audioCompressorMode ?? 'split',
    options.audioBusOptions,
  );
  const tempo = clampPlayTempo(options.tempo);
  const pitchMode = options.tempoPitchMode ?? 'pitch';
  const decodedSamples = new Map<string, AudioBuffer>();
  await loadPlaySamples({
    audioContext,
    chart,
    source,
    chartPath: song.chartPath,
    samples: decodedSamples,
    tempo,
    tempoPitchMode: pitchMode,
    tempoStretchAlgorithm: options.tempoStretchAlgorithm ?? 'signalsmith',
  });

  // 4. WAVCMD + EXWAV volume multipliers. Both fold into the same map; same-slot entries multiply.
  const wavCmdVolumeMultipliers = collectChartVolumeMultipliers(chart);

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

  // 7. BGA resources, loaded as the LR2 / built-in view loads them (`chart/play-bga.ts`): stills through the shared
  // texture loader (TGA / DDS included), bmson `bga.header[]` images, `#BGAxx` sub-regions, and videos (with the
  // transcode fallback) paused at the play tempo. The beatoraja BGA layer draws one sprite per frame, so a key drawn only
  // on the layer track uses its layer texture.
  const bga: PlayBgaResources = {
    textures: new Map(),
    layerTextures: new Map(),
    videos: new Map(),
    subRegionOrigins: new Map(),
  };
  await loadPlayBga({
    chart,
    source,
    chartPath: song.chartPath,
    timeline: cues,
    into: bga,
    ...(options.bgaTranscode !== undefined ? { transcode: options.bgaTranscode } : {}),
    tempo,
  });
  const bgaTextures = new Map<string, Texture>([...bga.layerTextures, ...bga.textures]);
  const bgaVideoElements = new Map<string, HTMLVideoElement>(
    [...bga.videos].map(([key, { video }]) => [key, video] as const),
  );

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
    // Stop every video before destroying textures: a playing `VideoSource` leaves frame requests on the compositor.
    for (const video of bga.videos.values()) releaseVideo(video);
    bga.videos.clear();
    bgaVideoElements.clear();
    // BGA textures are exclusive to this chart; sub-region views share their source's, so each is destroyed once.
    destroyUniqueTextures([...bga.textures.values(), ...bga.layerTextures.values()]);
    bga.textures.clear();
    bga.layerTextures.clear();
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

/**
 * Media preparation for a play on the built-in and LR2 gameplay scenes (`CoreGameplayView`): the play's AudioContext,
 * audio bus and analyser, the decoded (and, for keep pitch, stretched) samples, the NONSTOP stage mixer and the
 * `WebAudioSession` the engine plays through; the BGA textures and videos; and the audio graph's teardown, which a
 * play that ended naturally delays so its last samples ring out.
 *
 * The functions read and write the play's state through {@link PlayMediaContext}; the scene passes itself.
 */

import type { BeMusicEvent, BeMusicJson } from '@be-music/json';
import type { Texture } from 'pixi.js';
import { createPlayAudioGraph, loadPlaySamples } from '../../chart/play-audio.ts';
import { loadPlayBga } from '../../chart/play-bga.ts';
import type { BrowserSongAssetSource, BrowserSongEntry } from '../../collection/types.ts';
import { AudioAnalyzer } from '../../runtime/audio-analysis.ts';
import type {
  AudioBusChannel,
  AudioBusHandle,
  CompressorMode,
  CompressorParams,
  TunableCompressor,
} from '../../runtime/audio-bus.ts';
import { createNonstopStageMixer, type NonstopStageMixer } from '../../runtime/nonstop-audio.ts';
import { resolveSamplePlaybackRate, stretchSlicePlayback } from '../../runtime/play-tempo.ts';
import { createWebAudioSession, type WebAudioSession } from '../../runtime/web-audio-session.ts';
import type { BgaCue } from '../../scene/core/gameplay-bga.ts';
import type { CoreGameplayViewOptions } from '../../scene/core/gameplay-options.ts';

/** The play state the media preparation reads and fills: `CoreGameplayView`'s fields of these names. */
export interface PlayMediaContext {
  readonly options: Readonly<
    Pick<
      CoreGameplayViewOptions,
      | 'audioCompressor'
      | 'audioCompressorMode'
      | 'audioCompressorStages'
      | 'tempoPitchMode'
      | 'tempoStretchAlgorithm'
      | 'nonstop'
      | 'bgaTranscodeMaxLongEdgePx'
      | 'bgaTranscodeUseWebCodecs'
    >
  >;
  readonly song: BrowserSongEntry | undefined;
  readonly source: BrowserSongAssetSource | undefined;
  readonly resolvedChart: BeMusicJson | undefined;
  readonly disposed: boolean;
  readonly tempo: number;
  audioContext: AudioContext | undefined;
  audioBus: AudioBusHandle | undefined;
  audioAnalyzer: AudioAnalyzer | undefined;
  audioCompressorMode: CompressorMode;
  readonly audioCompressorParams: Partial<Record<TunableCompressor, Partial<CompressorParams>>>;
  readonly audioVolumes: Record<AudioBusChannel, number>;
  webAudioSession: WebAudioSession | undefined;
  nonstopMixer: NonstopStageMixer | undefined;
  readonly decodedSamples: Map<string, AudioBuffer>;
  readonly wavCmdVolumeMultipliers: Map<string, number>;
  bmsonSlicePlayback:
    | Map<BeMusicEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }>
    | undefined;
  readonly hasBga: boolean;
  readonly bgaTimeline: { base: BgaCue[]; layer: BgaCue[]; poor: BgaCue[] };
  readonly poorBgaFallbackKey: string | undefined;
  readonly bgaTextures: Map<string, Texture>;
  readonly bgaLayerTextures: Map<string, Texture>;
  readonly bgaVideos: Map<string, { video: HTMLVideoElement; objectUrl: string }>;
  readonly bgaSubRegionOrigins: Map<string, { x: number; y: number }>;
  /** Uploads `textures` to the GPU now (Pixi's `PrepareSystem`), so the first frame that draws them does not stall. */
  preparePixiUpload(textures: Iterable<Texture | undefined>): Promise<void>;
}

export async function prepareAudio(ctx: PlayMediaContext): Promise<void> {
  if (!ctx.source || !ctx.song) {
    return;
  }
  // Build the audio bus. See `audio-bus.ts` for the full architecture; in short:
  //
  // key sources → keyMixer → keyComp ↘ masterComp → makeup → destination ('split') BGM sources → bgmMixer → bgmComp ↗
  //
  // 'legacy' collapses both buses onto a single compressor; 'off' bypasses every compressor stage. Sample sources
  // always feed `keyMixer` / `bgmMixer`, never directly to the destination, so a mode switch never has to reconnect
  // in-flight `BufferSourceNode`s — important because hundreds of one-shots come and go per second on dense charts.
  ctx.audioCompressorMode = ctx.options.audioCompressorMode ?? 'split';
  const initialMode: CompressorMode = ctx.options.audioCompressor === false ? 'off' : ctx.audioCompressorMode;
  // Use the control-flow-resolved chart so #IF-gated #WAVxx declarations match the chosen #RANDOM branch.
  const chart = ctx.resolvedChart ?? ctx.song.chart;
  // The AudioContext, the bus and `#VOLWAV` are built, and the samples decoded, as the beatoraja prep does
  // (`chart/play-audio.ts`).
  const graph = createPlayAudioGraph(chart, initialMode, {
    initialStages: ctx.options.audioCompressorStages,
    initialVolumes: ctx.audioVolumes,
    initialCompressorParams: ctx.audioCompressorParams,
  });
  ctx.audioContext = graph.audioContext;
  ctx.audioBus = graph.audioBus;
  // Audio-reactive skins read the post-mix signal from the bus's analysis tap.
  ctx.audioAnalyzer = new AudioAnalyzer(ctx.audioContext);
  ctx.audioBus.outputNode.connect(ctx.audioAnalyzer.input);
  const pitchMode = ctx.options.tempoPitchMode ?? 'pitch';
  // Keep pitch: the samples are stretched to the play tempo (times a NONSTOP FIT stage's rate) once, here, and then
  // play at their own pitch.
  const stretched = await loadPlaySamples({
    audioContext: ctx.audioContext,
    chart,
    source: ctx.source,
    chartPath: ctx.song.chartPath,
    samples: ctx.decodedSamples,
    tempo: ctx.tempo,
    tempoPitchMode: pitchMode,
    tempoStretchAlgorithm: ctx.options.tempoStretchAlgorithm ?? 'signalsmith',
    ...(ctx.options.nonstop !== undefined ? { nonstop: ctx.options.nonstop } : {}),
    isCancelled: () => ctx.disposed,
  });
  // bmson slices index into the stretched samples (a bmson chart has no NONSTOP stages: one rate).
  if (stretched && ctx.bmsonSlicePlayback !== undefined) {
    ctx.bmsonSlicePlayback = stretchSlicePlayback(ctx.bmsonSlicePlayback, ctx.tempo);
  }
  // Build the WebAudioSession now that the sample cache is populated. The session captures the maps by reference
  // (the underlying entries can still grow if asset loading races onto a later tick), and owns every sample
  // playback path from this point on — `playSample` / `playSampleByKey` / `scheduleAutoSamples` all delegate to
  // it. See the field doc for why this beats keeping the audio plumbing inline on the view.
  if (!ctx.disposed && ctx.audioContext && ctx.audioBus) {
    ctx.nonstopMixer?.dispose();
    ctx.nonstopMixer =
      ctx.options.nonstop !== undefined
        ? createNonstopStageMixer(ctx.audioContext, ctx.audioBus.bgmMixer, ctx.options.nonstop, {
            keepPitch: pitchMode === 'keep-pitch',
            tempo: ctx.tempo,
          })
        : undefined;
    ctx.webAudioSession = createWebAudioSession({
      audioContext: ctx.audioContext,
      audioBus: ctx.audioBus,
      chart: ctx.resolvedChart ?? ctx.song!.chart,
      decodedSamples: ctx.decodedSamples,
      wavCmdVolumeMultipliers: ctx.wavCmdVolumeMultipliers,
      bmsonSlicePlayback: ctx.bmsonSlicePlayback,
      ...(ctx.nonstopMixer !== undefined ? { stageMixer: ctx.nonstopMixer } : {}),
      playbackRate: samplePlaybackRate(ctx),
    });
  }
}

/** Every sample's playback rate: the play tempo when it moves the pitch, 1 when the samples were stretched to it. */
export function samplePlaybackRate(ctx: PlayMediaContext): number {
  return resolveSamplePlaybackRate(ctx.options.tempoPitchMode ?? 'pitch', ctx.tempo);
}

/**
 * Decodes every BMP resource referenced by the chart's BGA timelines into a Pixi `Texture`, keyed by the same string
 * the timeline cues reference. Loads run with bounded parallelism so a long preamble doesn't gate the playfield
 * without fanning browser decoders out without limit.
 */
export async function prepareBga(ctx: PlayMediaContext): Promise<void> {
  const song = ctx.song;
  const source = ctx.source;
  if (!song || !source || !ctx.hasBga) {
    return;
  }
  // Use the control-flow-resolved chart so #IF-gated BMP / bga header declarations match the chosen #RANDOM branch.
  const chart = ctx.resolvedChart ?? song.chart;
  // Loaded as the beatoraja prep loads them (`chart/play-bga.ts`): base + POOR textures keep their blacks, the layer
  // track's are keyed out for BMS, videos get one texture for both tracks, and `#BGAxx` sub-regions become views.
  await loadPlayBga({
    chart,
    source,
    chartPath: song.chartPath,
    timeline: ctx.bgaTimeline,
    poorFallbackKey: ctx.poorBgaFallbackKey,
    into: {
      textures: ctx.bgaTextures,
      layerTextures: ctx.bgaLayerTextures,
      videos: ctx.bgaVideos,
      subRegionOrigins: ctx.bgaSubRegionOrigins,
    },
    transcode: {
      maxLongEdgePx: ctx.options.bgaTranscodeMaxLongEdgePx,
      useWebCodecs: ctx.options.bgaTranscodeUseWebCodecs,
    },
    tempo: ctx.tempo,
    isCancelled: () => ctx.disposed,
  });
  if (ctx.disposed) return;
  // Eager-upload every freshly loaded BGA texture (and any sub-region aliases registered above) so the first BGA
  // cue mid-chart doesn't stall on its own first sample. Mirrors the skin path in `prepare()`. This is fire-and-
  // forget from the prepareBga callsite — `bgaReadyPromise` already gates chart start, and adding the upload to
  // its tail just lengthens that promise by the upload work, which is what we want.
  await ctx.preparePixiUpload(ctx.bgaTextures.values());
  if (ctx.disposed) return;
  await ctx.preparePixiUpload(ctx.bgaLayerTextures.values());
}

export function disposeGameplayAudioGraphAfterDelay(
  graph: {
    session: WebAudioSession | undefined;
    bus: AudioBusHandle | undefined;
    context: AudioContext | undefined;
  },
  delayMs: number,
): void {
  const cleanup = (): void => {
    void graph.session?.dispose();
    graph.bus?.dispose();
    void graph.context?.close();
  };
  if (delayMs <= 0) {
    cleanup();
    return;
  }
  window.setTimeout(cleanup, delayMs);
}

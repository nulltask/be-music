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
import type { CoreGameplayViewOptions } from '../../scene/core/gameplay.ts';

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

export async function prepareAudio(this: PlayMediaContext): Promise<void> {
  if (!this.source || !this.song) {
    return;
  }
  // Build the audio bus. See `audio-bus.ts` for the full architecture; in short:
  //
  // key sources → keyMixer → keyComp ↘ masterComp → makeup → destination ('split') BGM sources → bgmMixer → bgmComp ↗
  //
  // 'legacy' collapses both buses onto a single compressor; 'off' bypasses every compressor stage. Sample sources
  // always feed `keyMixer` / `bgmMixer`, never directly to the destination, so a mode switch never has to reconnect
  // in-flight `BufferSourceNode`s — important because hundreds of one-shots come and go per second on dense charts.
  this.audioCompressorMode = this.options.audioCompressorMode ?? 'split';
  const initialMode: CompressorMode = this.options.audioCompressor === false ? 'off' : this.audioCompressorMode;
  // Use the control-flow-resolved chart so #IF-gated #WAVxx declarations match the chosen #RANDOM branch.
  const chart = this.resolvedChart ?? this.song.chart;
  // The AudioContext, the bus and `#VOLWAV` are built, and the samples decoded, as the beatoraja prep does
  // (`chart/play-audio.ts`).
  const graph = createPlayAudioGraph(chart, initialMode, {
    initialStages: this.options.audioCompressorStages,
    initialVolumes: this.audioVolumes,
    initialCompressorParams: this.audioCompressorParams,
  });
  this.audioContext = graph.audioContext;
  this.audioBus = graph.audioBus;
  // Audio-reactive skins read the post-mix signal from the bus's analysis tap.
  this.audioAnalyzer = new AudioAnalyzer(this.audioContext);
  this.audioBus.outputNode.connect(this.audioAnalyzer.input);
  const pitchMode = this.options.tempoPitchMode ?? 'pitch';
  // Keep pitch: the samples are stretched to the play tempo (times a NONSTOP FIT stage's rate) once, here, and then
  // play at their own pitch.
  const stretched = await loadPlaySamples({
    audioContext: this.audioContext,
    chart,
    source: this.source,
    chartPath: this.song.chartPath,
    samples: this.decodedSamples,
    tempo: this.tempo,
    tempoPitchMode: pitchMode,
    tempoStretchAlgorithm: this.options.tempoStretchAlgorithm ?? 'signalsmith',
    ...(this.options.nonstop !== undefined ? { nonstop: this.options.nonstop } : {}),
    isCancelled: () => this.disposed,
  });
  // bmson slices index into the stretched samples (a bmson chart has no NONSTOP stages: one rate).
  if (stretched && this.bmsonSlicePlayback !== undefined) {
    this.bmsonSlicePlayback = stretchSlicePlayback(this.bmsonSlicePlayback, this.tempo);
  }
  // Build the WebAudioSession now that the sample cache is populated. The session captures the maps by reference
  // (the underlying entries can still grow if asset loading races onto a later tick), and owns every sample
  // playback path from this point on — `playSample` / `playSampleByKey` / `scheduleAutoSamples` all delegate to
  // it. See the field doc for why this beats keeping the audio plumbing inline on the view.
  if (!this.disposed && this.audioContext && this.audioBus) {
    this.nonstopMixer?.dispose();
    this.nonstopMixer =
      this.options.nonstop !== undefined
        ? createNonstopStageMixer(this.audioContext, this.audioBus.bgmMixer, this.options.nonstop, {
            keepPitch: pitchMode === 'keep-pitch',
            tempo: this.tempo,
          })
        : undefined;
    this.webAudioSession = createWebAudioSession({
      audioContext: this.audioContext,
      audioBus: this.audioBus,
      chart: this.resolvedChart ?? this.song!.chart,
      decodedSamples: this.decodedSamples,
      wavCmdVolumeMultipliers: this.wavCmdVolumeMultipliers,
      bmsonSlicePlayback: this.bmsonSlicePlayback,
      ...(this.nonstopMixer !== undefined ? { stageMixer: this.nonstopMixer } : {}),
      playbackRate: samplePlaybackRate.call(this),
    });
  }
}

/** Every sample's playback rate: the play tempo when it moves the pitch, 1 when the samples were stretched to it. */
export function samplePlaybackRate(this: PlayMediaContext): number {
  return resolveSamplePlaybackRate(this.options.tempoPitchMode ?? 'pitch', this.tempo);
}

/**
 * Decodes every BMP resource referenced by the chart's BGA timelines into a Pixi `Texture`, keyed by the same string
 * the timeline cues reference. Loads run with bounded parallelism so a long preamble doesn't gate the playfield
 * without fanning browser decoders out without limit.
 */
export async function prepareBga(this: PlayMediaContext): Promise<void> {
  const song = this.song;
  const source = this.source;
  if (!song || !source || !this.hasBga) {
    return;
  }
  // Use the control-flow-resolved chart so #IF-gated BMP / bga header declarations match the chosen #RANDOM branch.
  const chart = this.resolvedChart ?? song.chart;
  // Loaded as the beatoraja prep loads them (`chart/play-bga.ts`): base + POOR textures keep their blacks, the layer
  // track's are keyed out for BMS, videos get one texture for both tracks, and `#BGAxx` sub-regions become views.
  await loadPlayBga({
    chart,
    source,
    chartPath: song.chartPath,
    timeline: this.bgaTimeline,
    poorFallbackKey: this.poorBgaFallbackKey,
    into: {
      textures: this.bgaTextures,
      layerTextures: this.bgaLayerTextures,
      videos: this.bgaVideos,
      subRegionOrigins: this.bgaSubRegionOrigins,
    },
    transcode: {
      maxLongEdgePx: this.options.bgaTranscodeMaxLongEdgePx,
      useWebCodecs: this.options.bgaTranscodeUseWebCodecs,
    },
    tempo: this.tempo,
    isCancelled: () => this.disposed,
  });
  if (this.disposed) return;
  // Eager-upload every freshly loaded BGA texture (and any sub-region aliases registered above) so the first BGA
  // cue mid-chart doesn't stall on its own first sample. Mirrors the skin path in `prepare()`. This is fire-and-
  // forget from the prepareBga callsite — `bgaReadyPromise` already gates chart start, and adding the upload to
  // its tail just lengthens that promise by the upload work, which is what we want.
  await this.preparePixiUpload(this.bgaTextures.values());
  if (this.disposed) return;
  await this.preparePixiUpload(this.bgaLayerTextures.values());
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

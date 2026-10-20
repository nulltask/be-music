import type { NonstopStitchMap } from '@be-music/player/course';
import { DEFAULT_PLAYLOG_VIEW_REPLAY, type PlaylogPlay, type PlaylogTempoChange } from '@be-music/player/playlog';
import type { BeMusicEvent } from '@be-music/json';
import { stretchAudioBuffers, type TimeStretchAlgorithm } from './time-stretch.ts';
import type { WebAudioSessionSlicePlayback } from './web-audio-session.ts';

/**
 * The play tempo: a play runs `tempo` times as fast (the engine's `PlayerOptions.speed`), its clock, audio, scroll and
 * BGA alike, while judging stays in chart time. A stitched NONSTOP chart's FIT stages change the tempo the same way, per
 * stage, and the two multiply.
 */

/** The slowest and fastest play tempo the web player offers (-50 % .. +50 %). */
export const PLAY_TEMPO_MIN = 0.5;
export const PLAY_TEMPO_MAX = 1.5;

/**
 * How a tempo change sounds: `pitch` plays the samples faster or slower, so the pitch moves with the tempo (LR2, a
 * turntable); `keep-pitch` stretches the samples in time when they load and keeps their pitch.
 */
export type TempoPitchMode = 'pitch' | 'keep-pitch';

export type { TimeStretchAlgorithm };

/** `value` as a play tempo: clamped to {@link PLAY_TEMPO_MIN}..{@link PLAY_TEMPO_MAX} on a 1 % grid; 1 when unusable. */
export function clampPlayTempo(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 1;
  return Math.round(Math.min(PLAY_TEMPO_MAX, Math.max(PLAY_TEMPO_MIN, value)) * 100) / 100;
}

/** Chart seconds `elapsedSeconds` of the play clock cover at `tempo`. */
export function elapsedToChartSeconds(elapsedSeconds: number, tempo: number): number {
  return elapsedSeconds * tempo;
}

/** Play-clock seconds `chartSeconds` of the chart take at `tempo`. */
export function chartToElapsedSeconds(chartSeconds: number, tempo: number): number {
  return chartSeconds / tempo;
}

/**
 * The playback rate of a sample: in `pitch` mode the tempo times its NONSTOP stage's FIT rate (`stageRate`), in
 * `keep-pitch` mode 1, since the sample was stretched to that rate when it loaded ({@link resolveSampleStretchRates}).
 */
export function resolveSamplePlaybackRate(mode: TempoPitchMode, tempo: number, stageRate = 1): number {
  return mode === 'keep-pitch' ? 1 : tempo * stageRate;
}

/**
 * Whether the tempo can change during a play: in `pitch` mode the samples follow the tempo through their playback rate;
 * in `keep-pitch` mode they were stretched to the tempo they loaded at, so it stays.
 */
export function supportsLiveTempoChange(mode: TempoPitchMode): boolean {
  return mode === 'pitch';
}

/** The tempo a replay plays at: the one it starts at and the changes it follows (chart time, the log's clock). */
export interface ReplayTempo {
  tempo: number;
  changes: PlaylogTempoChange[];
}

/**
 * The tempo a replay plays at. When the viewer reproduces the recorded tempo (`reproduce`, by default as
 * `DEFAULT_PLAYLOG_VIEW_REPLAY`), it starts at `play.tempo` and, when the tempo can change live
 * ({@link supportsLiveTempoChange}), follows `play.tempoChanges`; otherwise it plays at the viewer's own tempo.
 */
export function resolveReplayTempo(
  play: Pick<PlaylogPlay, 'tempo' | 'tempoChanges'>,
  options: { ownTempo?: number; pitchMode: TempoPitchMode; reproduce?: boolean },
): ReplayTempo {
  if (!(options.reproduce ?? DEFAULT_PLAYLOG_VIEW_REPLAY.tempo)) {
    return { tempo: clampPlayTempo(options.ownTempo), changes: [] };
  }
  const changes = supportsLiveTempoChange(options.pitchMode)
    ? (play.tempoChanges ?? []).map((change) => ({ timeUs: change.timeUs, tempo: clampPlayTempo(change.tempo) }))
    : [];
  return { tempo: clampPlayTempo(play.tempo ?? 1), changes };
}

/** Runs BGA videos at `tempo`, so their time stays the chart time since their cue. */
export function setVideoPlaybackTempo(videos: Iterable<HTMLVideoElement>, tempo: number): void {
  for (const video of videos) {
    video.defaultPlaybackRate = tempo;
    video.playbackRate = tempo;
  }
}

/**
 * The samples a keep-pitch play stretches: every sample path of the chart's `#WAV` table (as `normalize` keys the
 * decoded-sample cache) with the rate it plays at, the tempo times its NONSTOP stage's FIT rate (`map`). Samples played
 * at rate 1 are left out.
 */
export function resolveSampleStretchRates(
  wav: Readonly<Record<string, string | undefined>>,
  normalize: (path: string) => string,
  tempo: number,
  map?: NonstopStitchMap,
): Map<string, number> {
  const stageRateOfKey = new Map<string, number>();
  for (const stage of map?.stages ?? []) {
    const rate = stage.placement.rate > 0 ? stage.placement.rate : 1;
    for (const key of stage.wavKeys) stageRateOfKey.set(key, rate);
  }
  const rates = new Map<string, number>();
  for (const [key, path] of Object.entries(wav)) {
    if (path === undefined) continue;
    const rate = tempo * (stageRateOfKey.get(key) ?? 1);
    if (rate !== 1 && rate > 0) rates.set(normalize(path), rate);
  }
  return rates;
}

/**
 * bmson slices of samples stretched by `rate` (played `rate` times as fast): each slice's offset and length shrink by
 * `rate`, so it still starts and ends on the same note. Other fields are kept; at rate 1 it is a plain copy.
 */
export function stretchSlicePlayback<T extends WebAudioSessionSlicePlayback>(
  slices: ReadonlyMap<BeMusicEvent, T>,
  rate: number,
): Map<BeMusicEvent, T> {
  if (rate === 1 || !(rate > 0)) return new Map(slices);
  const stretched = new Map<BeMusicEvent, T>();
  for (const [event, slice] of slices) {
    stretched.set(event, {
      ...slice,
      offsetSeconds: slice.offsetSeconds / rate,
      ...(slice.durationSeconds !== undefined ? { durationSeconds: slice.durationSeconds / rate } : {}),
    });
  }
  return stretched;
}

/**
 * Keep pitch: replaces each decoded sample in `samples` with itself stretched to its rate in `rates` (keyed as
 * `samples` is), keeping its pitch. The samples of one rate are stretched together (one Signalsmith Stretch render per
 * rate). Stops early once `cancelled` returns true.
 */
export async function stretchDecodedSamples(
  context: BaseAudioContext,
  samples: Map<string, AudioBuffer>,
  rates: ReadonlyMap<string, number>,
  algorithm: TimeStretchAlgorithm,
  cancelled: () => boolean = () => false,
): Promise<void> {
  const byRate = new Map<number, string[]>();
  for (const [path, rate] of rates) {
    if (samples.has(path)) byRate.set(rate, [...(byRate.get(rate) ?? []), path]);
  }
  for (const [rate, paths] of byRate) {
    if (cancelled()) return;
    const stretched = await stretchAudioBuffers(
      context,
      paths.map((path) => samples.get(path)!),
      rate,
      algorithm,
    );
    if (cancelled()) return;
    paths.forEach((path, index) => samples.set(path, stretched[index]!));
  }
}

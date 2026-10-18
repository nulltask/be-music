import type { TimingResolver, TimedSampleTrigger } from '@be-music/audio-renderer/triggers';
import { type BeMusicEvent, type BeMusicJson, normalizeObjectKey, resolveBmsBase } from '@be-music/json';
import type { TimedPlayableNote } from '@be-music/player/playable-notes';
import {
  clampSampleDuration,
  clampSampleOffset,
  type WebAudioSessionSlicePlayback,
} from '../../runtime/web-audio-session.ts';

const RESULT_DELAY_BEATS = 8;
const RESULT_DELAY_MIN_MS = 50;
const AUDIO_TAIL_PAD_MS = 500;
const AUDIO_TAIL_MAX_MS = 30_000;

export function resolvePostChartResultDelayMs(
  notes: ReadonlyArray<Pick<TimedPlayableNote, 'beat' | 'endBeat' | 'seconds' | 'endSeconds'>>,
  resolver: Pick<TimingResolver, 'beatToSeconds'> | undefined,
  currentSeconds: number,
): number {
  if (notes.length === 0 || resolver === undefined) return RESULT_DELAY_MIN_MS;

  let lastBeat = 0;
  let lastSeconds = 0;
  for (const note of notes) {
    const noteBeat = finiteOr(note.endBeat, note.beat);
    const noteSeconds = finiteOr(note.endSeconds, note.seconds);
    if (noteSeconds > lastSeconds || (Math.abs(noteSeconds - lastSeconds) < 1e-6 && noteBeat > lastBeat)) {
      lastBeat = noteBeat;
      lastSeconds = noteSeconds;
    }
  }

  const targetSeconds = resolver.beatToSeconds(lastBeat + RESULT_DELAY_BEATS);
  if (!Number.isFinite(targetSeconds)) return RESULT_DELAY_MIN_MS;
  const remainingMs = Math.round((targetSeconds - Math.max(currentSeconds, lastSeconds)) * 1000);
  return Math.max(RESULT_DELAY_MIN_MS, remainingMs);
}

export function resolveGameplayAudioTailCleanupDelayMs(options: {
  chart: BeMusicJson;
  notes: ReadonlyArray<Pick<TimedPlayableNote, 'event' | 'seconds'>>;
  autoSampleTriggers: ReadonlyArray<Pick<TimedSampleTrigger, 'event' | 'seconds'>>;
  decodedSamples: ReadonlyMap<string, AudioBuffer>;
  bmsonSlicePlayback?: ReadonlyMap<BeMusicEvent, WebAudioSessionSlicePlayback>;
  currentSeconds: number;
}): number {
  const latestEndSeconds = Math.max(
    resolveLatestSampleEndSeconds(options.notes, options),
    resolveLatestSampleEndSeconds(options.autoSampleTriggers, options),
  );
  if (!Number.isFinite(latestEndSeconds) || latestEndSeconds <= options.currentSeconds) return 0;
  const remainingMs = Math.ceil((latestEndSeconds - options.currentSeconds) * 1000) + AUDIO_TAIL_PAD_MS;
  return Math.max(0, Math.min(AUDIO_TAIL_MAX_MS, remainingMs));
}

function resolveLatestSampleEndSeconds(
  timedEvents: ReadonlyArray<{ event: BeMusicEvent; seconds: number }>,
  context: Pick<
    Parameters<typeof resolveGameplayAudioTailCleanupDelayMs>[0],
    'chart' | 'decodedSamples' | 'bmsonSlicePlayback'
  >,
): number {
  let latest = 0;
  for (const timed of timedEvents) {
    const duration = resolveSamplePlaybackDurationSeconds(timed.event, context);
    if (duration === undefined) continue;
    latest = Math.max(latest, timed.seconds + duration);
  }
  return latest;
}

function resolveSamplePlaybackDurationSeconds(
  event: BeMusicEvent,
  context: Pick<
    Parameters<typeof resolveGameplayAudioTailCleanupDelayMs>[0],
    'chart' | 'decodedSamples' | 'bmsonSlicePlayback'
  >,
): number | undefined {
  const sampleKey = normalizeObjectKey(event.value, resolveBmsBase(context.chart));
  const path = context.chart.resources.wav[sampleKey];
  if (typeof path !== 'string') return undefined;
  const buffer = context.decodedSamples.get(normalizeSamplePath(path));
  if (buffer === undefined) return undefined;
  const slice = context.bmsonSlicePlayback?.get(event);
  const offsetSeconds = clampSampleOffset(slice?.offsetSeconds, buffer.duration);
  const durationSeconds = clampSampleDuration(slice?.durationSeconds, buffer.duration, offsetSeconds);
  return durationSeconds ?? Math.max(0, buffer.duration - offsetSeconds);
}

function normalizeSamplePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

function finiteOr(primary: number | undefined, fallback: number): number {
  return typeof primary === 'number' && Number.isFinite(primary) ? primary : fallback;
}

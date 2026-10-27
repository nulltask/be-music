import {
  firesBeforeTempoReversal,
  isPlayLaneSoundChannel,
  usesMonophonicWAVPlayback,
  type ResolvedChart,
  type TimedSampleTrigger,
} from '@be-music/chart-model';
import { throwIfAborted } from '@be-music/shared-utils/core';
import { normalizeChannel, type BeMusicEvent } from '@be-music/chart-source';
import type { TimedPlayableNote } from '../playable-notes.ts';
import type { AudioSession, AudioSessionLoadProgress, PlayerOptions } from './engine-types.ts';
import { resolveOutputWriter } from './engine-trace.ts';

const DEBUG_ACTIVE_AUDIO_FALLBACK_SECONDS = 0.18;

interface RealtimeAudioTrigger {
  event: BeMusicEvent;
  seconds: number;
  channel: string;
}

export async function createAudioSessionIfEnabled(
  resolvedChart: ResolvedChart,
  options: PlayerOptions,
  mode: 'auto' | 'manual',
  onLoadProgress?: (progress: AudioSessionLoadProgress) => void,
): Promise<AudioSession | undefined> {
  throwIfAborted(options.signal);
  if (options.audio === false || !options.createAudioSession) {
    onLoadProgress?.({ ratio: 1, message: 'Audio disabled; skipping audio setup.' });
    return undefined;
  }
  const session = await options.createAudioSession({
    json: resolvedChart.source,
    resolvedChart,
    options,
    mode,
    onLoadProgress,
  });
  throwIfAborted(options.signal);
  if (session) resolveOutputWriter(options)(`Audio backend: ${session.backendLabel}\n`);
  onLoadProgress?.({ ratio: 1, message: session ? 'Audio ready.' : 'Audio unavailable.' });
  return session;
}

interface DebugSampleWindow {
  sampleKey: string;
  startSeconds: number;
  endSeconds: number;
  label: string;
}

interface DebugActiveAudioState {
  activeAudioFiles: string[];
  activeAudioVoiceCount: number;
}

interface DebugActiveAudioEstimator {
  resolve: (nowSeconds: number) => DebugActiveAudioState;
}

export async function createDebugActiveAudioEstimator(
  resolved: ResolvedChart,
  options: {
    baseDir?: string;
    signal?: AbortSignal;
    loadSampleDurations?: PlayerOptions['loadAudioSampleDurations'];
  } = {},
): Promise<DebugActiveAudioEstimator> {
  throwIfAborted(options.signal);
  const json = resolved.source;
  const triggers = resolved.sampleTriggers;
  const sampleDurationSecondsByKey =
    (await options.loadSampleDurations?.(resolved, options)) ?? new Map<string, number>();
  throwIfAborted(options.signal);
  const windows: DebugSampleWindow[] = triggers
    .map((trigger) => {
      const startSeconds = Math.max(0, trigger.seconds);
      const durationSeconds =
        typeof trigger.sampleDurationSeconds === 'number' && Number.isFinite(trigger.sampleDurationSeconds)
          ? Math.max(0, trigger.sampleDurationSeconds)
          : Math.max(
              0,
              (sampleDurationSecondsByKey.get(trigger.sampleKey) ?? DEBUG_ACTIVE_AUDIO_FALLBACK_SECONDS) -
                Math.max(0, trigger.sampleOffsetSeconds),
            );
      return {
        sampleKey: trigger.sampleKey,
        startSeconds,
        endSeconds: startSeconds + durationSeconds,
        label: trigger.samplePath ?? trigger.sampleKey,
      } satisfies DebugSampleWindow;
    })
    .filter((window) => window.endSeconds > window.startSeconds)
    .sort((left, right) => left.startSeconds - right.startSeconds);

  if (usesMonophonicWAVPlayback(json)) {
    const latestBySampleKey = new Map<string, number>();
    for (let index = 0; index < windows.length; index += 1) {
      const window = windows[index]!;
      const previousIndex = latestBySampleKey.get(window.sampleKey);
      if (previousIndex !== undefined) {
        const previousWindow = windows[previousIndex]!;
        if (window.startSeconds < previousWindow.endSeconds) {
          previousWindow.endSeconds = window.startSeconds;
        }
      }
      latestBySampleKey.set(window.sampleKey, index);
    }
  }

  let active: DebugSampleWindow[] = [];
  let nextIndex = 0;
  let lastResolvedSeconds = Number.NEGATIVE_INFINITY;

  const rebuildAt = (nowSeconds: number): void => {
    active = [];
    nextIndex = 0;
    while (nextIndex < windows.length && windows[nextIndex]!.startSeconds <= nowSeconds) {
      const window = windows[nextIndex]!;
      nextIndex += 1;
      if (window.endSeconds > nowSeconds) {
        active.push(window);
      }
    }
  };

  return {
    resolve: (nowSeconds: number): DebugActiveAudioState => {
      const safeNowSeconds = Number.isFinite(nowSeconds) ? Math.max(0, nowSeconds) : 0;
      if (safeNowSeconds < lastResolvedSeconds) {
        rebuildAt(safeNowSeconds);
      } else {
        while (nextIndex < windows.length && windows[nextIndex]!.startSeconds <= safeNowSeconds) {
          const window = windows[nextIndex]!;
          nextIndex += 1;
          if (window.endSeconds > safeNowSeconds) {
            active.push(window);
          }
        }
      }
      lastResolvedSeconds = safeNowSeconds;

      let writeIndex = 0;
      for (let readIndex = 0; readIndex < active.length; readIndex += 1) {
        const window = active[readIndex]!;
        if (window.endSeconds <= safeNowSeconds) {
          continue;
        }
        if (writeIndex !== readIndex) {
          active[writeIndex] = window;
        }
        writeIndex += 1;
      }
      active.length = writeIndex;

      const uniqueLabels = new Set<string>();
      for (const window of active) {
        uniqueLabels.add(window.label);
      }
      return {
        activeAudioFiles: [...uniqueLabels],
        activeAudioVoiceCount: active.length,
      };
    },
  };
}
/**
 * The chart's sample triggers on the channels `includeChannel` accepts, as realtime audio triggers. Under an LR2
 * negative-BPM reversal (#134) only what fires before LR2's event pump freezes is kept: everything strictly before the
 * reversal, and on its tick only what LR2 orders before the negative BPM (BGM, BGA) — see `firesBeforeTempoReversal`.
 */
export function collectRealtimeAudioTriggers(
  resolved: ResolvedChart,
  includeChannel: (channel: string) => boolean = () => true,
): Array<TimedSampleTrigger & RealtimeAudioTrigger> {
  const filtered: Array<TimedSampleTrigger & RealtimeAudioTrigger> = [];
  const { reversal } = resolved;
  for (const trigger of resolved.sampleTriggers) {
    if (!includeChannel(trigger.channel)) {
      continue;
    }
    if (!firesBeforeTempoReversal(reversal, trigger.seconds, trigger.channel)) {
      continue;
    }
    filtered.push({
      ...trigger,
      seconds: Math.max(0, trigger.seconds),
      channel: normalizeChannel(trigger.channel),
    });
  }
  return filtered;
}

/**
 * Adds the play-lane triggers of `shadowedNotes` to `target` (kept sorted by time). Notes are matched to triggers by
 * channel, position and value rather than by identity, because a host-prepared chart may come from another resolution
 * of the same chart than the one the engine collects triggers from.
 */
export function appendShadowedNoteTriggers(
  target: Array<TimedSampleTrigger & RealtimeAudioTrigger>,
  resolved: ResolvedChart,
  shadowedNotes: readonly TimedPlayableNote[] | undefined,
): void {
  if (!shadowedNotes || shadowedNotes.length === 0) {
    return;
  }
  const pendingByKey = new Map<string, number>();
  for (const note of shadowedNotes) {
    const key = createEventMatchKey(note.event);
    pendingByKey.set(key, (pendingByKey.get(key) ?? 0) + 1);
  }
  let appended = false;
  for (const trigger of collectRealtimeAudioTriggers(resolved, isPlayLaneSoundChannel)) {
    const key = createEventMatchKey(trigger.event);
    const pending = pendingByKey.get(key) ?? 0;
    if (pending === 0) {
      continue;
    }
    pendingByKey.set(key, pending - 1);
    target.push(trigger);
    appended = true;
  }
  if (appended) {
    target.sort((left, right) => left.seconds - right.seconds);
  }
}

function createEventMatchKey(event: BeMusicEvent): string {
  return `${normalizeChannel(event.channel)}:${event.measure}:${event.position[0]}/${event.position[1]}:${event.value}`;
}

import {
  collectLNOBJEndEvents,
  firesBeforeTempoReversal,
  isBmsBGMVolumeChangeChannel,
  isBMSDynamicVolumeChangeChannel,
  isBMSKeyVolumeChangeChannel,
  isPlayLaneSoundChannel,
  parseBMSDynamicVolumeGain,
  usesMonophonicWAVPlayback,
  volWAVToLinearGain,
  type ResolvedChart,
  type TimedSampleTrigger,
} from '@be-music/chart-model';
import { floatToInt16, throwIfAborted } from '@be-music/shared-utils/core';
import { type BeMusicEvent, normalizeChannel, normalizeObjectKey, resolveBMSBase } from '@be-music/chart-source';
import { type RenderResult, renderSingleSample } from '@be-music/chart-audio-renderer';
import { type TimedPlayableNote } from '../playable-notes.ts';
import { createNodeAudioSink, type AudioSink } from '../audio-sink.ts';
import { LANDMINE_EXPLOSION_SAMPLE_KEY } from './judge-core.ts';
import { delay, PAUSE_POLL_INTERVAL_MS } from './engine-clock.ts';
import { resolveOutputWriter } from './engine-trace.ts';
import { type AudioSession, type AudioSessionLoadProgress, type PlayerOptions } from './engine-types.ts';
import { resolveDefaultBaseDir } from './bootstrap.ts';

/**
 * The built-in audio path: the Node audio session, sample loading, realtime triggers and output mixing.
 */
interface AudioLeadTuning {
  baseLeadMs: number;
  maxLeadMs: number;
  stepUpMs: number;
  stepDownMs: number;
}

interface OutputDynamicsConfig {
  compressorEnabled: boolean;
  compressorThresholdLinear: number;
  compressorInvRatioMinusOne: number;
  compressorAttackCoef: number;
  compressorReleaseCoef: number;
  compressorMakeupGain: number;
  limiterEnabled: boolean;
  limiterCeilingLinear: number;
  limiterReleaseCoef: number;
}

interface PlayableNotePlayback {
  offsetSeconds: number;
  durationSeconds?: number;
  sliceId?: string;
}

interface RealtimeAudioTrigger {
  event: BeMusicEvent;
  seconds: number;
  channel: string;
}

const AUTO_AUDIO_CHUNK_FRAMES = 256;

const MANUAL_AUDIO_CHUNK_FRAMES = 256;

const MANUAL_AUDIO_TARGET_LEAD_MS = 10;

const AUTO_AUDIO_TARGET_LEAD_MS = MANUAL_AUDIO_TARGET_LEAD_MS;

const AUDIO_TARGET_LEAD_MAX_MS = 32;

const AUDIO_TARGET_LEAD_STEP_UP_MS = 1.5;

const AUDIO_TARGET_LEAD_STEP_DOWN_MS = 0.5;

const DEBUG_ACTIVE_AUDIO_FALLBACK_SECONDS = 0.18;

const DEBUG_ACTIVE_AUDIO_SAMPLE_RATE = 44_100;

const RUNTIME_AUDIO_SAMPLE_RATE = 44_100;

const DEFAULT_COMPRESSOR_THRESHOLD_DB = -12;

const DEFAULT_COMPRESSOR_RATIO = 2.5;

const DEFAULT_COMPRESSOR_ATTACK_MS = 8;

const DEFAULT_COMPRESSOR_RELEASE_MS = 120;

const DEFAULT_COMPRESSOR_MAKEUP_DB = 0;

const DEFAULT_LIMITER_CEILING_DB = -0.3;

const DEFAULT_LIMITER_RELEASE_MS = 80;

export async function createAudioSessionIfEnabled(
  resolved: ResolvedChart,
  options: PlayerOptions,
  mode: 'auto' | 'manual',
  onLoadProgress?: (progress: AudioSessionLoadProgress) => void,
): Promise<AudioSession | undefined> {
  const json = resolved.source;
  throwIfAborted(options.signal);
  const writeOutput = resolveOutputWriter(options);
  if (options.audio === false) {
    onLoadProgress?.({
      ratio: 1,
      message: 'Audio disabled; skipping audio setup.',
    });
    return undefined;
  }
  // Custom backend hook (web / browser / test). When supplied, the factory owns sample loading, mixing, and clock
  // state — we only forward the standard load-progress reporter so the host UI's loading bar still ticks during the
  // backend's own asset-decode phase. A factory that returns `undefined` is treated the same as omitting the hook
  // (fall through to the Node sink); this lets a runtime conditionally opt out at runtime (e.g. browser without
  // AudioContext support).
  if (options.createAudioSession) {
    const customSession = await options.createAudioSession({ json, options, mode, onLoadProgress });
    throwIfAborted(options.signal);
    if (customSession) {
      writeOutput(`Audio backend: ${customSession.backendLabel}\n`);
      onLoadProgress?.({ ratio: 1, message: 'Audio ready.' });
      return customSession;
    }
  }

  const headPaddingMs = options.audioHeadPaddingMs ?? 0;
  const masterVolume = normalizeMasterVolume(options.volume);
  const bgmVolume = normalizeBGMVolume(options.bgmVolume, masterVolume);
  const playVolume = normalizePlayVolume(options.playVolume, masterVolume);
  const chartWAVGain = volWAVToLinearGain(json.bms.volWAV);
  const lnobjEndEvents = collectLNOBJEndEvents(json);
  const runtimeSampleRate = RUNTIME_AUDIO_SAMPLE_RATE;

  onLoadProgress?.({
    ratio: 0.05,
    message: 'Preparing real-time key sounds...',
  });
  throwIfAborted(options.signal);
  const samplesByKey = await buildRuntimeSampleMap(
    resolved,
    options,
    runtimeSampleRate,
    (progress) => {
      const ratio = progress.total <= 0 ? 1 : progress.loaded / progress.total;
      onLoadProgress?.({
        ratio: 0.08 + Math.max(0, Math.min(1, ratio)) * 0.72,
        message: `Loading key sounds... (${progress.loaded}/${progress.total})`,
        detail: progress.samplePath ?? progress.sampleKey,
      });
    },
    chartWAVGain,
    options.signal,
  );
  // Cache the chart's object-ID radix so the per-event runtime lookup below uses the same case-sensitivity as the keys
  // in `samplesByKey` (which were extracted from `json.resources.wav` and therefore mirror the chart's authored case).
  const runtimeSampleIdBase = resolveBMSBase(json);
  throwIfAborted(options.signal);
  onLoadProgress?.({
    ratio: 0.82,
    message: 'Initializing audio backend...',
  });
  const background = createSilentRenderResult(runtimeSampleRate);

  const sampleRate = toPlaybackSampleRate(background.sampleRate, options.speed ?? 1);
  const samplesPerFrame = mode === 'manual' ? MANUAL_AUDIO_CHUNK_FRAMES : AUTO_AUDIO_CHUNK_FRAMES;
  const leadTuning = createAudioLeadTuning(options, mode);
  const outputDynamics = createOutputDynamicsConfig(options, sampleRate);
  const output = await createNodeAudioSink({
    sampleRate,
    channels: 2,
    samplesPerFrame,
    mode,
    signal: options.signal,
  });
  throwIfAborted(options.signal);
  if (!output) {
    writeOutput('Audio playback disabled: node-web-audio-api is unavailable.\n');
    onLoadProgress?.({
      ratio: 1,
      message: 'node-web-audio-api is unavailable; continuing without audio.',
    });
    return undefined;
  }

  writeOutput(`Audio backend: ${output.label}\n`);

  const eventPlaybackMap = buildEventPlaybackMap(resolved);
  onLoadProgress?.({
    ratio: 1,
    message: 'Audio ready.',
  });

  let closed = false;
  let abortRequested = false;
  let draining = false;
  let paused = false;
  let playbackTask: Promise<void> | undefined;
  const activeVoices: ActiveVoice[] = [];
  let currentBGMDynamicGain = 1;
  let currentPlayDynamicGain = 1;

  output.onError(() => {
    writeOutput(`Audio playback stream error (${output.label}).\n`);
  });

  const finish = async (): Promise<void> => {
    if (closed) {
      return;
    }
    draining = true;
    if (!playbackTask) {
      return;
    }
    await playbackTask.catch(() => undefined);
  };

  const dispose = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    abortRequested = true;
    draining = true;

    output.destroy();

    if (playbackTask) {
      await Promise.race([playbackTask.catch(() => undefined), delay(300)]);
    }
  };

  return {
    backendLabel: output.label,
    start: () => {
      if (closed || playbackTask) {
        return;
      }

      playbackTask = playMixedPCMThroughOutput({
        output,
        background,
        activeVoices,
        shouldStop: () => abortRequested,
        isDraining: () => draining,
        isPaused: () => paused,
        mode,
        leadTuning,
        outputDynamics,
        playbackSampleRate: sampleRate,
      }).catch(() => undefined);
    },
    finish,
    dispose,
    chartStartDelayMs: headPaddingMs,
    getClockState: () => output.getClockState(),
    pause: () => {
      if (closed) {
        return;
      }
      paused = true;
      void output.suspend();
    },
    resume: () => {
      if (closed) {
        return;
      }
      paused = false;
      void output.resume();
    },
    getActiveAudioFiles: () => collectActiveAudioFileNames(activeVoices),
    getActiveAudioVoiceCount: () => activeVoices.length,
    triggerEvent: (event: BeMusicEvent) => {
      if (draining || abortRequested || paused) {
        return;
      }
      const normalizedChannel = normalizeChannel(event.channel);
      if (isBMSDynamicVolumeChangeChannel(normalizedChannel)) {
        const dynamicGain = parseBMSDynamicVolumeGain(event.value);
        if (dynamicGain === undefined) {
          return;
        }
        if (isBMSKeyVolumeChangeChannel(normalizedChannel)) {
          currentPlayDynamicGain = dynamicGain;
        } else if (isBmsBGMVolumeChangeChannel(normalizedChannel)) {
          currentBGMDynamicGain = dynamicGain;
        }
        return;
      }
      if (lnobjEndEvents.has(event)) {
        return;
      }
      const normalized = normalizeObjectKey(event.value, runtimeSampleIdBase);
      const sample = samplesByKey.get(normalized);
      if (!sample) {
        return;
      }
      const playback = eventPlaybackMap.get(event);
      const offsetSeconds = playback?.offsetSeconds ?? 0;
      const offsetFrames = Math.max(0, Math.round(offsetSeconds * sample.sampleRate));
      const durationFrames =
        typeof playback?.durationSeconds === 'number' && Number.isFinite(playback.durationSeconds)
          ? Math.max(1, Math.round(playback.durationSeconds * sample.sampleRate))
          : sample.left.length - offsetFrames;
      const endPosition = Math.min(sample.left.length, offsetFrames + durationFrames);
      if (offsetFrames >= endPosition) {
        return;
      }
      if (usesMonophonicWAVPlayback(json)) {
        removeActiveVoicesInPlace(activeVoices, (voice) => voice.sampleKey === normalized);
      }
      if (playback?.sliceId && activeVoices.some((voice) => voice.sliceId === playback.sliceId)) {
        return;
      }
      const isPlayLaneSound = isPlayLaneSoundChannel(normalizedChannel);
      const voiceGain =
        (isPlayLaneSound ? playVolume : bgmVolume) * (isPlayLaneSound ? currentPlayDynamicGain : currentBGMDynamicGain);
      if (voiceGain <= 0) {
        return;
      }
      activeVoices.push({
        sample,
        position: offsetFrames,
        endPosition,
        channel: normalizeChannel(event.channel),
        sampleKey: normalized,
        samplePath: json.resources.wav[normalized],
        sliceId: playback?.sliceId,
        gain: voiceGain,
      });
    },
    stopChannel:
      mode === 'manual'
        ? (channel: string) => {
            if (paused) {
              return;
            }
            const normalizedChannel = normalizeChannel(channel);
            removeActiveVoicesInPlace(activeVoices, (voice) => voice.channel === normalizedChannel);
          }
        : undefined,
  };
}

interface ActiveVoice {
  sample: RenderResult;
  position: number;
  endPosition: number;
  channel?: string;
  sampleKey?: string;
  samplePath?: string;
  sliceId?: string;
  gain: number;
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

function collectActiveAudioFileNames(activeVoices: ActiveVoice[]): string[] {
  const unique = new Set<string>();
  for (const voice of activeVoices) {
    const label = voice.samplePath ?? voice.sampleKey;
    if (typeof label !== 'string' || label.length === 0) {
      continue;
    }
    unique.add(label);
  }
  return [...unique];
}

export async function createDebugActiveAudioEstimator(
  resolved: ResolvedChart,
  options: {
    baseDir?: string;
    signal?: AbortSignal;
  } = {},
): Promise<DebugActiveAudioEstimator> {
  throwIfAborted(options.signal);
  const json = resolved.source;
  const triggers = resolved.sampleTriggers;
  const sampleDurationSecondsByKey = await buildDebugSampleDurationSecondsMap(
    triggers,
    options.baseDir,
    options.signal,
    resolveBMSBase(json),
  );
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

async function buildDebugSampleDurationSecondsMap(
  triggers: ReadonlyArray<TimedSampleTrigger>,
  baseDir: string | undefined,
  signal: AbortSignal | undefined,
  base: 36 | 62,
): Promise<Map<string, number>> {
  throwIfAborted(signal);
  const uniqueTriggers = new Map<string, TimedSampleTrigger>();
  for (const trigger of triggers) {
    if (!uniqueTriggers.has(trigger.sampleKey)) {
      uniqueTriggers.set(trigger.sampleKey, trigger);
    }
  }

  const durations = new Map<string, number>();
  for (const trigger of uniqueTriggers.values()) {
    throwIfAborted(signal);
    const rendered = await renderSingleSample(trigger.sampleKey, trigger.samplePath, {
      baseDir: baseDir ?? resolveDefaultBaseDir(),
      sampleRate: DEBUG_ACTIVE_AUDIO_SAMPLE_RATE,
      gain: 1,
      fallbackToneSeconds: DEBUG_ACTIVE_AUDIO_FALLBACK_SECONDS,
      signal,
      base,
    });
    durations.set(trigger.sampleKey, rendered.durationSeconds);
  }
  return durations;
}

function removeActiveVoicesInPlace(activeVoices: ActiveVoice[], shouldRemove: (voice: ActiveVoice) => boolean): void {
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < activeVoices.length; readIndex += 1) {
    const voice = activeVoices[readIndex]!;
    if (shouldRemove(voice)) {
      continue;
    }
    if (writeIndex !== readIndex) {
      activeVoices[writeIndex] = voice;
    }
    writeIndex += 1;
  }
  activeVoices.length = writeIndex;
}

function advanceAndPruneActiveVoices(activeVoices: ActiveVoice[], chunkFrames: number): void {
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < activeVoices.length; readIndex += 1) {
    const voice = activeVoices[readIndex]!;
    voice.position += chunkFrames;
    if (voice.position >= voice.endPosition) {
      continue;
    }
    if (writeIndex !== readIndex) {
      activeVoices[writeIndex] = voice;
    }
    writeIndex += 1;
  }
  activeVoices.length = writeIndex;
}

async function playMixedPCMThroughOutput(params: {
  output: AudioSink;
  background: RenderResult;
  activeVoices: ActiveVoice[];
  shouldStop: () => boolean;
  isDraining: () => boolean;
  isPaused: () => boolean;
  mode: 'auto' | 'manual';
  leadTuning: AudioLeadTuning;
  outputDynamics?: OutputDynamicsConfig;
  playbackSampleRate: number;
}): Promise<void> {
  const { output, background, activeVoices, shouldStop, isDraining, isPaused, mode, leadTuning, playbackSampleRate } =
    params;

  const chunkFrames = mode === 'manual' ? MANUAL_AUDIO_CHUNK_FRAMES : AUTO_AUDIO_CHUNK_FRAMES;
  // Keep one reusable PCM buffer and fill through Int16Array to minimize per-sample write overhead.
  const chunkSamples = new Int16Array(chunkFrames * 2);
  const chunk = new Uint8Array(chunkSamples.buffer);
  const mixedLeft = new Float32Array(chunkFrames);
  const mixedRight = new Float32Array(chunkFrames);
  const backgroundLeft = background.left;
  const backgroundRight = background.right;
  const backgroundLength = backgroundLeft.length;
  let playhead = 0;
  const outputStartSeconds = output.getClockState().outputSeconds;
  let adaptiveLeadMs = leadTuning.baseLeadMs;
  const chunkDurationMs = (chunkFrames / playbackSampleRate) * 1000;
  const outputDynamics = params.outputDynamics;
  let compressorGain = 1;
  let limiterGain = 1;

  while (!shouldStop()) {
    if (isPaused()) {
      await delay(PAUSE_POLL_INTERVAL_MS);
      continue;
    }

    const mixStartedAtMs = performance.now();
    await waitForPlaybackRealtime(output, playhead, playbackSampleRate, outputStartSeconds, shouldStop, adaptiveLeadMs);

    const backgroundEnded = playhead >= background.left.length;
    if (isDraining() && backgroundEnded && activeVoices.length === 0) {
      break;
    }

    for (let frame = 0; frame < chunkFrames; frame += 1) {
      const sourceFrame = playhead + frame;
      if (sourceFrame < backgroundLength) {
        mixedLeft[frame] = backgroundLeft[sourceFrame];
        mixedRight[frame] = backgroundRight[sourceFrame];
      } else {
        mixedLeft[frame] = 0;
        mixedRight[frame] = 0;
      }
    }

    // Voice-major accumulation removes a per-sample boundary branch from the hot path.
    for (let voiceIndex = 0; voiceIndex < activeVoices.length; voiceIndex += 1) {
      const voice = activeVoices[voiceIndex]!;
      const voiceFrames = Math.min(chunkFrames, voice.endPosition - voice.position);
      if (voiceFrames <= 0) {
        continue;
      }
      const voiceLeft = voice.sample.left;
      const voiceRight = voice.sample.right;
      const voiceGain = voice.gain;
      let sourceFrame = voice.position;
      if (Math.abs(voiceGain - 1) <= 1e-9) {
        for (let frame = 0; frame < voiceFrames; frame += 1) {
          mixedLeft[frame] += voiceLeft[sourceFrame];
          mixedRight[frame] += voiceRight[sourceFrame];
          sourceFrame += 1;
        }
      } else {
        for (let frame = 0; frame < voiceFrames; frame += 1) {
          mixedLeft[frame] += voiceLeft[sourceFrame] * voiceGain;
          mixedRight[frame] += voiceRight[sourceFrame] * voiceGain;
          sourceFrame += 1;
        }
      }
    }

    for (let frame = 0; frame < chunkFrames; frame += 1) {
      const sampleOffset = frame * 2;
      let leftSample = mixedLeft[frame];
      let rightSample = mixedRight[frame];

      if (outputDynamics) {
        const level = Math.max(Math.abs(leftSample), Math.abs(rightSample));
        if (outputDynamics.compressorEnabled) {
          const desiredCompressorGain =
            level > outputDynamics.compressorThresholdLinear
              ? Math.pow(level / outputDynamics.compressorThresholdLinear, outputDynamics.compressorInvRatioMinusOne)
              : 1;
          const compressorCoef =
            desiredCompressorGain < compressorGain
              ? outputDynamics.compressorAttackCoef
              : outputDynamics.compressorReleaseCoef;
          compressorGain = desiredCompressorGain + compressorCoef * (compressorGain - desiredCompressorGain);
        } else {
          compressorGain = 1;
        }

        const compressorAppliedGain = compressorGain * outputDynamics.compressorMakeupGain;
        leftSample *= compressorAppliedGain;
        rightSample *= compressorAppliedGain;

        if (outputDynamics.limiterEnabled) {
          const limitedLevel = Math.max(Math.abs(leftSample), Math.abs(rightSample));
          const desiredLimiterGain =
            limitedLevel > outputDynamics.limiterCeilingLinear && limitedLevel > 1e-9
              ? outputDynamics.limiterCeilingLinear / limitedLevel
              : 1;
          if (desiredLimiterGain < limiterGain) {
            // Limiter attack is immediate to avoid transient clipping.
            limiterGain = desiredLimiterGain;
          } else {
            limiterGain = desiredLimiterGain + outputDynamics.limiterReleaseCoef * (limiterGain - desiredLimiterGain);
          }
          leftSample *= limiterGain;
          rightSample *= limiterGain;
        } else {
          limiterGain = 1;
        }
      }

      chunkSamples[sampleOffset] = floatToInt16(leftSample);
      chunkSamples[sampleOffset + 1] = floatToInt16(rightSample);
    }

    advanceAndPruneActiveVoices(activeVoices, chunkFrames);
    playhead += chunkFrames;

    const writable = output.write(chunk);
    if (!writable) {
      await output.waitWritable(shouldStop);
    }

    const mixDurationMs = Math.max(0, performance.now() - mixStartedAtMs);
    adaptiveLeadMs = resolveAdaptiveLeadMs(
      adaptiveLeadMs,
      leadTuning,
      chunkDurationMs,
      mixDurationMs,
      activeVoices.length,
    );
  }

  if (shouldStop()) {
    return;
  }

  await output.end();
}

async function waitForPlaybackRealtime(
  output: AudioSink,
  playheadFrames: number,
  sampleRate: number,
  startOutputSeconds: number,
  shouldStop: () => boolean,
  targetLeadMs: number,
): Promise<void> {
  const safeTargetLeadMs = Number.isFinite(targetLeadMs) ? Math.max(0, targetLeadMs) : MANUAL_AUDIO_TARGET_LEAD_MS;
  const targetLeadFrames = Math.max(0, Math.round((safeTargetLeadMs / 1000) * sampleRate));

  while (!shouldStop()) {
    const outputSeconds = Math.max(0, output.getClockState().outputSeconds - startOutputSeconds);
    const elapsedFrames = Math.floor(outputSeconds * sampleRate);
    const leadFrames = playheadFrames - elapsedFrames;
    if (leadFrames <= targetLeadFrames) {
      return;
    }

    const waitFrames = leadFrames - targetLeadFrames;
    const waitMs = Math.max(1, Math.ceil((waitFrames / sampleRate) * 1000));
    await delay(Math.min(waitMs, 3));
  }
}

function resolveAdaptiveLeadMs(
  currentLeadMs: number,
  tuning: AudioLeadTuning,
  chunkDurationMs: number,
  mixDurationMs: number,
  activeVoiceCount: number,
): number {
  const safeBaseLeadMs = Number.isFinite(tuning.baseLeadMs) ? Math.max(0, tuning.baseLeadMs) : 0;
  const safeMaxLeadMs = Number.isFinite(tuning.maxLeadMs)
    ? Math.max(safeBaseLeadMs, tuning.maxLeadMs)
    : AUDIO_TARGET_LEAD_MAX_MS;
  const safeStepUpMs =
    Number.isFinite(tuning.stepUpMs) && tuning.stepUpMs > 0 ? tuning.stepUpMs : AUDIO_TARGET_LEAD_STEP_UP_MS;
  const safeStepDownMs =
    Number.isFinite(tuning.stepDownMs) && tuning.stepDownMs > 0 ? tuning.stepDownMs : AUDIO_TARGET_LEAD_STEP_DOWN_MS;
  const safeCurrentLeadMs = Number.isFinite(currentLeadMs) ? Math.max(0, currentLeadMs) : safeBaseLeadMs;
  const safeChunkDurationMs = Number.isFinite(chunkDurationMs) ? Math.max(1, chunkDurationMs) : 1;
  const safeMixDurationMs = Number.isFinite(mixDurationMs) ? Math.max(0, mixDurationMs) : 0;

  const loadRatio = safeMixDurationMs / safeChunkDurationMs;
  let nextLeadMs = safeCurrentLeadMs;
  if (loadRatio >= 0.7) {
    nextLeadMs += safeStepUpMs;
  } else if (loadRatio <= 0.45) {
    nextLeadMs -= safeStepDownMs;
  }

  // Keep small baseline latency while granting temporary headroom for dense chord bursts.
  const polyphonyFloorMs = safeBaseLeadMs + Math.max(0, activeVoiceCount - 24) * 0.2;
  const minLeadMs = Math.max(safeBaseLeadMs, Math.min(safeMaxLeadMs, polyphonyFloorMs));
  if (nextLeadMs < minLeadMs) {
    nextLeadMs = minLeadMs;
  }
  return Math.min(safeMaxLeadMs, nextLeadMs);
}

function createAudioLeadTuning(options: PlayerOptions, mode: 'auto' | 'manual'): AudioLeadTuning {
  const defaultBaseLeadMs = mode === 'manual' ? MANUAL_AUDIO_TARGET_LEAD_MS : AUTO_AUDIO_TARGET_LEAD_MS;
  const baseLeadMs = resolvePositiveNumberOption(options.audioLeadMs, defaultBaseLeadMs);
  const maxLeadMs = Math.max(baseLeadMs, resolvePositiveNumberOption(options.audioLeadMaxMs, AUDIO_TARGET_LEAD_MAX_MS));
  const stepUpMs = resolvePositiveNumberOption(options.audioLeadStepUpMs, AUDIO_TARGET_LEAD_STEP_UP_MS);
  const stepDownMs = resolvePositiveNumberOption(options.audioLeadStepDownMs, AUDIO_TARGET_LEAD_STEP_DOWN_MS);
  return {
    baseLeadMs,
    maxLeadMs,
    stepUpMs,
    stepDownMs,
  };
}

function createOutputDynamicsConfig(options: PlayerOptions, sampleRate: number): OutputDynamicsConfig | undefined {
  const limiterEnabled = options.limiter !== false;
  const compressorEnabled = Boolean(options.compressor);
  if (!limiterEnabled && !compressorEnabled) {
    return undefined;
  }

  const compressorThresholdDb = Math.min(
    0,
    resolveFiniteNumberOption(options.compressorThresholdDb, DEFAULT_COMPRESSOR_THRESHOLD_DB),
  );
  const compressorThresholdLinear = Math.max(1e-4, dbToLinear(compressorThresholdDb));
  const compressorRatio = Math.max(
    1.01,
    resolvePositiveNumberOption(options.compressorRatio, DEFAULT_COMPRESSOR_RATIO),
  );
  const compressorInvRatioMinusOne = 1 / compressorRatio - 1;
  const compressorAttackMs = resolvePositiveNumberOption(options.compressorAttackMs, DEFAULT_COMPRESSOR_ATTACK_MS);
  const compressorReleaseMs = resolvePositiveNumberOption(options.compressorReleaseMs, DEFAULT_COMPRESSOR_RELEASE_MS);
  const compressorMakeupDb = resolveFiniteNumberOption(options.compressorMakeupDb, DEFAULT_COMPRESSOR_MAKEUP_DB);
  const compressorMakeupGain = dbToLinear(compressorMakeupDb);

  const limiterCeilingDb = Math.min(0, resolveFiniteNumberOption(options.limiterCeilingDb, DEFAULT_LIMITER_CEILING_DB));
  const limiterCeilingLinear = Math.max(1e-4, dbToLinear(limiterCeilingDb));
  const limiterReleaseMs = resolvePositiveNumberOption(options.limiterReleaseMs, DEFAULT_LIMITER_RELEASE_MS);

  return {
    compressorEnabled,
    compressorThresholdLinear,
    compressorInvRatioMinusOne,
    compressorAttackCoef: resolveTimeSmoothingCoef(compressorAttackMs, sampleRate),
    compressorReleaseCoef: resolveTimeSmoothingCoef(compressorReleaseMs, sampleRate),
    compressorMakeupGain,
    limiterEnabled,
    limiterCeilingLinear,
    limiterReleaseCoef: resolveTimeSmoothingCoef(limiterReleaseMs, sampleRate),
  };
}

function resolveFiniteNumberOption(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function resolveTimeSmoothingCoef(timeMs: number, sampleRate: number): number {
  const safeTimeMs = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
  const safeSampleRate = Number.isFinite(sampleRate) ? Math.max(1, sampleRate) : 1;
  if (safeTimeMs <= 0) {
    return 0;
  }
  return Math.exp(-1 / ((safeTimeMs / 1000) * safeSampleRate));
}

function dbToLinear(db: number): number {
  const safeDb = Number.isFinite(db) ? db : 0;
  return 10 ** (safeDb / 20);
}

function resolvePositiveNumberOption(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

export function shouldUseAutoMixBGMHeadroomControl(options: PlayerOptions): boolean {
  return options.limiter === false;
}

async function buildRuntimeSampleMap(
  resolved: ResolvedChart,
  options: PlayerOptions,
  sampleRate: number,
  onProgress?: (progress: { loaded: number; total: number; sampleKey: string; samplePath?: string }) => void,
  chartWAVGain = 1,
  signal?: AbortSignal,
): Promise<Map<string, RenderResult>> {
  throwIfAborted(signal);
  const json = resolved.source;
  const sampleMap = new Map<string, RenderResult>();
  const keys = collectRealtimeAudioSampleKeys(resolved);

  if (keys.length === 0) {
    onProgress?.({
      loaded: 0,
      total: 0,
      sampleKey: '',
      samplePath: undefined,
    });
  }

  const idBase = resolveBMSBase(json);
  for (let index = 0; index < keys.length; index += 1) {
    throwIfAborted(signal);
    const key = keys[index];
    const sourcePath = json.resources.wav[key];
    const rendered = await renderSingleSample(key, sourcePath, {
      baseDir: options.audioBaseDir ?? resolveDefaultBaseDir(),
      sampleRate,
      gain: chartWAVGain,
      fallbackToneSeconds:
        typeof options.missingSampleToneSeconds === 'number' &&
        Number.isFinite(options.missingSampleToneSeconds) &&
        options.missingSampleToneSeconds > 0
          ? options.missingSampleToneSeconds
          : 0,
      signal,
      base: idBase,
    });

    sampleMap.set(key, rendered);
    onProgress?.({
      loaded: index + 1,
      total: keys.length,
      sampleKey: key,
      samplePath: sourcePath,
    });
  }

  return sampleMap;
}

function buildEventPlaybackMap(resolved: ResolvedChart): Map<BeMusicEvent, PlayableNotePlayback> {
  const playbackMap = new Map<BeMusicEvent, PlayableNotePlayback>();
  for (const trigger of resolved.sampleTriggers) {
    playbackMap.set(trigger.event, {
      offsetSeconds: trigger.sampleOffsetSeconds,
      durationSeconds: trigger.sampleDurationSeconds,
      sliceId: trigger.sampleSliceId,
    });
  }
  return playbackMap;
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

function collectRealtimeAudioSampleKeys(resolved: ResolvedChart): string[] {
  const json = resolved.source;
  const keys = new Set<string>();
  for (const trigger of resolved.sampleTriggers) {
    keys.add(trigger.sampleKey);
  }
  // `#WAV00` sounds when a mine detonates: preload it when the chart has a mine on any lane, the extended 24 / 48 KEY
  // lanes (`DA`–`DO` / `EA`–`EO`) and bmson `mine_channels` included.
  if (
    typeof json.resources.wav[LANDMINE_EXPLOSION_SAMPLE_KEY] === 'string' &&
    json.resources.wav[LANDMINE_EXPLOSION_SAMPLE_KEY].length > 0 &&
    resolved.mines.length > 0
  ) {
    keys.add(LANDMINE_EXPLOSION_SAMPLE_KEY);
  }
  return [...keys];
}

function createSilentRenderResult(sampleRate: number): RenderResult {
  const safeSampleRate = Number.isFinite(sampleRate)
    ? Math.max(8_000, Math.floor(sampleRate))
    : RUNTIME_AUDIO_SAMPLE_RATE;
  const left = new Float32Array(0);
  const right = new Float32Array(0);
  return {
    sampleRate: safeSampleRate,
    left,
    right,
    durationSeconds: 0,
    peak: 0,
  };
}

function normalizeBGMVolume(value: number | undefined, masterVolume = 1): number {
  return normalizeBusVolume(value, masterVolume);
}

function normalizePlayVolume(value: number | undefined, masterVolume = 1): number {
  return normalizeBusVolume(value, masterVolume);
}

function normalizeMasterVolume(value: number | undefined): number {
  return normalizeBusVolume(value, 1);
}

function normalizeBusVolume(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, value) * fallback;
}

export function resolveBGMHeadroomGain(playableResult: RenderResult, bgmResult: RenderResult): number {
  const playableLeft = playableResult.left;
  const playableRight = playableResult.right;
  const bgmLeft = bgmResult.left;
  const bgmRight = bgmResult.right;
  const frameLength = Math.max(playableLeft.length, bgmLeft.length);
  let headroomGain = 1;

  // Keep playable/key-sound amplitude intact by shrinking only the BGM side when summed peak would clip.
  for (let frame = 0; frame < frameLength; frame += 1) {
    const playableLeftAbs = Math.abs(playableLeft[frame] ?? 0);
    const playableRightAbs = Math.abs(playableRight[frame] ?? 0);
    const bgmLeftAbs = Math.abs(bgmLeft[frame] ?? 0);
    const bgmRightAbs = Math.abs(bgmRight[frame] ?? 0);
    headroomGain = Math.min(
      headroomGain,
      resolveBGMHeadroomGainForChannel(playableLeftAbs, bgmLeftAbs),
      resolveBGMHeadroomGainForChannel(playableRightAbs, bgmRightAbs),
    );
  }

  return Math.max(0, Math.min(1, headroomGain));
}

function resolveBGMHeadroomGainForChannel(playableAbs: number, bgmAbs: number): number {
  if (bgmAbs <= 1e-9) {
    return 1;
  }
  const availableHeadroom = 1 - playableAbs;
  if (availableHeadroom <= 0) {
    // Play-side already clips by itself: do not force BGM to complete silence here.
    return 1;
  }
  return Math.min(1, availableHeadroom / bgmAbs);
}

function toPlaybackSampleRate(baseSampleRate: number, speed: number): number {
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const scaled = Math.round(baseSampleRate * safeSpeed);
  return Math.max(8_000, Math.min(192_000, scaled));
}

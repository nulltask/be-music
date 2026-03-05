import { basename } from 'node:path';
import readline from 'node:readline';
import { setImmediate as delayImmediate, setTimeout as delay } from 'node:timers/promises';
import { floatToInt16 } from '@be-music/utils';
import {
  collectLnobjEndEvents,
  createBeatResolver,
  mapBmsLongNoteChannelToPlayable,
  type BeMusicEvent,
  type BeMusicJson,
  isPlayableChannel,
  normalizeChannel,
  normalizeObjectKey,
} from '@be-music/json';
import { resolveBmsControlFlow } from '@be-music/parser';
import {
  type RenderResult,
  type RenderSampleLoadProgress,
  type TimedSampleTrigger,
  collectSampleTriggers,
  createTimingResolver,
  renderSingleSample,
  renderJson,
} from '@be-music/audio-renderer';
import { createBgaAnsiRenderer, type BgaAnsiRenderer } from '../bga.ts';
import { createPlayerStateSignals, type PlayerStateSignals } from '../player-state-signals.ts';
import { PlayerTui } from '../tui.ts';
import { findBestCandidate, findLaneSoundCandidate } from '../judging.ts';
import {
  appendFreeZoneInputChannels,
  beginKittyKeyboardProtocolOptIn,
  createInputTokenToChannelsMap,
  createLaneBindings,
  resolveLaneDisplayMode,
  resolveInputTokenEvent,
  type LaneBinding,
} from '../manual-input.ts';
import {
  extractTimedNotes,
  type TimedLandmineNote,
  type TimedPlayableNote,
} from '../playable-notes.ts';
import { formatSeconds, resolveAltModifierLabel, resolveChartVolWavGain } from '../player-utils.ts';
import { createNodeAudioSink, type AudioSink } from '../audio-sink.ts';
import {
  applyHighSpeedControlAction,
  resolveHighSpeedControlActionFromLaneChannels,
  resolveHighSpeedMultiplier,
  type HighSpeedControlAction,
} from './high-speed-control.ts';
import {
  IIDX_EX_SCORE_PER_PGREAT,
  IIDX_SCORE_MAX,
  applyJudgeToSummary,
  createScoreTracker,
} from './scoring.ts';
import { resolveJudgeWindowsMs } from './judge-window.ts';
import {
  createBeatAtSecondsResolver,
  createBpmTimeline,
  createMeasureBoundariesBeats,
  createMeasureTimeline,
  createScrollTimeline,
  createStopBeatWindows,
} from './timeline.ts';

export interface PlayerOptions {
  auto?: boolean;
  autoScratch?: boolean;
  inferBmsLnTypeWhenMissing?: boolean;
  showInvisibleNotes?: boolean;
  compressor?: boolean;
  compressorThresholdDb?: number;
  compressorRatio?: number;
  compressorAttackMs?: number;
  compressorReleaseMs?: number;
  compressorMakeupDb?: number;
  limiter?: boolean;
  limiterCeilingDb?: number;
  limiterReleaseMs?: number;
  speed?: number;
  highSpeed?: number;
  judgeWindowMs?: number;
  debugActiveAudio?: boolean;
  leadInMs?: number;
  audio?: boolean;
  bgmVolume?: number;
  playVolume?: number;
  audioBaseDir?: string;
  audioTailSeconds?: number;
  audioOffsetMs?: number;
  audioHeadPaddingMs?: number;
  audioLeadMs?: number;
  audioLeadMaxMs?: number;
  audioLeadStepUpMs?: number;
  audioLeadStepDownMs?: number;
  tui?: boolean;
  onLoadProgress?: (progress: PlayerLoadProgress) => void;
  onHighSpeedChange?: (highSpeed: number) => void;
  laneModeExtension?: string;
}

export interface PlayerSummary {
  total: number;
  perfect: number;
  fast: number;
  slow: number;
  great: number;
  good: number;
  bad: number;
  poor: number;
  exScore: number;
  score: number;
}

export interface PlayerLoadProgress {
  ratio: number;
  message: string;
  detail?: string;
}

export type PlayerInterruptReason = 'escape' | 'ctrl-c' | 'restart';

export class PlayerInterruptedError extends Error {
  readonly reason: PlayerInterruptReason;

  readonly exitCode: number;

  constructor(reason: PlayerInterruptReason) {
    super(`Player interrupted: ${reason}`);
    this.reason = reason;
    this.exitCode = reason === 'ctrl-c' ? 130 : 0;
  }
}

interface AudioSession {
  start: () => void;
  finish: () => Promise<void>;
  dispose: () => Promise<void>;
  chartStartDelayMs: number;
  backendLabel: string;
  pause: () => void;
  resume: () => void;
  getActiveAudioFiles?: () => string[];
  getActiveAudioVoiceCount?: () => number;
  triggerEvent?: (event: BeMusicEvent) => void;
  stopChannel?: (channel: string) => void;
}

export interface RandomPatternSelection {
  index: number;
  current: number;
  total: number;
}

interface ControlFlowResolutionResult {
  resolvedJson: BeMusicJson;
  randomPatterns: RandomPatternSelection[];
}

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

interface PlaybackClock {
  nowMs: () => number;
  isPaused: () => boolean;
  pause: () => boolean;
  resume: () => boolean;
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
const DEFAULT_LANE_WIDTH = 3;
const WIDE_SCRATCH_LANE_WIDTH = DEFAULT_LANE_WIDTH * 2;
const DEFAULT_GRID_ROWS = 14;
const MIN_GRID_ROWS = 4;
const STATIC_TUI_LINES = 15;
const BGA_LANE_GAP = 3;
const MIN_BGA_ASCII_WIDTH = 8;
const MIN_BGA_ASCII_HEIGHT = 6;
const DEFAULT_TERMINAL_COLUMNS = 120;
const TUI_FRAME_INTERVAL_MS = 1000 / 60;
const LONG_NOTE_INITIAL_HOLD_GRACE_MS = 380;
const LONG_NOTE_REPEAT_HOLD_GRACE_MS = 120;
const IIDX_BAD_WINDOW_MS = 250;
const PAUSE_POLL_INTERVAL_MS = 16;
const AUDIO_TARGET_LEAD_MAX_MS = 32;
const AUDIO_TARGET_LEAD_STEP_UP_MS = 1.5;
const AUDIO_TARGET_LEAD_STEP_DOWN_MS = 0.5;
const DEBUG_ACTIVE_AUDIO_FALLBACK_SECONDS = 0.18;
const DEBUG_ACTIVE_AUDIO_SAMPLE_RATE = 44_100;
const RUNTIME_AUDIO_SAMPLE_RATE = 44_100;
const REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS = 1e-6;
const DEFAULT_COMPRESSOR_THRESHOLD_DB = -12;
const DEFAULT_COMPRESSOR_RATIO = 2.5;
const DEFAULT_COMPRESSOR_ATTACK_MS = 8;
const DEFAULT_COMPRESSOR_RELEASE_MS = 120;
const DEFAULT_COMPRESSOR_MAKEUP_DB = 0;
const DEFAULT_LIMITER_CEILING_DB = -0.3;
const DEFAULT_LIMITER_RELEASE_MS = 80;

export { applyHighSpeedControlAction, resolveHighSpeedControlActionFromLaneChannels, type HighSpeedControlAction };
export { resolveJudgeWindowsMs };

export function applyFastSlowForJudge(
  summary: Pick<PlayerSummary, 'fast' | 'slow'>,
  judge: 'PERFECT' | 'GREAT' | 'GOOD',
  signedDeltaMs: number,
): void {
  if (judge !== 'GREAT' && judge !== 'GOOD') {
    return;
  }
  if (signedDeltaMs < 0) {
    summary.fast += 1;
  } else if (signedDeltaMs > 0) {
    summary.slow += 1;
  }
}

export { extractInvisiblePlayableNotes, extractLandmineNotes, extractPlayableNotes, extractTimedNotes } from '../playable-notes.ts';

function reportLoadProgress(options: PlayerOptions, ratio: number, message: string, detail?: string): void {
  const listener = options.onLoadProgress;
  if (!listener) {
    return;
  }
  const normalizedRatio = Math.max(0, Math.min(1, ratio));
  listener({
    ratio: normalizedRatio,
    message,
    detail,
  });
}

interface AudioSessionLoadProgress {
  ratio: number;
  message: string;
  detail?: string;
}

function formatSampleLoadDetail(progress: RenderSampleLoadProgress): string {
  if (typeof progress.resolvedPath === 'string' && progress.resolvedPath.length > 0) {
    return basename(progress.resolvedPath);
  }
  if (typeof progress.samplePath === 'string' && progress.samplePath.length > 0) {
    return progress.samplePath;
  }
  return `#WAV${progress.sampleKey}`;
}

export function resolveBmsControlFlowForPlayback(
  json: BeMusicJson,
  randomSource: () => number = Math.random,
): ControlFlowResolutionResult {
  const randomPatterns: RandomPatternSelection[] = [];
  const runtimeRandomSequence: number[] = [];

  for (const entry of json.bms.controlFlow) {
    if (entry.kind !== 'directive') {
      continue;
    }
    if (entry.command === 'RANDOM') {
      const total = parsePositiveInteger(entry.value) ?? 1;
      const randomValue = randomSource();
      runtimeRandomSequence.push(randomValue);
      randomPatterns.push({
        index: randomPatterns.length + 1,
        current: generateControlFlowRandomValue(total, randomValue),
        total,
      });
      continue;
    }
    if (entry.command === 'SETRANDOM') {
      const fixedValue = parsePositiveInteger(entry.value) ?? 1;
      randomPatterns.push({
        index: randomPatterns.length + 1,
        current: fixedValue,
        total: fixedValue,
      });
      continue;
    }
    if (entry.command === 'SWITCH') {
      runtimeRandomSequence.push(randomSource());
    }
  }

  let randomDrawIndex = 0;
  const resolvedJson = resolveBmsControlFlow(json, {
    random: () => {
      const replayValue = runtimeRandomSequence[randomDrawIndex];
      if (typeof replayValue === 'number') {
        randomDrawIndex += 1;
        return replayValue;
      }
      return randomSource();
    },
  });

  return {
    resolvedJson,
    randomPatterns,
  };
}

export function formatRandomPatternSummary(randomPatterns: ReadonlyArray<RandomPatternSelection>): string | undefined {
  if (randomPatterns.length === 0) {
    return undefined;
  }
  if (randomPatterns.length === 1) {
    const only = randomPatterns[0];
    return `RANDOM ${only.current}/${only.total}`;
  }
  const parts = randomPatterns.map((pattern) => `#${pattern.index} ${pattern.current}/${pattern.total}`);
  return `RANDOM ${parts.join('  ')}`;
}

function parsePositiveInteger(value?: string): number | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const normalized = Math.floor(parsed);
  if (normalized <= 0) {
    return undefined;
  }
  return normalized;
}

function generateControlFlowRandomValue(total: number, randomValue: number): number {
  const safeTotal = Math.max(1, Math.floor(total));
  if (safeTotal <= 1) {
    return 1;
  }
  const clamped = Number.isFinite(randomValue) ? Math.max(0, Math.min(0.999999999, randomValue)) : 0;
  return Math.floor(clamped * safeTotal) + 1;
}

export async function autoPlay(json: BeMusicJson, options: PlayerOptions = {}): Promise<PlayerSummary> {
  reportLoadProgress(options, 0.02, 'Resolving chart...');
  const controlFlowResolution = resolveBmsControlFlowForPlayback(json);
  const resolvedJson = controlFlowResolution.resolvedJson;
  const randomPatternSummary = formatRandomPatternSummary(controlFlowResolution.randomPatterns);
  const inferBmsLnTypeWhenMissing = options.inferBmsLnTypeWhenMissing === true;
  const speed = options.speed ?? 1;
  const leadInMs = options.leadInMs ?? 1500;
  const audioOffsetMs = options.audioOffsetMs ?? 0;
  const beatAtSeconds = createBeatAtSecondsResolver(resolvedJson);
  const realtimeAudioTriggers = collectRealtimeAudioTriggers(resolvedJson, inferBmsLnTypeWhenMissing);
  const realtimeAudioEndSeconds = options.audio === false ? 0 : (realtimeAudioTriggers.at(-1)?.seconds ?? 0);

  const extractedNotes = extractTimedNotes(resolvedJson, {
    includeLandmine: true,
    includeInvisible: options.showInvisibleNotes === true,
    inferBmsLnTypeWhenMissing,
  });
  const notes = extractedNotes.playableNotes;
  const landmineNotes = extractedNotes.landmineNotes;
  const invisibleNotes = extractedNotes.invisibleNotes;
  const renderNotes = mergeRenderNotesBySeconds(notes, landmineNotes, invisibleNotes);
  const totalSeconds = Math.max(
    notes.at(-1)?.seconds ?? 0,
    landmineNotes.at(-1)?.seconds ?? 0,
    invisibleNotes.at(-1)?.seconds ?? 0,
    realtimeAudioEndSeconds,
  );
  const channels = collectUniqueNoteChannels(notes, landmineNotes, invisibleNotes);
  const laneModeOptions = { player: resolvedJson.bms.player, chartExtension: options.laneModeExtension };
  const laneBindings = createLaneBindings(channels, laneModeOptions);
  const inputTokenToChannels = createInputTokenToChannelsMap(laneBindings);
  appendFreeZoneInputChannels(inputTokenToChannels, laneBindings, channels);
  const laneDisplayMode = resolveLaneDisplayMode(channels, laneModeOptions);
  const activeFreeZoneChannels = resolveActiveFreeZoneChannels(channels, laneBindings);
  const scorableNotes = notes.filter((note) => !isActiveFreeZoneChannel(note.channel, activeFreeZoneChannels));
  const keyMap = new Map(laneBindings.map((binding) => [binding.channel, binding.keyLabel]));
  const summary: PlayerSummary = {
    total: scorableNotes.length,
    perfect: 0,
    fast: 0,
    slow: 0,
    great: 0,
    good: 0,
    bad: 0,
    poor: 0,
    exScore: 0,
    score: 0,
  };
  const scoreTracker = createScoreTracker();
  let combo = 0;
  let interruptedReason: PlayerInterruptReason | undefined;
  let highSpeed = resolveHighSpeedMultiplier(options.highSpeed);
  const stateSignals = createPlayerStateSignals(highSpeed);

  reportLoadProgress(options, 0.18, 'Preparing BGA...');
  const tui = createTuiIfEnabled(
    resolvedJson,
    options,
    'AUTO',
    laneBindings,
    laneDisplayMode,
    speed,
    0,
    randomPatternSummary,
    stateSignals,
  );
  const activeStateSignals = tui ? stateSignals : undefined;
  const bgaDisplay = estimateBgaAnsiDisplaySize(laneBindings);
  const bgaRenderer = tui
    ? await createBgaAnsiRenderer(resolvedJson, {
        baseDir: options.audioBaseDir ?? process.cwd(),
        width: bgaDisplay.width,
        height: bgaDisplay.height,
        onLoadProgress: (progress) => {
          reportLoadProgress(options, 0.18 + progress.ratio * 0.12, 'Preparing BGA...', progress.detail);
        },
      })
    : undefined;
  const detachBgaResizeHandler = attachBgaResizeHandler(tui, bgaRenderer, laneBindings);
  reportLoadProgress(options, 0.3, 'Preparing audio...');
  const audioSession = await createAudioSessionIfEnabled(resolvedJson, options, 'auto', (progress) => {
    reportLoadProgress(options, 0.3 + progress.ratio * 0.68, progress.message, progress.detail);
  });
  const audioBackendLabel = resolveAudioBackendLabel(options, audioSession);
  reportLoadProgress(options, 1, 'Ready');
  const autoDebugAudioEstimator = options.debugActiveAudio
    ? await createDebugActiveAudioEstimator(resolvedJson, {
        baseDir: options.audioBaseDir,
        inferBmsLnTypeWhenMissing,
      })
    : undefined;
  const resolveDebugActiveAudioState = (
    nowSeconds: number,
  ): { activeAudioFiles?: string[]; activeAudioVoiceCount?: number } => {
    if (options.debugActiveAudio !== true) {
      return {};
    }
    const sessionVoiceCount = audioSession?.getActiveAudioVoiceCount?.() ?? 0;
    const sessionFiles = audioSession?.getActiveAudioFiles?.() ?? [];
    if (sessionVoiceCount > 0 || sessionFiles.length > 0) {
      return {
        activeAudioFiles: sessionFiles,
        activeAudioVoiceCount: sessionVoiceCount,
      };
    }
    const estimated = autoDebugAudioEstimator?.resolve(nowSeconds);
    return {
      activeAudioFiles: estimated?.activeAudioFiles ?? [],
      activeAudioVoiceCount: estimated?.activeAudioVoiceCount ?? 0,
    };
  };
  const highSpeedModifierLabel = resolveAltModifierLabel();

  if (!tui) {
    process.stdout.write('Auto play start\n');
    process.stdout.write(`Lane mode: ${laneDisplayMode}\n`);
    if (randomPatternSummary) {
      process.stdout.write(`${randomPatternSummary}\n`);
    }
    printLaneMap(laneBindings);
    process.stdout.write('Press Space to pause/resume. Press Shift+R to restart.\n');
    process.stdout.write('Press Ctrl+C or Esc to quit.\n');
    process.stdout.write(`Press ${highSpeedModifierLabel}+odd lane key to decrease HIGH-SPEED.\n`);
    process.stdout.write(`Press ${highSpeedModifierLabel}+even lane key to increase HIGH-SPEED.\n`);
  } else {
    tui.start();
    activeStateSignals?.publishJudgeCombo('READY', 0);
    tui.render({
      currentBeat: 0,
      currentSeconds: 0,
      totalSeconds,
      summary,
      notes: renderNotes,
      audioBackend: audioBackendLabel,
      ...resolveDebugActiveAudioState(0),
      ...createBgaRenderFrame(bgaRenderer, 0),
    });
  }

  const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean };
  const wasRawMode = Boolean(stdin.isRaw);
  const canCaptureInput = process.stdin.isTTY;
  let inputCaptureStopped = false;
  let playbackClock: PlaybackClock | undefined;
  let realtimeAudioTriggerIndex = 0;

  const stopInputCapture = (): void => {
    if (!canCaptureInput || inputCaptureStopped) {
      return;
    }
    inputCaptureStopped = true;
    process.stdin.removeListener('keypress', onKeyPress);
    process.stdin.setRawMode(wasRawMode);
  };

  const togglePause = (): void => {
    if (!playbackClock) {
      return;
    }
    if (playbackClock.isPaused()) {
      if (!playbackClock.resume()) {
        return;
      }
      audioSession?.resume();
      activeStateSignals?.setPaused(false);
      if (!tui) {
        process.stdout.write('RESUME\n');
      }
      return;
    }

    if (!playbackClock.pause()) {
      return;
    }
    audioSession?.pause();
    activeStateSignals?.setPaused(true);
    if (!tui) {
      process.stdout.write('PAUSE\n');
    }
  };

  const onKeyPress = (_chunk: string, key: readline.Key): void => {
    if (interruptedReason) {
      return;
    }
    if (key.sequence === '\u0003') {
      interruptedReason = 'ctrl-c';
      stopInputCapture();
      return;
    }
    if (key.name?.toLowerCase() === 'escape' || key.sequence === '\u001b') {
      interruptedReason = 'escape';
      stopInputCapture();
      return;
    }
    if (isRestartKeyPress(_chunk, key)) {
      interruptedReason = 'restart';
      stopInputCapture();
      return;
    }
    const inputEvent = resolveInputTokenEvent(_chunk ?? '', key);
    const highSpeedAction = resolveHighSpeedControlActionFromAltLaneTokens(
      inputEvent.tokens,
      inputTokenToChannels,
      key,
    );
    if (highSpeedAction) {
      const nextHighSpeed = applyHighSpeedControlAction(highSpeed, highSpeedAction);
      if (nextHighSpeed !== highSpeed) {
        highSpeed = nextHighSpeed;
        activeStateSignals?.setHighSpeed(highSpeed);
        options.onHighSpeedChange?.(highSpeed);
      }
      if (!tui) {
        process.stdout.write(`HIGH-SPEED x${highSpeed.toFixed(1)}\n`);
      }
      return;
    }
    if (isSpaceKey(key)) {
      togglePause();
    }
  };

  const triggerRealtimeAudioEvents = (referenceSeconds: number): void => {
    const triggerEvent = audioSession?.triggerEvent;
    if (!triggerEvent) {
      return;
    }
    const safeReferenceSeconds = Math.max(0, referenceSeconds) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
    while (realtimeAudioTriggerIndex < realtimeAudioTriggers.length) {
      const trigger = realtimeAudioTriggers[realtimeAudioTriggerIndex]!;
      if (trigger.seconds > safeReferenceSeconds) {
        break;
      }
      triggerEvent(trigger.event);
      realtimeAudioTriggerIndex += 1;
    }
  };

  if (canCaptureInput) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', onKeyPress);
  }

  try {
    await delay(leadInMs);
    if (!interruptedReason) {
      audioSession?.start();

      const chartClock = createPlaybackClock(
        performance.now() + audioOffsetMs + (audioSession?.chartStartDelayMs ?? 0),
      );
      playbackClock = chartClock;
      const badWindowSeconds = IIDX_BAD_WINDOW_MS / 1000;
      let landmineExpireCursor = 0;
      let invisibleExpireCursor = 0;

      const markExpiredLandmines = (referenceSeconds: number): void => {
        while (landmineExpireCursor < landmineNotes.length) {
          const landmine = landmineNotes[landmineExpireCursor]!;
          if (landmine.judged) {
            landmineExpireCursor += 1;
            continue;
          }
          if (referenceSeconds - landmine.seconds <= badWindowSeconds) {
            break;
          }
          landmine.judged = true;
          landmineExpireCursor += 1;
        }
      };
      const markExpiredInvisibleNotes = (referenceSeconds: number): void => {
        while (invisibleExpireCursor < invisibleNotes.length) {
          const invisible = invisibleNotes[invisibleExpireCursor]!;
          if (invisible.judged) {
            invisibleExpireCursor += 1;
            continue;
          }
          if (referenceSeconds - invisible.seconds <= badWindowSeconds) {
            break;
          }
          invisible.judged = true;
          invisibleExpireCursor += 1;
        }
      };

      const renderUntil = async (targetMs: number): Promise<void> => {
        while (true) {
          if (interruptedReason) {
            return;
          }
          const nowMs = chartClock.nowMs();
          if (nowMs >= targetMs) {
            return;
          }
          if (chartClock.isPaused()) {
            await waitPrecise(PAUSE_POLL_INTERVAL_MS);
            continue;
          }
          const nowSec = elapsedMsToGameSeconds(nowMs, speed);
          triggerRealtimeAudioEvents(nowSec);
          markExpiredLandmines(nowSec);
          markExpiredInvisibleNotes(nowSec);
          const nowBeat = beatAtSeconds(nowSec);
          tui?.render({
            currentBeat: nowBeat,
            currentSeconds: nowSec,
            totalSeconds,
            summary,
            notes: renderNotes,
            audioBackend: audioBackendLabel,
            ...resolveDebugActiveAudioState(nowSec),
            ...createBgaRenderFrame(bgaRenderer, nowSec),
          });
          await waitPrecise(Math.max(1, Math.min(TUI_FRAME_INTERVAL_MS, targetMs - nowMs)));
        }
      };

      for (const note of scorableNotes) {
        if (interruptedReason) {
          break;
        }
        const scheduledMs = (note.seconds * 1000) / speed;
        await renderUntil(scheduledMs);
        if (interruptedReason) {
          break;
        }

        note.judged = true;
        applyJudgeToSummary(summary, 'PERFECT', scoreTracker);
        combo += 1;

        const key = resolveNoteKeyLabel(note.channel, keyMap);
        if (!tui) {
          process.stdout.write(`AUTO ${formatSeconds(note.seconds)} channel:${note.channel} key:${key}\n`);
        } else {
          tui.flashLane(note.channel);
          if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
            note.visibleUntilBeat = note.endBeat;
            tui.holdLaneUntilBeat(note.channel, note.endBeat);
          }
          activeStateSignals?.publishJudgeCombo('PERFECT', combo, note.channel);
          tui.render({
            currentBeat: note.beat,
            currentSeconds: note.seconds,
            totalSeconds,
            summary,
            notes: renderNotes,
            audioBackend: audioBackendLabel,
            ...resolveDebugActiveAudioState(note.seconds),
            ...createBgaRenderFrame(bgaRenderer, note.seconds),
          });
        }

        markExpiredLandmines(note.seconds);
        markExpiredInvisibleNotes(note.seconds);
      }

      if (!interruptedReason) {
        const totalScheduledMs = (totalSeconds * 1000) / speed;
        await renderUntil(totalScheduledMs);
        markExpiredLandmines(totalSeconds + badWindowSeconds);
        markExpiredInvisibleNotes(totalSeconds + badWindowSeconds);
        for (const landmine of landmineNotes) {
          landmine.judged = true;
        }
        for (const invisible of invisibleNotes) {
          invisible.judged = true;
        }
        tui?.render({
          currentBeat: beatAtSeconds(totalSeconds),
          currentSeconds: totalSeconds,
          totalSeconds,
          summary,
          notes: renderNotes,
          audioBackend: audioBackendLabel,
          ...resolveDebugActiveAudioState(totalSeconds),
          ...createBgaRenderFrame(bgaRenderer, totalSeconds),
        });
      }
    }
  } finally {
    detachBgaResizeHandler();
    if (interruptedReason) {
      await disposeAudioSessionSafely(audioSession);
    } else {
      await finalizeAudioSessionSafely(audioSession);
    }
    stopInputCapture();
    tui?.stop();
  }

  if (interruptedReason === 'ctrl-c') {
    throw new PlayerInterruptedError(interruptedReason);
  }
  if (interruptedReason === 'restart') {
    throw new PlayerInterruptedError(interruptedReason);
  }

  process.stdout.write(renderSummary(summary));
  return summary;
}

export async function manualPlay(json: BeMusicJson, options: PlayerOptions = {}): Promise<PlayerSummary> {
  reportLoadProgress(options, 0.02, 'Resolving chart...');
  const controlFlowResolution = resolveBmsControlFlowForPlayback(json);
  const resolvedJson = controlFlowResolution.resolvedJson;
  const randomPatternSummary = formatRandomPatternSummary(controlFlowResolution.randomPatterns);
  const inferBmsLnTypeWhenMissing = options.inferBmsLnTypeWhenMissing === true;
  const autoScratchEnabled = options.autoScratch === true;
  const speed = options.speed ?? 1;
  const judgeWindows = resolveJudgeWindowsMs(resolvedJson, options.judgeWindowMs);
  const badWindowMs = judgeWindows.bad;
  const leadInMs = options.leadInMs ?? 1500;
  const audioOffsetMs = options.audioOffsetMs ?? 0;
  const beatAtSeconds = createBeatAtSecondsResolver(resolvedJson);
  const nonPlayableRealtimeAudioTriggers = collectRealtimeAudioTriggers(
    resolvedJson,
    inferBmsLnTypeWhenMissing,
    (channel) => !isPlayLaneChannelForVolumeControl(channel),
  );
  const nonPlayableRealtimeAudioEndSeconds =
    options.audio === false ? 0 : (nonPlayableRealtimeAudioTriggers.at(-1)?.seconds ?? 0);

  const extractedNotes = extractTimedNotes(resolvedJson, {
    includeLandmine: true,
    includeInvisible: options.showInvisibleNotes === true,
    inferBmsLnTypeWhenMissing,
  });
  const notes = extractedNotes.playableNotes;
  const landmineNotes = extractedNotes.landmineNotes;
  const invisibleNotes = extractedNotes.invisibleNotes;
  const renderNotes = mergeRenderNotesBySeconds(notes, landmineNotes, invisibleNotes);
  const totalSeconds = Math.max(
    notes.at(-1)?.seconds ?? 0,
    landmineNotes.at(-1)?.seconds ?? 0,
    invisibleNotes.at(-1)?.seconds ?? 0,
    nonPlayableRealtimeAudioEndSeconds,
  );
  const channels = collectUniqueNoteChannels(notes, landmineNotes, invisibleNotes);
  const laneModeOptions = { player: resolvedJson.bms.player, chartExtension: options.laneModeExtension };
  const laneBindings = createLaneBindings(channels, laneModeOptions);
  const laneDisplayMode = resolveLaneDisplayMode(channels, laneModeOptions);
  const activeFreeZoneChannels = resolveActiveFreeZoneChannels(channels, laneBindings);
  const scorableNotes = notes.filter((note) => !isActiveFreeZoneChannel(note.channel, activeFreeZoneChannels));
  const scratchPlayableChannels = new Set(
    laneBindings.filter((binding) => binding.isScratch).map((binding) => binding.channel),
  );
  const inputTokenToChannels = createInputTokenToChannelsMap(laneBindings);
  appendFreeZoneInputChannels(inputTokenToChannels, laneBindings, channels);

  const summary: PlayerSummary = {
    total: scorableNotes.length,
    perfect: 0,
    fast: 0,
    slow: 0,
    great: 0,
    good: 0,
    bad: 0,
    poor: 0,
    exScore: 0,
    score: 0,
  };
  const scoreTracker = createScoreTracker();
  let combo = 0;
  let highSpeed = resolveHighSpeedMultiplier(options.highSpeed);
  const stateSignals = createPlayerStateSignals(highSpeed);

  reportLoadProgress(options, 0.18, 'Preparing BGA...');
  const tui = createTuiIfEnabled(
    resolvedJson,
    options,
    autoScratchEnabled ? 'AUTO SCRATCH' : 'MANUAL',
    laneBindings,
    laneDisplayMode,
    speed,
    badWindowMs,
    randomPatternSummary,
    stateSignals,
  );
  const activeStateSignals = tui ? stateSignals : undefined;
  const bgaDisplay = estimateBgaAnsiDisplaySize(laneBindings);
  const bgaRenderer = tui
    ? await createBgaAnsiRenderer(resolvedJson, {
        baseDir: options.audioBaseDir ?? process.cwd(),
        width: bgaDisplay.width,
        height: bgaDisplay.height,
        onLoadProgress: (progress) => {
          reportLoadProgress(options, 0.18 + progress.ratio * 0.12, 'Preparing BGA...', progress.detail);
        },
      })
    : undefined;
  const triggerPoorBga = (seconds: number): void => {
    bgaRenderer?.triggerPoor(seconds);
  };
  const clearPoorBga = (): void => {
    bgaRenderer?.clearPoor();
  };
  const detachBgaResizeHandler = attachBgaResizeHandler(tui, bgaRenderer, laneBindings);
  reportLoadProgress(options, 0.3, 'Preparing audio...');
  const audioSession = await createAudioSessionIfEnabled(resolvedJson, options, 'manual', (progress) => {
    reportLoadProgress(options, 0.3 + progress.ratio * 0.68, progress.message, progress.detail);
  });
  const audioBackendLabel = resolveAudioBackendLabel(options, audioSession);
  reportLoadProgress(options, 1, 'Ready');
  const resolveDebugActiveAudioState = (): { activeAudioFiles?: string[]; activeAudioVoiceCount?: number } => {
    if (options.debugActiveAudio !== true) {
      return {};
    }
    return {
      activeAudioFiles: audioSession?.getActiveAudioFiles?.() ?? [],
      activeAudioVoiceCount: audioSession?.getActiveAudioVoiceCount?.() ?? 0,
    };
  };
  const highSpeedModifierLabel = resolveAltModifierLabel();

  if (!tui) {
    process.stdout.write('Manual play start\n');
    process.stdout.write(`Lane mode: ${laneDisplayMode}\n`);
    if (randomPatternSummary) {
      process.stdout.write(`${randomPatternSummary}\n`);
    }
    if (autoScratchEnabled) {
      process.stdout.write('Mode: AUTO SCRATCH (16ch/26ch only)\n');
    }
    process.stdout.write(
      `Judge window: PGREAT<=${judgeWindows.pgreat.toFixed(2)}ms GREAT<=${judgeWindows.great.toFixed(2)}ms GOOD<=${judgeWindows.good.toFixed(2)}ms BAD<=${Math.round(badWindowMs)}ms\n`,
    );
    process.stdout.write('Press Space to pause/resume.\n');
    process.stdout.write('Press Shift+R to restart.\n');
    process.stdout.write(`Press ${highSpeedModifierLabel}+odd lane key to decrease HIGH-SPEED.\n`);
    process.stdout.write(`Press ${highSpeedModifierLabel}+even lane key to increase HIGH-SPEED.\n`);
    process.stdout.write('Press Ctrl+C to quit.\n');
    process.stdout.write('Press Esc to stop and open result.\n');
    printLaneMap(laneBindings);
  } else {
    tui.start();
    activeStateSignals?.publishJudgeCombo('READY', 0);
    tui.render({
      currentBeat: 0,
      currentSeconds: 0,
      totalSeconds,
      summary,
      notes: renderNotes,
      audioBackend: audioBackendLabel,
      ...resolveDebugActiveAudioState(),
      ...createBgaRenderFrame(bgaRenderer, 0),
    });
  }

  await delay(leadInMs);

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  const stopKittyKeyboardProtocol = beginKittyKeyboardProtocolOptIn();

  audioSession?.start();

  const playbackClock = createPlaybackClock(performance.now() + audioOffsetMs + (audioSession?.chartStartDelayMs ?? 0));
  const horizon = (totalSeconds * 1000) / speed + leadInMs + badWindowMs + 1000;
  let interruptedReason: PlayerInterruptReason | undefined;
  const longHoldUntilMsByChannel = new Map<string, number>();
  const activeLongNotesByChannel = new Map<string, { endSeconds: number; note: TimedPlayableNote }>();
  const longNoteSuppressUntilSecondsByChannel = new Map<string, number>();
  const activeKittyPressedChannels = new Set<string>();
  let inputCaptureStopped = false;
  let suppressLegacyKeypressUntilMs = 0;
  const badWindowSeconds = badWindowMs / 1000;
  const autoScratchNotes = autoScratchEnabled
    ? scorableNotes.filter((note) => scratchPlayableChannels.has(note.channel))
    : [];
  let autoScratchCursor = 0;
  let scorableMissCursor = 0;
  let landmineExpireCursor = 0;
  let invisibleExpireCursor = 0;
  let remainingScorableNotes = scorableNotes.length;
  let remainingLandmineNotes = landmineNotes.length;
  let remainingInvisibleNotes = invisibleNotes.length;
  let nonPlayableRealtimeAudioTriggerIndex = 0;

  const markScorableJudged = (note: TimedPlayableNote): boolean => {
    if (note.judged) {
      return false;
    }
    note.judged = true;
    remainingScorableNotes -= 1;
    return true;
  };

  const markLandmineJudged = (note: TimedLandmineNote): boolean => {
    if (note.judged) {
      return false;
    }
    note.judged = true;
    remainingLandmineNotes -= 1;
    return true;
  };

  const markInvisibleJudged = (note: TimedPlayableNote): boolean => {
    if (note.judged) {
      return false;
    }
    note.judged = true;
    remainingInvisibleNotes -= 1;
    return true;
  };

  const markExpiredLandmines = (referenceSeconds: number): void => {
    while (landmineExpireCursor < landmineNotes.length) {
      const landmine = landmineNotes[landmineExpireCursor]!;
      if (landmine.judged) {
        landmineExpireCursor += 1;
        continue;
      }
      if (referenceSeconds - landmine.seconds <= badWindowSeconds) {
        break;
      }
      markLandmineJudged(landmine);
      landmineExpireCursor += 1;
    }
  };

  const markExpiredInvisibleNotes = (referenceSeconds: number): void => {
    while (invisibleExpireCursor < invisibleNotes.length) {
      const invisible = invisibleNotes[invisibleExpireCursor]!;
      if (invisible.judged) {
        invisibleExpireCursor += 1;
        continue;
      }
      if (referenceSeconds - invisible.seconds <= badWindowSeconds) {
        break;
      }
      markInvisibleJudged(invisible);
      invisibleExpireCursor += 1;
    }
  };

  const applyAutoScratchJudgements = (referenceSeconds: number): void => {
    if (!autoScratchEnabled) {
      return;
    }
    while (autoScratchCursor < autoScratchNotes.length) {
      const note = autoScratchNotes[autoScratchCursor]!;
      if (note.judged) {
        autoScratchCursor += 1;
        continue;
      }
      if (referenceSeconds < note.seconds) {
        break;
      }
      autoScratchCursor += 1;
      if (!markScorableJudged(note)) {
        continue;
      }
      applyJudgeToSummary(summary, 'PERFECT', scoreTracker);
      clearPoorBga();
      combo += 1;
      audioSession?.triggerEvent?.(note.event);
      tui?.flashLane(note.channel);
      if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
        note.visibleUntilBeat = note.endBeat;
        tui?.holdLaneUntilBeat(note.channel, note.endBeat);
      }
      activeStateSignals?.publishJudgeCombo('PERFECT', combo, note.channel);
    }
  };

  const applyExpiredScorableJudgements = (referenceSeconds: number): void => {
    while (scorableMissCursor < scorableNotes.length) {
      const note = scorableNotes[scorableMissCursor]!;
      if (note.judged) {
        scorableMissCursor += 1;
        continue;
      }
      if (referenceSeconds - note.seconds <= badWindowSeconds) {
        break;
      }
      scorableMissCursor += 1;
      if (!markScorableJudged(note)) {
        continue;
      }
      if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
        note.visibleUntilBeat = note.endBeat;
      }
      applyJudgeToSummary(summary, 'POOR', scoreTracker);
      triggerPoorBga(referenceSeconds);
      combo = 0;
      activeStateSignals?.publishJudgeCombo('POOR', combo, note.channel);
    }
  };

  const applyManualTimingJudge = (channel: string, signedDeltaMs: number, atSeconds: number): void => {
    const deltaMs = Math.abs(signedDeltaMs);
    if (deltaMs <= judgeWindows.pgreat) {
      applyJudgeToSummary(summary, 'PERFECT', scoreTracker);
      applyFastSlowForJudge(summary, 'PERFECT', signedDeltaMs);
      clearPoorBga();
      combo += 1;
      if (!tui) {
        process.stdout.write(`PERFECT channel:${channel} delta:${Math.round(deltaMs)}ms\n`);
      } else {
        activeStateSignals?.publishJudgeCombo('PERFECT', combo, channel);
      }
      return;
    }
    if (deltaMs <= judgeWindows.great) {
      applyJudgeToSummary(summary, 'GREAT', scoreTracker);
      applyFastSlowForJudge(summary, 'GREAT', signedDeltaMs);
      clearPoorBga();
      combo += 1;
      if (!tui) {
        process.stdout.write(`GREAT channel:${channel} delta:${Math.round(deltaMs)}ms\n`);
      } else {
        activeStateSignals?.publishJudgeCombo('GREAT', combo, channel);
      }
      return;
    }
    if (deltaMs <= judgeWindows.good) {
      applyJudgeToSummary(summary, 'GOOD', scoreTracker);
      applyFastSlowForJudge(summary, 'GOOD', signedDeltaMs);
      clearPoorBga();
      combo += 1;
      if (!tui) {
        process.stdout.write(`GOOD channel:${channel} delta:${Math.round(deltaMs)}ms\n`);
      } else {
        activeStateSignals?.publishJudgeCombo('GOOD', combo, channel);
      }
      return;
    }
    if (deltaMs <= badWindowMs) {
      applyJudgeToSummary(summary, 'BAD', scoreTracker);
      combo = 0;
      if (!tui) {
        process.stdout.write(`BAD channel:${channel} delta:${Math.round(deltaMs)}ms\n`);
      } else {
        activeStateSignals?.publishJudgeCombo('BAD', combo, channel);
      }
      return;
    }

    applyJudgeToSummary(summary, 'POOR', scoreTracker);
    triggerPoorBga(atSeconds);
    combo = 0;
    if (!tui) {
      process.stdout.write(`POOR channel:${channel} delta:${Math.round(deltaMs)}ms\n`);
    } else {
      activeStateSignals?.publishJudgeCombo('POOR', combo, channel);
    }
  };

  const triggerNonPlayableRealtimeAudioEvents = (referenceSeconds: number): void => {
    const triggerEvent = audioSession?.triggerEvent;
    if (!triggerEvent) {
      return;
    }
    const safeReferenceSeconds = Math.max(0, referenceSeconds) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
    while (nonPlayableRealtimeAudioTriggerIndex < nonPlayableRealtimeAudioTriggers.length) {
      const trigger = nonPlayableRealtimeAudioTriggers[nonPlayableRealtimeAudioTriggerIndex]!;
      if (trigger.seconds > safeReferenceSeconds) {
        break;
      }
      triggerEvent(trigger.event);
      nonPlayableRealtimeAudioTriggerIndex += 1;
    }
  };

  const stopInputCapture = () => {
    if (inputCaptureStopped) {
      return;
    }
    inputCaptureStopped = true;
    for (const channel of activeKittyPressedChannels) {
      tui?.releaseLane(channel);
    }
    activeKittyPressedChannels.clear();
    process.stdin.removeListener('keypress', onKeyPress);
    process.stdin.removeListener('data', onRawInputData);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    stopKittyKeyboardProtocol();
  };

  const candidateChannelsBuffer = new Set<string>();
  const collectMappedInputChannels = (tokens: readonly string[]): void => {
    for (const token of tokens) {
      const mapped = inputTokenToChannels.get(token);
      if (!mapped) {
        continue;
      }
      mapped.forEach((channel) => candidateChannelsBuffer.add(channel));
    }
  };
  const resolveMappedInputChannels = (
    tokens: readonly string[],
    additionalTokens?: readonly string[],
  ): ReadonlySet<string> => {
    candidateChannelsBuffer.clear();
    collectMappedInputChannels(tokens);
    if (additionalTokens && additionalTokens.length > 0) {
      collectMappedInputChannels(additionalTokens);
    }
    if (autoScratchEnabled) {
      for (const channel of candidateChannelsBuffer) {
        if (scratchPlayableChannels.has(channel)) {
          candidateChannelsBuffer.delete(channel);
        }
      }
    }
    return candidateChannelsBuffer;
  };

  const handleMappedInputTokens = (tokens: readonly string[]): void => {
    const candidateChannels = resolveMappedInputChannels(tokens);
    if (candidateChannels.size === 0) {
      return;
    }

    if (tui) {
      for (const mappedChannel of candidateChannels) {
        tui.flashLane(mappedChannel);
      }
    }

    const nowMs = playbackClock.nowMs();
    const nowSec = elapsedMsToGameSeconds(nowMs, speed);

    let refreshedHold = false;
    for (const channel of candidateChannels) {
      if (!activeLongNotesByChannel.has(channel)) {
        continue;
      }
      longHoldUntilMsByChannel.set(channel, nowMs + LONG_NOTE_REPEAT_HOLD_GRACE_MS);
      refreshedHold = true;
    }

    const candidate = findBestCandidate(scorableNotes, candidateChannels, nowSec, badWindowSeconds);
    const landmineCandidate = findBestCandidate(landmineNotes, candidateChannels, nowSec, badWindowSeconds);
    const candidateDelta = candidate ? Math.abs(candidate.seconds - nowSec) : Number.POSITIVE_INFINITY;
    const landmineDelta = landmineCandidate ? Math.abs(landmineCandidate.seconds - nowSec) : Number.POSITIVE_INFINITY;

    if (landmineCandidate && landmineDelta <= candidateDelta) {
      if (!markLandmineJudged(landmineCandidate)) {
        return;
      }
      applyJudgeToSummary(summary, 'BAD', scoreTracker);
      combo = 0;
      if (!tui) {
        process.stdout.write(`MINE channel:${landmineCandidate.channel} delta:${Math.round(landmineDelta * 1000)}ms\n`);
      } else {
        activeStateSignals?.publishJudgeCombo('BAD', combo, landmineCandidate.channel);
      }
      return;
    }

    if (!candidate) {
      if (refreshedHold) {
        return;
      }
      const fallback = findLaneSoundCandidate(notes, candidateChannels, nowSec);
      if (fallback) {
        const suppressUntil = longNoteSuppressUntilSecondsByChannel.get(fallback.channel);
        const shouldSuppressFallback = suppressUntil !== undefined && nowSec < suppressUntil;
        if (!shouldSuppressFallback) {
          audioSession?.triggerEvent?.(fallback.event);
          if (isActiveFreeZoneChannel(fallback.channel, activeFreeZoneChannels)) {
            return;
          }
        } else {
          return;
        }
      }
      if (!tui) {
        process.stdout.write(`POOR-KEY ${tokens[0] ?? '?'}\n`);
      }
      return;
    }

    if (!markScorableJudged(candidate)) {
      return;
    }
    const channel = candidate.channel;
    tui?.flashLane(channel);
    audioSession?.triggerEvent?.(candidate.event);
    const endSeconds = candidate.endSeconds;
    if (typeof endSeconds === 'number' && Number.isFinite(endSeconds) && endSeconds > candidate.seconds) {
      activeLongNotesByChannel.set(channel, { endSeconds, note: candidate });
      longHoldUntilMsByChannel.set(channel, nowMs + LONG_NOTE_INITIAL_HOLD_GRACE_MS);
      const previousSuppressUntil = longNoteSuppressUntilSecondsByChannel.get(channel) ?? Number.NEGATIVE_INFINITY;
      if (endSeconds > previousSuppressUntil) {
        longNoteSuppressUntilSecondsByChannel.set(channel, endSeconds);
      }
      candidate.visibleUntilBeat = candidate.endBeat;
      return;
    } else {
      activeLongNotesByChannel.delete(channel);
      longHoldUntilMsByChannel.delete(channel);
    }

    const signedDeltaMs = (nowSec - candidate.seconds) * 1000;
    applyManualTimingJudge(channel, signedDeltaMs, nowSec);
  };

  const applyHighSpeedAction = (action: HighSpeedControlAction | undefined): boolean => {
    if (!action) {
      return false;
    }
    const nextHighSpeed = applyHighSpeedControlAction(highSpeed, action);
    if (nextHighSpeed !== highSpeed) {
      highSpeed = nextHighSpeed;
      activeStateSignals?.setHighSpeed(highSpeed);
      options.onHighSpeedChange?.(highSpeed);
    }
    if (!tui) {
      process.stdout.write(`HIGH-SPEED x${highSpeed.toFixed(1)}\n`);
    }
    return true;
  };

  const togglePause = (): void => {
    if (playbackClock.isPaused()) {
      if (!playbackClock.resume()) {
        return;
      }
      audioSession?.resume();
      activeStateSignals?.setPaused(false);
      if (!tui) {
        process.stdout.write('RESUME\n');
      }
      return;
    }
    if (!playbackClock.pause()) {
      return;
    }
    audioSession?.pause();
    activeStateSignals?.setPaused(true);
    if (!tui) {
      process.stdout.write('PAUSE\n');
    }
  };

  const onKeyPress = (chunk: string | undefined, key: readline.Key): void => {
    if (interruptedReason) {
      return;
    }
    if (Date.now() < suppressLegacyKeypressUntilMs) {
      return;
    }
    const inputEvent = resolveInputTokenEvent(chunk ?? '', key);
    if (inputEvent.kittyProtocolEvent) {
      return;
    }
    const tokens = inputEvent.tokens;

    if (key.sequence === '\u0003' || tokens.includes('ctrl+c')) {
      interruptedReason = 'ctrl-c';
      stopInputCapture();
      return;
    }
    if (key.name?.toLowerCase() === 'escape' || key.sequence === '\u001b' || tokens.includes('escape')) {
      interruptedReason = 'escape';
      stopInputCapture();
      return;
    }
    if (isRestartInputTokens(tokens) || isRestartKeyPress(chunk, key)) {
      interruptedReason = 'restart';
      stopInputCapture();
      return;
    }
    const highSpeedAction = resolveHighSpeedControlActionFromAltLaneTokens(tokens, inputTokenToChannels, key);
    if (applyHighSpeedAction(highSpeedAction)) {
      return;
    }
    if (tokens.includes('space') || isSpaceKey(key)) {
      togglePause();
      return;
    }
    if (playbackClock.isPaused()) {
      return;
    }
    handleMappedInputTokens(tokens);
  };

  const onRawInputData = (data: Buffer): void => {
    if (interruptedReason) {
      return;
    }
    const chunk = data.toString('utf8');
    const inputEvent = resolveInputTokenEvent(chunk, {
      name: undefined,
      sequence: chunk,
      ctrl: false,
      meta: false,
      shift: false,
    } satisfies readline.Key);
    if (!inputEvent.kittyProtocolEvent) {
      return;
    }
    suppressLegacyKeypressUntilMs = Date.now() + 36;

    const pressTokens = inputEvent.tokens;
    const repeatTokens = inputEvent.repeatTokens;
    const releaseTokens = inputEvent.releaseTokens;
    if (pressTokens.length > 0 || repeatTokens.length > 0) {
      const pressedChannels = resolveMappedInputChannels(pressTokens, repeatTokens);
      for (const channel of pressedChannels) {
        activeKittyPressedChannels.add(channel);
        tui?.pressLane(channel);
      }
    }
    if (releaseTokens.length > 0) {
      const releasedChannels = resolveMappedInputChannels(releaseTokens);
      for (const channel of releasedChannels) {
        activeKittyPressedChannels.delete(channel);
        tui?.releaseLane(channel);
        if (activeLongNotesByChannel.has(channel)) {
          longHoldUntilMsByChannel.set(channel, playbackClock.nowMs());
        }
      }
    }

    if (pressTokens.length === 0) {
      return;
    }

    if (pressTokens.includes('ctrl+c')) {
      interruptedReason = 'ctrl-c';
      stopInputCapture();
      return;
    }
    if (pressTokens.includes('escape')) {
      interruptedReason = 'escape';
      stopInputCapture();
      return;
    }
    if (isRestartInputTokens(pressTokens)) {
      interruptedReason = 'restart';
      stopInputCapture();
      return;
    }
    if (applyHighSpeedAction(resolveHighSpeedControlActionFromAltLaneTokens(pressTokens, inputTokenToChannels))) {
      return;
    }
    if (pressTokens.includes('space')) {
      togglePause();
      return;
    }
    if (playbackClock.isPaused()) {
      return;
    }
    handleMappedInputTokens(pressTokens);
  };

  process.stdin.prependListener('data', onRawInputData);
  process.stdin.on('keypress', onKeyPress);

  try {
    while (playbackClock.nowMs() < horizon) {
      if (interruptedReason) {
        break;
      }
      const nowMs = playbackClock.nowMs();
      if (playbackClock.isPaused()) {
        const nowSec = elapsedMsToGameSeconds(nowMs, speed);
        tui?.render({
          currentBeat: beatAtSeconds(nowSec),
          currentSeconds: nowSec,
          totalSeconds,
          summary,
          notes: renderNotes,
          audioBackend: audioBackendLabel,
          ...resolveDebugActiveAudioState(),
          ...createBgaRenderFrame(bgaRenderer, nowSec),
        });
        await waitPrecise(PAUSE_POLL_INTERVAL_MS);
        continue;
      }
      const nowSec = elapsedMsToGameSeconds(nowMs, speed);
      const nowBeat = beatAtSeconds(nowSec);

      triggerNonPlayableRealtimeAudioEvents(nowSec);

      for (const channel of activeKittyPressedChannels) {
        if (!activeLongNotesByChannel.has(channel)) {
          continue;
        }
        longHoldUntilMsByChannel.set(channel, nowMs + LONG_NOTE_REPEAT_HOLD_GRACE_MS);
      }

      for (const [channel, hold] of activeLongNotesByChannel.entries()) {
        if (nowSec >= hold.endSeconds) {
          activeLongNotesByChannel.delete(channel);
          longHoldUntilMsByChannel.delete(channel);
          applyManualTimingJudge(channel, (nowSec - hold.endSeconds) * 1000, nowSec);
          continue;
        }

        const holdUntilMs = longHoldUntilMsByChannel.get(channel);
        if (holdUntilMs !== undefined && nowMs > holdUntilMs) {
          activeLongNotesByChannel.delete(channel);
          longHoldUntilMsByChannel.delete(channel);
          audioSession?.stopChannel?.(channel);
          applyManualTimingJudge(channel, (nowSec - hold.endSeconds) * 1000, nowSec);
        }
      }

      for (const [channel, suppressUntil] of longNoteSuppressUntilSecondsByChannel.entries()) {
        if (nowSec >= suppressUntil) {
          longNoteSuppressUntilSecondsByChannel.delete(channel);
        }
      }

      applyAutoScratchJudgements(nowSec);
      applyExpiredScorableJudgements(nowSec);

      tui?.render({
        currentBeat: nowBeat,
        currentSeconds: nowSec,
        totalSeconds,
        summary,
        notes: renderNotes,
        audioBackend: audioBackendLabel,
        ...resolveDebugActiveAudioState(),
        ...createBgaRenderFrame(bgaRenderer, nowSec),
      });

      markExpiredLandmines(nowSec);
      markExpiredInvisibleNotes(nowSec);

      if (
        remainingScorableNotes === 0 &&
        remainingLandmineNotes === 0 &&
        remainingInvisibleNotes === 0 &&
        !audioSession
      ) {
        break;
      }

      await waitPrecise(TUI_FRAME_INTERVAL_MS);
    }

    if (!interruptedReason) {
      const judgedCount = summary.perfect + summary.great + summary.good + summary.bad + summary.poor;
      if (judgedCount < summary.total) {
        const missingCount = summary.total - judgedCount;
        for (let index = 0; index < missingCount; index += 1) {
          applyJudgeToSummary(summary, 'POOR', scoreTracker);
        }
        triggerPoorBga(totalSeconds);
        combo = 0;
        if (tui) {
          activeStateSignals?.publishJudgeCombo('POOR', combo);
          tui.render({
            currentBeat: beatAtSeconds(totalSeconds),
            currentSeconds: totalSeconds,
            totalSeconds,
            summary,
            notes: renderNotes,
            audioBackend: audioBackendLabel,
            ...resolveDebugActiveAudioState(),
            ...createBgaRenderFrame(bgaRenderer, totalSeconds),
          });
        }
      }
    }
  } finally {
    detachBgaResizeHandler();
    if (interruptedReason) {
      await disposeAudioSessionSafely(audioSession);
    } else {
      await finalizeAudioSessionSafely(audioSession);
    }
    stopInputCapture();
    tui?.stop();
  }

  if (interruptedReason) {
    if (interruptedReason === 'escape') {
      process.stdout.write(renderSummary(summary));
      return summary;
    }
    throw new PlayerInterruptedError(interruptedReason);
  }

  process.stdout.write(renderSummary(summary));
  return summary;
}

function resolveAudioBackendLabel(options: PlayerOptions, audioSession: AudioSession | undefined): string {
  if (options.audio === false) {
    return 'off';
  }
  return audioSession?.backendLabel ?? 'none';
}

function createTuiIfEnabled(
  json: BeMusicJson,
  options: PlayerOptions,
  mode: 'AUTO' | 'MANUAL' | 'AUTO SCRATCH',
  laneBindings: LaneBinding[],
  laneDisplayMode: string,
  speed: number,
  judgeWindowMs: number,
  randomPatternSummary?: string,
  stateSignals?: PlayerStateSignals,
): PlayerTui | undefined {
  if (options.tui === false) {
    return undefined;
  }

  const has2P = laneBindings.some((binding) => binding.side === '2P');
  const splitAfterIndex = has2P ? findLastLaneIndex(laneBindings, (binding) => binding.side === '1P') : -1;
  const lanes = laneBindings.map((binding) => ({
    channel: binding.channel,
    key: binding.keyLabel,
    isScratch: binding.isScratch,
  }));
  const timingResolver = createTimingResolver(json);
  const beatResolver = createBeatResolver(json);
  const measureLengths = new Map<number, number>();
  for (const measure of json.measures) {
    const measureIndex = Math.max(0, Math.floor(measure.index));
    if (typeof measure.length !== 'number' || !Number.isFinite(measure.length) || measure.length <= 0) {
      continue;
    }
    measureLengths.set(measureIndex, measure.length);
  }
  const measureTimeline = createMeasureTimeline(json, timingResolver, beatResolver);
  const bpmTimeline = createBpmTimeline(json, timingResolver);
  const scrollTimeline = createScrollTimeline(json, beatResolver);
  const stopWindows = createStopBeatWindows(timingResolver).map((window) => ({
    startSeconds: window.startSeconds,
    endSeconds: window.endSeconds,
  }));
  const measureBoundariesBeats = createMeasureBoundariesBeats(json, beatResolver);
  const highSpeed = stateSignals ? stateSignals.highSpeed() : resolveHighSpeedMultiplier(options.highSpeed);
  const tui = new PlayerTui({
    mode,
    laneDisplayMode,
    title: json.metadata.title ?? 'Untitled',
    artist: json.metadata.artist,
    player: json.bms.player,
    rank: json.metadata.rank,
    playLevel: json.metadata.playLevel,
    lanes,
    speed,
    highSpeed,
    judgeWindowMs,
    showLaneChannels: options.debugActiveAudio === true,
    randomPatternSummary,
    bpmTimeline,
    scrollTimeline,
    stopWindows,
    measureTimeline,
    measureLengths,
    measureBoundariesBeats,
    splitAfterIndex,
    stateSignals,
  });

  if (!tui.isSupported()) {
    if (options.tui === true) {
      process.stdout.write('TUI is unavailable in this environment. Falling back to text output.\n');
    }
    return undefined;
  }

  return tui;
}

async function finalizeAudioSessionSafely(audioSession: AudioSession | undefined): Promise<void> {
  if (!audioSession) {
    return;
  }
  await audioSession.finish().catch(() => undefined);
  await settleWithTimeout(audioSession.dispose(), 600);
}

async function disposeAudioSessionSafely(audioSession: AudioSession | undefined): Promise<void> {
  if (!audioSession) {
    return;
  }
  await settleWithTimeout(audioSession.dispose(), 600);
}

async function settleWithTimeout(task: Promise<void>, timeoutMs: number): Promise<boolean> {
  let completed = false;
  const guardedTask = task
    .catch(() => undefined)
    .then(() => {
      completed = true;
    });
  await Promise.race([guardedTask, delay(timeoutMs)]);
  return completed;
}

function createBgaRenderFrame(
  bgaRenderer: BgaAnsiRenderer | undefined,
  currentSeconds: number,
): { bgaAnsiLines?: string[] } {
  if (!bgaRenderer) {
    return {};
  }
  return {
    bgaAnsiLines: bgaRenderer.getAnsiLines(currentSeconds),
  };
}

async function createAudioSessionIfEnabled(
  json: BeMusicJson,
  options: PlayerOptions,
  mode: 'auto' | 'manual',
  onLoadProgress?: (progress: AudioSessionLoadProgress) => void,
): Promise<AudioSession | undefined> {
  if (options.audio === false) {
    onLoadProgress?.({
      ratio: 1,
      message: 'Audio disabled; skipping audio setup.',
    });
    return undefined;
  }

  const headPaddingMs = options.audioHeadPaddingMs ?? 0;
  const bgmVolume = normalizeBgmVolume(options.bgmVolume);
  const playVolume = normalizePlayVolume(options.playVolume);
  const inferBmsLnTypeWhenMissing = options.inferBmsLnTypeWhenMissing === true;
  const chartWavGain = resolveChartVolWavGain(json);
  const lnobjEndEvents = collectLnobjEndEvents(json);
  const runtimeSampleRate = RUNTIME_AUDIO_SAMPLE_RATE;

  onLoadProgress?.({
    ratio: 0.05,
    message: 'Preparing real-time key sounds...',
  });
  const samplesByKey = await buildRuntimeSampleMap(
    json,
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
    chartWavGain,
    inferBmsLnTypeWhenMissing,
  );
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
  });
  if (!output) {
    process.stdout.write('Audio playback disabled: node-web-audio-api is unavailable.\n');
    onLoadProgress?.({
      ratio: 1,
      message: 'node-web-audio-api is unavailable; continuing without audio.',
    });
    return undefined;
  }

  process.stdout.write(`Audio backend: ${output.label}\n`);

  const eventPlaybackMap = buildEventPlaybackMap(json, inferBmsLnTypeWhenMissing);
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

  output.onError(() => {
    process.stdout.write(`Audio playback stream error (${output.label}).\n`);
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

      playbackTask = playMixedPcmThroughOutput({
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
    pause: () => {
      if (closed) {
        return;
      }
      paused = true;
    },
    resume: () => {
      if (closed) {
        return;
      }
      paused = false;
    },
    getActiveAudioFiles: () => collectActiveAudioFileNames(activeVoices),
    getActiveAudioVoiceCount: () => activeVoices.length,
    triggerEvent: (event: BeMusicEvent) => {
      if (draining || abortRequested || paused) {
        return;
      }
      if (lnobjEndEvents.has(event)) {
        return;
      }
      const normalized = normalizeObjectKey(event.value);
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
      if (json.sourceFormat === 'bms') {
        removeActiveVoicesInPlace(activeVoices, (voice) => voice.sampleKey === normalized);
      }
      if (playback?.sliceId && activeVoices.some((voice) => voice.sliceId === playback.sliceId)) {
        return;
      }
      const voiceGain = resolveTriggerVoiceGain(event.channel, playVolume, bgmVolume);
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

async function createDebugActiveAudioEstimator(
  json: BeMusicJson,
  options: {
    baseDir?: string;
    inferBmsLnTypeWhenMissing?: boolean;
  } = {},
): Promise<DebugActiveAudioEstimator> {
  const resolver = createTimingResolver(json);
  const triggers = collectSampleTriggers(json, resolver, {
    inferBmsLnTypeWhenMissing: options.inferBmsLnTypeWhenMissing === true,
  });
  const sampleDurationSecondsByKey = await buildDebugSampleDurationSecondsMap(triggers, options.baseDir);
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

  if (json.sourceFormat === 'bms') {
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
  triggers: TimedSampleTrigger[],
  baseDir?: string,
): Promise<Map<string, number>> {
  const uniqueTriggers = new Map<string, TimedSampleTrigger>();
  for (const trigger of triggers) {
    if (!uniqueTriggers.has(trigger.sampleKey)) {
      uniqueTriggers.set(trigger.sampleKey, trigger);
    }
  }

  const durations = new Map<string, number>();
  for (const trigger of uniqueTriggers.values()) {
    const rendered = await renderSingleSample(trigger.sampleKey, trigger.samplePath, {
      baseDir: baseDir ?? process.cwd(),
      sampleRate: DEBUG_ACTIVE_AUDIO_SAMPLE_RATE,
      gain: 1,
      fallbackToneSeconds: DEBUG_ACTIVE_AUDIO_FALLBACK_SECONDS,
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

async function playMixedPcmThroughOutput(params: {
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
  const { output, background, activeVoices, shouldStop, isDraining, isPaused, mode, leadTuning, playbackSampleRate } = params;

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
  const playbackStartMs = performance.now();
  let pausedAtMs = 0;
  let pausedDurationMs = 0;
  let pauseActive = false;
  let adaptiveLeadMs = leadTuning.baseLeadMs;
  const chunkDurationMs = (chunkFrames / playbackSampleRate) * 1000;
  const outputDynamics = params.outputDynamics;
  let compressorGain = 1;
  let limiterGain = 1;

  while (!shouldStop()) {
    if (isPaused()) {
      if (!pauseActive) {
        pauseActive = true;
        pausedAtMs = performance.now();
      }
      await delay(PAUSE_POLL_INTERVAL_MS);
      continue;
    }
    if (pauseActive) {
      pauseActive = false;
      pausedDurationMs += performance.now() - pausedAtMs;
    }

    const mixStartedAtMs = performance.now();
    await waitForPlaybackRealtime(
      playhead,
      playbackSampleRate,
      playbackStartMs + pausedDurationMs,
      shouldStop,
      adaptiveLeadMs,
    );

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
  playheadFrames: number,
  sampleRate: number,
  startMs: number,
  shouldStop: () => boolean,
  targetLeadMs: number,
): Promise<void> {
  const safeTargetLeadMs = Number.isFinite(targetLeadMs) ? Math.max(0, targetLeadMs) : MANUAL_AUDIO_TARGET_LEAD_MS;
  const targetLeadFrames = Math.max(0, Math.round((safeTargetLeadMs / 1000) * sampleRate));

  while (!shouldStop()) {
    const elapsedFrames = Math.floor(((performance.now() - startMs) / 1000) * sampleRate);
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
  const compressorEnabled = options.compressor === true;
  if (!limiterEnabled && !compressorEnabled) {
    return undefined;
  }

  const compressorThresholdDb = Math.min(
    0,
    resolveFiniteNumberOption(options.compressorThresholdDb, DEFAULT_COMPRESSOR_THRESHOLD_DB),
  );
  const compressorThresholdLinear = Math.max(1e-4, dbToLinear(compressorThresholdDb));
  const compressorRatio = Math.max(1.01, resolvePositiveNumberOption(options.compressorRatio, DEFAULT_COMPRESSOR_RATIO));
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

function stripPlayableEvents(json: BeMusicJson): BeMusicJson {
  const cloned = structuredClone(json);
  cloned.events = cloned.events.filter((event) => !isPlayLaneChannelForVolumeControl(event.channel));
  return cloned;
}

function stripNonPlayableEvents(json: BeMusicJson): BeMusicJson {
  const cloned = structuredClone(json);
  cloned.events = cloned.events.filter((event) => isPlayLaneChannelForVolumeControl(event.channel));
  return cloned;
}

export function isPlayLaneChannelForVolumeControl(channel: string): boolean {
  const normalized = normalizeChannel(channel);
  if (isPlayableEventChannel(normalized)) {
    return true;
  }
  if (normalized.length !== 2) {
    return false;
  }
  const side = normalized[0];
  const lane = normalized[1];
  if (lane < '1' || lane > '9') {
    return false;
  }
  return side === '3' || side === '4';
}

function isPlayableEventChannel(channel: string): boolean {
  const normalized = normalizeChannel(channel);
  return isPlayableChannel(normalized) || mapBmsLongNoteChannelToPlayable(normalized) !== undefined;
}

export function shouldUseAutoMixBgmHeadroomControl(options: PlayerOptions): boolean {
  return options.limiter === false;
}

async function renderAutoMixWithVolumeControls(
  json: BeMusicJson,
  bgmVolume: number,
  playVolume: number,
  options: {
    baseDir: string;
    tailSeconds: number;
    inferBmsLnTypeWhenMissing?: boolean;
    useBgmHeadroomControl?: boolean;
    onSampleLoadProgress?: (progress: RenderSampleLoadProgress) => void;
  },
): Promise<RenderResult> {
  if (bgmVolume === 1 && playVolume === 1) {
    return renderJson(json, options);
  }

  if (options.useBgmHeadroomControl !== true) {
    return renderJson(json, {
      ...options,
      normalize: false,
      resolveTriggerGain: (trigger) =>
        isPlayLaneChannelForVolumeControl(trigger.channel) ? playVolume : bgmVolume,
    });
  }

  const playableOnly = stripNonPlayableEvents(json);
  if (bgmVolume === 0) {
    return applyGainToRenderResult(await renderJson(playableOnly, options), playVolume);
  }

  const bgmOnly = stripPlayableEvents(json);
  if (playVolume === 0) {
    return applyGainToRenderResult(await renderJson(bgmOnly, options), bgmVolume);
  }

  const splitRenderOptions = {
    ...options,
    normalize: false,
  } as const;
  const [bgmRendered, playableRendered] = await Promise.all([
    renderJson(bgmOnly, splitRenderOptions),
    renderJson(playableOnly, splitRenderOptions),
  ]);
  const scaledPlayable = applyGainToRenderResult(playableRendered, playVolume);
  const scaledBgm = applyGainToRenderResult(bgmRendered, bgmVolume);
  const bgmHeadroomGain = resolveBgmHeadroomGain(scaledPlayable, scaledBgm);

  return mixRenderResults(applyGainToRenderResult(scaledBgm, bgmHeadroomGain), scaledPlayable);
}

async function buildRuntimeSampleMap(
  json: BeMusicJson,
  options: PlayerOptions,
  sampleRate: number,
  onProgress?: (progress: { loaded: number; total: number; sampleKey: string; samplePath?: string }) => void,
  chartWavGain = 1,
  inferBmsLnTypeWhenMissing = false,
): Promise<Map<string, RenderResult>> {
  const sampleMap = new Map<string, RenderResult>();
  const keys = collectRealtimeAudioSampleKeys(json, inferBmsLnTypeWhenMissing);

  if (keys.length === 0) {
    onProgress?.({
      loaded: 0,
      total: 0,
      sampleKey: '',
      samplePath: undefined,
    });
  }

  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const sourcePath = json.resources.wav[key];
    const rendered = await renderSingleSample(key, sourcePath, {
      baseDir: options.audioBaseDir ?? process.cwd(),
      sampleRate,
      gain: chartWavGain,
      fallbackToneSeconds: 0.06,
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

function buildEventPlaybackMap(
  json: BeMusicJson,
  inferBmsLnTypeWhenMissing: boolean,
): Map<BeMusicEvent, PlayableNotePlayback> {
  const playbackMap = new Map<BeMusicEvent, PlayableNotePlayback>();
  const resolver = createTimingResolver(json);
  for (const trigger of collectSampleTriggers(json, resolver, { inferBmsLnTypeWhenMissing })) {
    playbackMap.set(trigger.event, {
      offsetSeconds: trigger.sampleOffsetSeconds,
      durationSeconds: trigger.sampleDurationSeconds,
      sliceId: trigger.sampleSliceId,
    });
  }
  return playbackMap;
}

function collectRealtimeAudioTriggers(
  json: BeMusicJson,
  inferBmsLnTypeWhenMissing: boolean,
  includeChannel: (channel: string) => boolean = () => true,
): Array<TimedSampleTrigger & RealtimeAudioTrigger> {
  const resolver = createTimingResolver(json);
  const triggers = collectSampleTriggers(json, resolver, { inferBmsLnTypeWhenMissing });
  const filtered: Array<TimedSampleTrigger & RealtimeAudioTrigger> = [];
  for (const trigger of triggers) {
    if (!includeChannel(trigger.channel)) {
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

function collectRealtimeAudioSampleKeys(json: BeMusicJson, inferBmsLnTypeWhenMissing: boolean): string[] {
  const resolver = createTimingResolver(json);
  const keys = new Set<string>();
  for (const trigger of collectSampleTriggers(json, resolver, { inferBmsLnTypeWhenMissing })) {
    keys.add(trigger.sampleKey);
  }
  return [...keys];
}

function resolveTriggerVoiceGain(channel: string, playVolume: number, bgmVolume: number): number {
  return isPlayLaneChannelForVolumeControl(channel) ? playVolume : bgmVolume;
}

function createSilentRenderResult(sampleRate: number): RenderResult {
  const safeSampleRate = Number.isFinite(sampleRate) ? Math.max(8_000, Math.floor(sampleRate)) : RUNTIME_AUDIO_SAMPLE_RATE;
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

function normalizeBgmVolume(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, value);
}

function normalizePlayVolume(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, value);
}

function applyGainToRenderResult(result: RenderResult, gain: number): RenderResult {
  if (gain === 1) {
    return result;
  }

  const left = new Float32Array(result.left.length);
  const right = new Float32Array(result.right.length);
  for (let index = 0; index < result.left.length; index += 1) {
    left[index] = result.left[index] * gain;
    right[index] = result.right[index] * gain;
  }

  return {
    sampleRate: result.sampleRate,
    left,
    right,
    durationSeconds: result.durationSeconds,
    peak: measureRenderPeak(left, right),
  };
}

function mixRenderResults(leftResult: RenderResult, rightResult: RenderResult): RenderResult {
  if (leftResult.sampleRate !== rightResult.sampleRate) {
    return leftResult;
  }

  const frameLength = Math.max(leftResult.left.length, rightResult.left.length);
  const mixedLeft = new Float32Array(frameLength);
  const mixedRight = new Float32Array(frameLength);

  for (let frame = 0; frame < frameLength; frame += 1) {
    const left = (leftResult.left[frame] ?? 0) + (rightResult.left[frame] ?? 0);
    const right = (leftResult.right[frame] ?? 0) + (rightResult.right[frame] ?? 0);
    mixedLeft[frame] = left;
    mixedRight[frame] = right;
  }

  return {
    sampleRate: leftResult.sampleRate,
    left: mixedLeft,
    right: mixedRight,
    durationSeconds: frameLength / leftResult.sampleRate,
    peak: measureRenderPeak(mixedLeft, mixedRight),
  };
}

export function resolveBgmHeadroomGain(playableResult: RenderResult, bgmResult: RenderResult): number {
  const frameLength = Math.max(playableResult.left.length, bgmResult.left.length);
  let headroomGain = 1;

  // Keep playable/key-sound amplitude intact by shrinking only the BGM side when summed peak would clip.
  for (let frame = 0; frame < frameLength; frame += 1) {
    const playableLeft = Math.abs(playableResult.left[frame] ?? 0);
    const playableRight = Math.abs(playableResult.right[frame] ?? 0);
    const bgmLeft = Math.abs(bgmResult.left[frame] ?? 0);
    const bgmRight = Math.abs(bgmResult.right[frame] ?? 0);
    headroomGain = Math.min(
      headroomGain,
      resolveBgmHeadroomGainForChannel(playableLeft, bgmLeft),
      resolveBgmHeadroomGainForChannel(playableRight, bgmRight),
    );
  }

  return Math.max(0, Math.min(1, headroomGain));
}

function resolveBgmHeadroomGainForChannel(playableAbs: number, bgmAbs: number): number {
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

function measureRenderPeak(left: Float32Array, right: Float32Array): number {
  let peak = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftAbs = Math.abs(left[index]);
    if (leftAbs > peak) {
      peak = leftAbs;
    }
    const rightAbs = Math.abs(right[index]);
    if (rightAbs > peak) {
      peak = rightAbs;
    }
  }
  return peak;
}

function mergeRenderNotesBySeconds(
  notes: ReadonlyArray<TimedPlayableNote>,
  landmineNotes: ReadonlyArray<TimedLandmineNote>,
  invisibleNotes: ReadonlyArray<TimedPlayableNote>,
): Array<TimedPlayableNote | TimedLandmineNote> {
  const merged: Array<TimedPlayableNote | TimedLandmineNote> = [];
  let noteIndex = 0;
  let landmineIndex = 0;
  let invisibleIndex = 0;

  while (noteIndex < notes.length || landmineIndex < landmineNotes.length || invisibleIndex < invisibleNotes.length) {
    const note = noteIndex < notes.length ? notes[noteIndex]! : undefined;
    const landmine = landmineIndex < landmineNotes.length ? landmineNotes[landmineIndex]! : undefined;
    const invisible = invisibleIndex < invisibleNotes.length ? invisibleNotes[invisibleIndex]! : undefined;

    if (
      note &&
      (landmine === undefined || note.seconds <= landmine.seconds) &&
      (invisible === undefined || note.seconds <= invisible.seconds)
    ) {
      merged.push(note);
      noteIndex += 1;
      continue;
    }

    if (landmine && (invisible === undefined || landmine.seconds <= invisible.seconds)) {
      merged.push(landmine);
      landmineIndex += 1;
      continue;
    }

    if (invisible) {
      merged.push(invisible);
      invisibleIndex += 1;
    }
  }

  return merged;
}

function collectUniqueNoteChannels(
  notes: ReadonlyArray<TimedPlayableNote>,
  landmineNotes: ReadonlyArray<TimedLandmineNote>,
  invisibleNotes: ReadonlyArray<TimedPlayableNote>,
): string[] {
  const channels: string[] = [];
  const seen = new Set<string>();
  const collect = (channel: string): void => {
    if (seen.has(channel)) {
      return;
    }
    seen.add(channel);
    channels.push(channel);
  };

  for (const note of notes) {
    collect(note.channel);
  }
  for (const note of landmineNotes) {
    collect(note.channel);
  }
  for (const note of invisibleNotes) {
    collect(note.channel);
  }

  return channels;
}

function createPlaybackClock(startAtMs: number): PlaybackClock {
  const anchorMs = Number.isFinite(startAtMs) ? startAtMs : performance.now();
  let paused = false;
  let pausedAtMs = 0;
  let pausedDurationMs = 0;

  const nowMs = (): number => {
    const reference = paused ? pausedAtMs : performance.now();
    return Math.max(0, reference - anchorMs - pausedDurationMs);
  };

  return {
    nowMs,
    isPaused: () => paused,
    pause: () => {
      if (paused) {
        return false;
      }
      paused = true;
      pausedAtMs = performance.now();
      return true;
    },
    resume: () => {
      if (!paused) {
        return false;
      }
      pausedDurationMs += Math.max(0, performance.now() - pausedAtMs);
      paused = false;
      pausedAtMs = 0;
      return true;
    },
  };
}

function isSpaceKey(key: readline.Key): boolean {
  return key.name?.toLowerCase() === 'space' || key.sequence === ' ';
}

function isRestartInputTokens(tokens: readonly string[]): boolean {
  return tokens.includes('shift+r');
}

function isRestartKeyPress(chunk: string | undefined, key: readline.Key): boolean {
  if (typeof chunk === 'string' && chunk === 'R') {
    return true;
  }
  return key.name?.toLowerCase() === 'r' && key.shift === true;
}

function resolveHighSpeedControlActionFromAltLaneTokens(
  tokens: readonly string[],
  inputTokenToChannels: ReadonlyMap<string, readonly string[]>,
  key?: readline.Key,
): HighSpeedControlAction | undefined {
  const channels = new Set<string>();
  const addChannelsForAltToken = (token: string): void => {
    if (!token.startsWith('alt+')) {
      return;
    }
    const baseToken = token.slice('alt+'.length).toLowerCase();
    const mapped = inputTokenToChannels.get(baseToken);
    if (!mapped) {
      return;
    }
    for (const channel of mapped) {
      channels.add(channel);
    }
  };

  for (const token of tokens) {
    const normalizedToken = token.toLowerCase();
    addChannelsForAltToken(normalizedToken);
    if (normalizedToken.startsWith('option+')) {
      addChannelsForAltToken(`alt+${normalizedToken.slice('option+'.length)}`);
    }
  }
  if (key?.meta) {
    const keyName = normalizeLegacyKeyNameToken(key.name);
    if (keyName) {
      addChannelsForAltToken(`alt+${keyName}`);
    }
  }

  if (channels.size === 0) {
    return undefined;
  }
  return resolveHighSpeedControlActionFromLaneChannels([...channels]);
}

function normalizeLegacyKeyNameToken(name: string | undefined): string | undefined {
  if (typeof name !== 'string' || name.length === 0) {
    return undefined;
  }
  const lowered = name.toLowerCase();
  if (lowered.length === 1) {
    return lowered;
  }
  if (lowered === 'comma') {
    return ',';
  }
  if (lowered === 'period') {
    return '.';
  }
  if (lowered === 'slash') {
    return '/';
  }
  if (lowered === 'semicolon') {
    return ';';
  }
  if (lowered === 'quote') {
    return "'";
  }
  if (lowered === 'leftbracket') {
    return '[';
  }
  if (lowered === 'rightbracket') {
    return ']';
  }
  return undefined;
}

function elapsedMsToGameSeconds(elapsedMs: number, speed: number): number {
  return Math.max(0, (elapsedMs / 1000) * speed);
}

async function waitPrecise(delayMs: number): Promise<void> {
  const target = performance.now() + Math.max(0, delayMs);
  while (true) {
    const remaining = target - performance.now();
    if (remaining <= 0) {
      return;
    }
    if (remaining > 8) {
      await delay(remaining - 4);
      continue;
    }
    await delayImmediate();
  }
}

function addHeadPadding(result: RenderResult, paddingMs: number): RenderResult {
  const safePaddingMs = Number.isFinite(paddingMs) ? Math.max(0, paddingMs) : 0;
  if (safePaddingMs === 0) {
    return result;
  }

  const paddingFrames = Math.round((safePaddingMs / 1000) * result.sampleRate);
  if (paddingFrames <= 0) {
    return result;
  }

  const left = new Float32Array(result.left.length + paddingFrames);
  const right = new Float32Array(result.right.length + paddingFrames);
  left.set(result.left, paddingFrames);
  right.set(result.right, paddingFrames);

  return {
    ...result,
    left,
    right,
    durationSeconds: left.length / result.sampleRate,
  };
}

function toPlaybackSampleRate(baseSampleRate: number, speed: number): number {
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const scaled = Math.round(baseSampleRate * safeSpeed);
  return Math.max(8_000, Math.min(192_000, scaled));
}

function findLastLaneIndex(bindings: LaneBinding[], predicate: (binding: LaneBinding) => boolean): number {
  for (let index = bindings.length - 1; index >= 0; index -= 1) {
    if (predicate(bindings[index])) {
      return index;
    }
  }
  return -1;
}

function estimateBgaAnsiDisplaySize(bindings: LaneBinding[]): { width: number; height: number } {
  const laneWidths = bindings.map((binding) =>
    binding.isScratch ? WIDE_SCRATCH_LANE_WIDTH : DEFAULT_LANE_WIDTH,
  );
  const laneCount = laneWidths.length;
  const has2P = bindings.some((binding) => binding.side === '2P');
  const splitAfterIndex = has2P ? findLastLaneIndex(bindings, (binding) => binding.side === '1P') : -1;

  const laneTextWidth = laneWidths.reduce((sum, width) => sum + width, 0);
  const laneSpacingWidth = laneCount > 0 ? laneCount - 1 : 0;
  const splitExtraWidth = splitAfterIndex >= 0 && splitAfterIndex < laneCount - 1 ? 2 : 0;
  const laneBlockWidth = laneTextWidth + laneSpacingWidth + splitExtraWidth;

  const columns = process.stdout.columns ?? DEFAULT_TERMINAL_COLUMNS;
  const width = Math.max(MIN_BGA_ASCII_WIDTH, columns - laneBlockWidth - BGA_LANE_GAP);

  const terminalRows = process.stdout.rows ?? DEFAULT_GRID_ROWS + STATIC_TUI_LINES;
  const rowCount = Math.max(MIN_GRID_ROWS, terminalRows - STATIC_TUI_LINES);
  const laneBlockHeight = rowCount + 4;
  const height = Math.max(MIN_BGA_ASCII_HEIGHT, laneBlockHeight);

  return { width, height };
}

function attachBgaResizeHandler(
  tui: PlayerTui | undefined,
  bgaRenderer: BgaAnsiRenderer | undefined,
  bindings: LaneBinding[],
): () => void {
  if (!tui || !bgaRenderer || !process.stdout.isTTY) {
    return () => undefined;
  }

  const onResize = (): void => {
    const displaySize = estimateBgaAnsiDisplaySize(bindings);
    bgaRenderer.setDisplaySize(displaySize.width, displaySize.height);
  };
  process.stdout.on('resize', onResize);
  return () => {
    process.stdout.off('resize', onResize);
  };
}

function printLaneMap(bindings: LaneBinding[]): void {
  process.stdout.write('Channel map:\n');
  for (const binding of bindings) {
    process.stdout.write(`  ${binding.channel} => ${binding.keyLabel}\n`);
  }
}

function resolveActiveFreeZoneChannels(
  channels: readonly string[],
  laneBindings: readonly LaneBinding[],
): ReadonlySet<string> {
  const existingChannels = new Set(channels.map((channel) => normalizeChannel(channel)));
  const boundChannels = new Set(laneBindings.map((binding) => normalizeChannel(binding.channel)));
  const activeFreeZoneChannels = new Set<string>();

  if (existingChannels.has('17') && boundChannels.has('16') && !boundChannels.has('17')) {
    activeFreeZoneChannels.add('17');
  }
  if (existingChannels.has('27') && boundChannels.has('26') && !boundChannels.has('27')) {
    activeFreeZoneChannels.add('27');
  }

  return activeFreeZoneChannels;
}

function isActiveFreeZoneChannel(channel: string, activeFreeZoneChannels: ReadonlySet<string>): boolean {
  return activeFreeZoneChannels.has(normalizeChannel(channel));
}

function resolveNoteKeyLabel(channel: string, keyMap: ReadonlyMap<string, string>): string {
  const normalized = normalizeChannel(channel);
  if (keyMap.has(normalized)) {
    return keyMap.get(normalized) ?? '?';
  }
  if (normalized === '17') {
    return keyMap.get('16') ?? '?';
  }
  if (normalized === '27') {
    return keyMap.get('26') ?? '?';
  }
  return '?';
}

function renderSummary(summary: PlayerSummary): string {
  const maxExScore = Math.max(0, summary.total * IIDX_EX_SCORE_PER_PGREAT);
  const exScoreRate = maxExScore > 0 ? summary.exScore / maxExScore : 0;
  const scoreRate = summary.score / IIDX_SCORE_MAX;
  return (
    [
      '--- Result ---',
      `TOTAL  : ${summary.total}`,
      `PERFECT: ${summary.perfect}`,
      `FAST   : ${summary.fast}`,
      `SLOW   : ${summary.slow}`,
      `GREAT  : ${summary.great}`,
      `GOOD   : ${summary.good}`,
      `BAD    : ${summary.bad}`,
      `POOR   : ${summary.poor}`,
      `EX-SCORE: ${summary.exScore} / ${maxExScore} (${(exScoreRate * 100).toFixed(2)}%)`,
      `SCORE   : ${summary.score} / ${IIDX_SCORE_MAX} (${(scoreRate * 100).toFixed(2)}%)`,
    ].join('\n') + '\n'
  );
}

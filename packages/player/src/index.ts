import { basename, dirname, resolve } from 'node:path';
import readline from 'node:readline';
import { setImmediate as delayImmediate, setTimeout as delay } from 'node:timers/promises';
import {
  createBeatResolver,
  createEmptyJson,
  type BmsEvent,
  type BmsJson,
  isPlayableChannel,
  normalizeChannel,
  normalizeObjectKey,
} from '@be-music/json';
import { parseChartFile, resolveBmsControlFlow } from '@be-music/parser';
import {
  type RenderResult,
  type RenderSampleLoadProgress,
  collectSampleTriggers,
  createTimingResolver,
  renderJson,
} from '@be-music/audio-renderer';
import { clampInt } from '@be-music/utils';
import { createBgaAnsiRenderer, type BgaAnsiRenderer } from './bga.ts';
import { PlayerTui } from './tui.ts';
import { findBestCandidate, findLaneSoundCandidate } from './judging.ts';
import {
  createInputTokenToChannelsMap,
  createLaneBindings,
  resolveInputTokens,
  type LaneBinding,
} from './manual-input.ts';
import { extractLandmineNotes, extractPlayableNotes } from './playable-notes.ts';
import {
  createAudioBackendResolutionOrder,
  createAudioOutputBackend,
  type AudioBackendName,
  type AudioOutputBackend,
} from './audio-backend.ts';

export interface PlayerOptions {
  auto?: boolean;
  speed?: number;
  judgeWindowMs?: number;
  leadInMs?: number;
  audio?: boolean;
  bgmVolume?: number;
  audioBaseDir?: string;
  audioTailSeconds?: number;
  audioOffsetMs?: number;
  audioHeadPaddingMs?: number;
  audioBackend?: AudioBackendName;
  tui?: boolean;
  onLoadProgress?: (progress: PlayerLoadProgress) => void;
}

export interface PlayerSummary {
  total: number;
  perfect: number;
  great: number;
  good: number;
  bad: number;
  miss: number;
  exScore: number;
  score: number;
}

export interface PlayerLoadProgress {
  ratio: number;
  message: string;
  detail?: string;
}

export type PlayerInterruptReason = 'escape' | 'ctrl-c';

export class PlayerInterruptedError extends Error {
  readonly reason: PlayerInterruptReason;

  readonly exitCode: number;

  constructor(reason: PlayerInterruptReason) {
    super(`Player interrupted: ${reason}`);
    this.reason = reason;
    this.exitCode = reason === 'ctrl-c' ? 130 : 0;
  }
}

interface MeasureTimelinePoint {
  measure: number;
  seconds: number;
}

interface BpmTimelinePoint {
  bpm: number;
  seconds: number;
}

interface StopBeatWindow {
  beat: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

interface AudioSession {
  start: () => void;
  finish: () => Promise<void>;
  dispose: () => Promise<void>;
  chartStartDelayMs: number;
  triggerEvent?: (event: BmsEvent) => void;
  stopChannel?: (channel: string) => void;
}

interface PlayableNotePlayback {
  offsetSeconds: number;
  durationSeconds?: number;
  sliceId?: string;
}

const AUTO_AUDIO_CHUNK_FRAMES = 256;
const MANUAL_AUDIO_CHUNK_FRAMES = 256;
const MANUAL_AUDIO_TARGET_LEAD_MS = 20;
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
const IIDX_PGREAT_WINDOW_MS = 16.67;
const IIDX_GREAT_WINDOW_MS = 33.33;
const IIDX_GOOD_WINDOW_MS = 116.67;
const IIDX_BAD_WINDOW_MS = 250;
const BEATORAJA_BMS_JUDGERANK_MULTIPLIERS = [25, 50, 75, 100, 125] as const;
const BEATORAJA_BMS_DEFAULT_JUDGERANK = BEATORAJA_BMS_JUDGERANK_MULTIPLIERS[2];
const BEATORAJA_BMSON_DEFAULT_JUDGERANK = 100;
const IIDX_EX_SCORE_PER_PGREAT = 2;
const IIDX_EX_SCORE_PER_GREAT = 1;
const IIDX_SCORE_MAX = 200000;
const IIDX_SCORE_JUDGE_BASE_MAX = 150000;
const IIDX_SCORE_COMBO_BONUS_MAX = 50000;

type JudgeKind = 'PERFECT' | 'GREAT' | 'GOOD' | 'BAD' | 'MISS';

interface ScoreTracker {
  combo: number;
  scoreAccumulator: number;
}

interface JudgeWindowsMs {
  pgreat: number;
  great: number;
  good: number;
  bad: number;
}

export async function playChartFile(filePath: string, options: PlayerOptions = {}): Promise<PlayerSummary> {
  const json = await parseChartFile(filePath);
  const mergedOptions: PlayerOptions = {
    ...options,
    audioBaseDir: options.audioBaseDir ?? dirname(resolve(filePath)),
  };
  return mergedOptions.auto ? autoPlay(json, mergedOptions) : manualPlay(json, mergedOptions);
}
export { extractLandmineNotes, extractPlayableNotes };

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

function createScoreTracker(): ScoreTracker {
  return {
    combo: 0,
    scoreAccumulator: 0,
  };
}

function applyJudgeToSummary(summary: PlayerSummary, judge: JudgeKind, tracker: ScoreTracker): void {
  if (judge === 'PERFECT') {
    summary.perfect += 1;
  } else if (judge === 'GREAT') {
    summary.great += 1;
  } else if (judge === 'GOOD') {
    summary.good += 1;
  } else if (judge === 'BAD') {
    summary.bad += 1;
  } else {
    summary.miss += 1;
  }

  const exScoreDelta = resolveExScoreDelta(judge);
  summary.exScore += exScoreDelta;

  if (judge === 'PERFECT' || judge === 'GREAT' || judge === 'GOOD') {
    tracker.combo += 1;
  } else {
    tracker.combo = 0;
  }

  const scoreDelta = resolveIidxScoreDelta(judge, summary.total, tracker.combo);
  tracker.scoreAccumulator += scoreDelta;
  summary.score = Math.max(0, Math.min(IIDX_SCORE_MAX, Math.floor(tracker.scoreAccumulator + 1e-9)));
}

function resolveExScoreDelta(judge: JudgeKind): number {
  if (judge === 'PERFECT') {
    return IIDX_EX_SCORE_PER_PGREAT;
  }
  if (judge === 'GREAT') {
    return IIDX_EX_SCORE_PER_GREAT;
  }
  return 0;
}

function resolveIidxScoreDelta(judge: JudgeKind, totalNotes: number, combo: number): number {
  if (!Number.isFinite(totalNotes) || totalNotes <= 0) {
    return 0;
  }

  const baseUnit = IIDX_SCORE_JUDGE_BASE_MAX / totalNotes;
  let judgeMultiplier = 0;
  if (judge === 'PERFECT') {
    judgeMultiplier = 1.5;
  } else if (judge === 'GREAT') {
    judgeMultiplier = 1;
  } else if (judge === 'GOOD') {
    judgeMultiplier = 0.2;
  }

  if (judgeMultiplier <= 0) {
    return 0;
  }

  const comboUnit = resolveIidxComboScoreUnit(totalNotes);
  const comboStep = Math.min(10, Math.max(0, combo - 1));
  return baseUnit * judgeMultiplier + comboStep * comboUnit;
}

function resolveIidxComboScoreUnit(totalNotes: number): number {
  if (!Number.isFinite(totalNotes) || totalNotes <= 1) {
    return 0;
  }
  const finiteTotalNotes = Math.floor(totalNotes);
  if (finiteTotalNotes <= 10) {
    const totalBonusSteps = (finiteTotalNotes * (finiteTotalNotes - 1)) / 2;
    return totalBonusSteps > 0 ? IIDX_SCORE_COMBO_BONUS_MAX / totalBonusSteps : 0;
  }
  return IIDX_SCORE_COMBO_BONUS_MAX / (10 * finiteTotalNotes - 55);
}

function resolveBmsJudgeRankPercent(json: BmsJson): number {
  const defExRank = json.bms.defExRank;
  if (typeof defExRank === 'number' && Number.isFinite(defExRank) && defExRank > 0) {
    return (defExRank * BEATORAJA_BMS_DEFAULT_JUDGERANK) / 100;
  }

  const rankValue = Number.isFinite(json.metadata.rank) ? Math.trunc(json.metadata.rank!) : Number.NaN;
  if (Number.isFinite(rankValue) && rankValue >= 0 && rankValue < BEATORAJA_BMS_JUDGERANK_MULTIPLIERS.length) {
    return BEATORAJA_BMS_JUDGERANK_MULTIPLIERS[rankValue as 0 | 1 | 2 | 3 | 4];
  }

  return BEATORAJA_BMS_DEFAULT_JUDGERANK;
}

function resolveBmsonJudgeRankPercent(json: BmsJson): number {
  const judgeRank = json.bmson.info.judgeRank;
  if (Number.isFinite(judgeRank) && (judgeRank ?? 0) > 0) {
    return judgeRank!;
  }
  const metadataRank = json.metadata.rank;
  if (Number.isFinite(metadataRank) && (metadataRank ?? 0) > 0) {
    return metadataRank!;
  }
  return BEATORAJA_BMSON_DEFAULT_JUDGERANK;
}

export function resolveJudgeWindowsMs(json: BmsJson, debugBadWindowMs?: number): JudgeWindowsMs {
  const bmsonStyle = json.sourceFormat === 'bmson';
  const baseJudgerank = bmsonStyle ? BEATORAJA_BMSON_DEFAULT_JUDGERANK : BEATORAJA_BMS_DEFAULT_JUDGERANK;
  const judgeRank = bmsonStyle ? resolveBmsonJudgeRankPercent(json) : resolveBmsJudgeRankPercent(json);
  const scale = judgeRank / baseJudgerank;
  const pgreat = IIDX_PGREAT_WINDOW_MS * scale;
  const great = IIDX_GREAT_WINDOW_MS * scale;
  const good = IIDX_GOOD_WINDOW_MS * scale;
  const badFromRank = IIDX_BAD_WINDOW_MS * scale;
  const bad =
    typeof debugBadWindowMs === 'number' && Number.isFinite(debugBadWindowMs) && debugBadWindowMs > 0
      ? debugBadWindowMs
      : badFromRank;
  return {
    pgreat,
    great,
    good,
    bad,
  };
}

export async function autoPlay(json: BmsJson, options: PlayerOptions = {}): Promise<PlayerSummary> {
  reportLoadProgress(options, 0.02, 'Resolving chart...');
  const resolvedJson = resolveBmsControlFlow(json);
  const speed = options.speed ?? 1;
  const leadInMs = options.leadInMs ?? 1500;
  const audioOffsetMs = options.audioOffsetMs ?? 0;
  const beatAtSeconds = createBeatAtSecondsResolver(resolvedJson);

  const notes = extractPlayableNotes(resolvedJson);
  const totalSeconds = notes.at(-1)?.seconds ?? 0;
  const channels = [...new Set(notes.map((note) => note.channel))];
  const laneBindings = createLaneBindings(channels);
  const keyMap = new Map(laneBindings.map((binding) => [binding.channel, binding.keyLabel]));
  const summary: PlayerSummary = {
    total: notes.length,
    perfect: 0,
    great: 0,
    good: 0,
    bad: 0,
    miss: 0,
    exScore: 0,
    score: 0,
  };
  const scoreTracker = createScoreTracker();
  let combo = 0;
  let interruptedReason: PlayerInterruptReason | undefined;

  reportLoadProgress(options, 0.18, 'Preparing BGA...');
  const tui = createTuiIfEnabled(resolvedJson, options, 'AUTO', laneBindings, speed, 0);
  const bgaDisplay = estimateBgaAnsiDisplaySize(laneBindings);
  const bgaRenderer = tui
    ? await createBgaAnsiRenderer(resolvedJson, {
        baseDir: options.audioBaseDir ?? process.cwd(),
        width: bgaDisplay.width,
        height: bgaDisplay.height,
      })
    : undefined;
  const preferSixel = tui?.isSixelEnabled() ?? false;
  reportLoadProgress(options, 0.3, 'Preparing audio...');
  const audioSession = await createAudioSessionIfEnabled(resolvedJson, options, 'auto', (progress) => {
    reportLoadProgress(options, 0.3 + progress.ratio * 0.68, progress.message, progress.detail);
  });
  reportLoadProgress(options, 1, 'Ready');

  if (!tui) {
    process.stdout.write('Auto play start\n');
    printLaneMap(laneBindings);
    process.stdout.write('Press Ctrl+C or Esc to quit.\n');
  } else {
    tui.start();
    tui.setLatestJudge('READY');
    tui.setCombo(0);
    tui.render({
      currentBeat: 0,
      currentSeconds: 0,
      totalSeconds,
      summary,
      notes,
      ...createBgaRenderFrame(bgaRenderer, 0, preferSixel),
    });
  }

  const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean };
  const wasRawMode = Boolean(stdin.isRaw);
  const canCaptureInput = process.stdin.isTTY;
  let inputCaptureStopped = false;

  const stopInputCapture = (): void => {
    if (!canCaptureInput || inputCaptureStopped) {
      return;
    }
    inputCaptureStopped = true;
    process.stdin.removeListener('keypress', onKeyPress);
    process.stdin.setRawMode(wasRawMode);
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

      const startedAt = performance.now() + audioOffsetMs + (audioSession?.chartStartDelayMs ?? 0);
      for (const note of notes) {
        if (interruptedReason) {
          break;
        }
        const scheduledMs = (note.seconds * 1000) / speed;

        while (true) {
          if (interruptedReason) {
            break;
          }
          const nowMs = performance.now() - startedAt;
          if (nowMs >= scheduledMs) {
            break;
          }
          const nowSec = elapsedMsToGameSeconds(nowMs, speed);
          const nowBeat = beatAtSeconds(nowSec);
          tui?.render({
            currentBeat: nowBeat,
            currentSeconds: nowSec,
            totalSeconds,
            summary,
            notes,
            ...createBgaRenderFrame(bgaRenderer, nowSec, preferSixel),
          });
          await waitPrecise(Math.max(1, Math.min(TUI_FRAME_INTERVAL_MS, scheduledMs - nowMs)));
        }
        if (interruptedReason) {
          break;
        }

        note.judged = true;
        applyJudgeToSummary(summary, 'PERFECT', scoreTracker);
        combo += 1;

        const key = keyMap.get(note.channel) ?? '?';
        if (!tui) {
          process.stdout.write(`AUTO ${formatSeconds(note.seconds)}s channel:${note.channel} key:${key}\n`);
        } else {
          tui.flashLane(note.channel);
          if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
            note.visibleUntilBeat = note.endBeat;
            tui.holdLaneUntilBeat(note.channel, note.endBeat);
          }
          tui.setLatestJudge('PERFECT');
          tui.setCombo(combo);
          tui.render({
            currentBeat: note.beat,
            currentSeconds: note.seconds,
            totalSeconds,
            summary,
            notes,
            ...createBgaRenderFrame(bgaRenderer, note.seconds, preferSixel),
          });
        }
      }

      if (!interruptedReason) {
        tui?.render({
          currentBeat: beatAtSeconds(totalSeconds),
          currentSeconds: totalSeconds,
          totalSeconds,
          summary,
          notes,
          ...createBgaRenderFrame(bgaRenderer, totalSeconds, preferSixel),
        });
      }
    }
  } finally {
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

  process.stdout.write(renderSummary(summary));
  return summary;
}

export async function manualPlay(json: BmsJson, options: PlayerOptions = {}): Promise<PlayerSummary> {
  reportLoadProgress(options, 0.02, 'Resolving chart...');
  const resolvedJson = resolveBmsControlFlow(json);
  const speed = options.speed ?? 1;
  const judgeWindows = resolveJudgeWindowsMs(resolvedJson, options.judgeWindowMs);
  const badWindowMs = judgeWindows.bad;
  const leadInMs = options.leadInMs ?? 1500;
  const audioOffsetMs = options.audioOffsetMs ?? 0;
  const beatAtSeconds = createBeatAtSecondsResolver(resolvedJson);

  const notes = extractPlayableNotes(resolvedJson);
  const landmineNotes = extractLandmineNotes(resolvedJson);
  const renderNotes = [...notes, ...landmineNotes].sort((left, right) => left.seconds - right.seconds);
  const totalSeconds = Math.max(notes.at(-1)?.seconds ?? 0, landmineNotes.at(-1)?.seconds ?? 0);
  const channels = [...new Set([...notes.map((note) => note.channel), ...landmineNotes.map((note) => note.channel)])];
  const laneBindings = createLaneBindings(channels);
  const inputTokenToChannels = createInputTokenToChannelsMap(laneBindings);

  const summary: PlayerSummary = {
    total: notes.length,
    perfect: 0,
    great: 0,
    good: 0,
    bad: 0,
    miss: 0,
    exScore: 0,
    score: 0,
  };
  const scoreTracker = createScoreTracker();
  let combo = 0;

  reportLoadProgress(options, 0.18, 'Preparing BGA...');
  const tui = createTuiIfEnabled(resolvedJson, options, 'MANUAL', laneBindings, speed, badWindowMs);
  const bgaDisplay = estimateBgaAnsiDisplaySize(laneBindings);
  const bgaRenderer = tui
    ? await createBgaAnsiRenderer(resolvedJson, {
        baseDir: options.audioBaseDir ?? process.cwd(),
        width: bgaDisplay.width,
        height: bgaDisplay.height,
      })
    : undefined;
  const preferSixel = tui?.isSixelEnabled() ?? false;
  reportLoadProgress(options, 0.3, 'Preparing audio...');
  const audioSession = await createAudioSessionIfEnabled(resolvedJson, options, 'manual', (progress) => {
    reportLoadProgress(options, 0.3 + progress.ratio * 0.68, progress.message, progress.detail);
  });
  reportLoadProgress(options, 1, 'Ready');

  if (!tui) {
    process.stdout.write('Manual play start\n');
    process.stdout.write(
      `Judge window: PGREAT<=${judgeWindows.pgreat.toFixed(2)}ms GREAT<=${judgeWindows.great.toFixed(2)}ms GOOD<=${judgeWindows.good.toFixed(2)}ms BAD<=${Math.round(badWindowMs)}ms\n`,
    );
    process.stdout.write('Press Ctrl+C to quit.\n');
    process.stdout.write('Press Esc to stop and open result.\n');
    printLaneMap(laneBindings);
  } else {
    tui.start();
    tui.setLatestJudge('READY');
    tui.setCombo(0);
    tui.render({
      currentBeat: 0,
      currentSeconds: 0,
      totalSeconds,
      summary,
      notes: renderNotes,
      ...createBgaRenderFrame(bgaRenderer, 0, preferSixel),
    });
  }

  await delay(leadInMs);

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  audioSession?.start();

  const startedAt = performance.now() + audioOffsetMs + (audioSession?.chartStartDelayMs ?? 0);
  const horizon = (totalSeconds * 1000) / speed + leadInMs + badWindowMs + 1000;
  let interruptedReason: PlayerInterruptReason | undefined;
  const longHoldUntilMsByChannel = new Map<string, number>();
  const activeLongNotesByChannel = new Map<string, { endSeconds: number }>();
  const longNoteSuppressUntilSecondsByChannel = new Map<string, number>();

  const stopInputCapture = () => {
    process.stdin.removeListener('keypress', onKeyPress);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  };

  const onKeyPress = (chunk: string, key: readline.Key): void => {
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

    const tokens = resolveInputTokens(chunk, key);
    const candidateChannels = new Set<string>();
    for (const token of tokens) {
      const mapped = inputTokenToChannels.get(token);
      if (!mapped) {
        continue;
      }
      mapped.forEach((channel) => candidateChannels.add(channel));
    }
    if (candidateChannels.size === 0) {
      return;
    }

    if (tui) {
      for (const mappedChannel of candidateChannels) {
        tui.flashLane(mappedChannel);
      }
    }

    const nowMs = performance.now() - startedAt;
    const nowSec = elapsedMsToGameSeconds(nowMs, speed);

    let refreshedHold = false;
    for (const channel of candidateChannels) {
      if (!activeLongNotesByChannel.has(channel)) {
        continue;
      }
      longHoldUntilMsByChannel.set(channel, nowMs + LONG_NOTE_REPEAT_HOLD_GRACE_MS);
      refreshedHold = true;
    }

    const candidate = findBestCandidate(notes, candidateChannels, nowSec, badWindowMs / 1000);
    const landmineCandidate = findBestCandidate(landmineNotes, candidateChannels, nowSec, badWindowMs / 1000);
    const candidateDelta = candidate ? Math.abs(candidate.seconds - nowSec) : Number.POSITIVE_INFINITY;
    const landmineDelta = landmineCandidate ? Math.abs(landmineCandidate.seconds - nowSec) : Number.POSITIVE_INFINITY;

    if (landmineCandidate && landmineDelta <= candidateDelta) {
      landmineCandidate.judged = true;
      applyJudgeToSummary(summary, 'BAD', scoreTracker);
      combo = 0;
      if (!tui) {
        process.stdout.write(`MINE channel:${landmineCandidate.channel} delta:${Math.round(landmineDelta * 1000)}ms\n`);
      } else {
        tui.setLatestJudge('BAD');
        tui.setCombo(combo);
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
        } else {
          return;
        }
      }
      if (!tui) {
        process.stdout.write(`MISS-KEY ${tokens[0] ?? '?'}\n`);
      }
      return;
    }

    candidate.judged = true;
    const channel = candidate.channel;
    tui?.flashLane(channel);
    audioSession?.triggerEvent?.(candidate.event);
    if (
      typeof candidate.endSeconds === 'number' &&
      Number.isFinite(candidate.endSeconds) &&
      candidate.endSeconds > candidate.seconds
    ) {
      activeLongNotesByChannel.set(channel, { endSeconds: candidate.endSeconds });
      longHoldUntilMsByChannel.set(channel, nowMs + LONG_NOTE_INITIAL_HOLD_GRACE_MS);
      const previousSuppressUntil = longNoteSuppressUntilSecondsByChannel.get(channel) ?? Number.NEGATIVE_INFINITY;
      if (candidate.endSeconds > previousSuppressUntil) {
        longNoteSuppressUntilSecondsByChannel.set(channel, candidate.endSeconds);
      }
      candidate.visibleUntilBeat = candidate.endBeat;
    } else {
      activeLongNotesByChannel.delete(channel);
      longHoldUntilMsByChannel.delete(channel);
    }

    const deltaMs = Math.abs(candidate.seconds - nowSec) * 1000;
    if (deltaMs <= judgeWindows.pgreat) {
      applyJudgeToSummary(summary, 'PERFECT', scoreTracker);
      combo += 1;
      if (!tui) {
        process.stdout.write(`PERFECT channel:${channel} delta:${Math.round(deltaMs)}ms\n`);
      } else {
        tui.setLatestJudge('PERFECT');
        tui.setCombo(combo);
      }
      return;
    }
    if (deltaMs <= judgeWindows.great) {
      applyJudgeToSummary(summary, 'GREAT', scoreTracker);
      combo += 1;
      if (!tui) {
        process.stdout.write(`GREAT channel:${channel} delta:${Math.round(deltaMs)}ms\n`);
      } else {
        tui.setLatestJudge('GREAT');
        tui.setCombo(combo);
      }
      return;
    }
    if (deltaMs <= judgeWindows.good) {
      applyJudgeToSummary(summary, 'GOOD', scoreTracker);
      combo += 1;
      if (!tui) {
        process.stdout.write(`GOOD channel:${channel} delta:${Math.round(deltaMs)}ms\n`);
      } else {
        tui.setLatestJudge('GOOD');
        tui.setCombo(combo);
      }
      return;
    }

    applyJudgeToSummary(summary, 'BAD', scoreTracker);
    combo = 0;
    if (!tui) {
      process.stdout.write(`BAD channel:${channel} delta:${Math.round(deltaMs)}ms\n`);
    } else {
      tui.setLatestJudge('BAD');
      tui.setCombo(combo);
    }
  };

  process.stdin.on('keypress', onKeyPress);

  try {
    while (performance.now() - startedAt < horizon) {
      if (interruptedReason) {
        break;
      }
      const nowMs = performance.now() - startedAt;
      const nowSec = elapsedMsToGameSeconds(nowMs, speed);
      const nowBeat = beatAtSeconds(nowSec);

      for (const [channel, hold] of activeLongNotesByChannel.entries()) {
        if (nowSec >= hold.endSeconds) {
          activeLongNotesByChannel.delete(channel);
          longHoldUntilMsByChannel.delete(channel);
          continue;
        }

        const holdUntilMs = longHoldUntilMsByChannel.get(channel);
        if (holdUntilMs !== undefined && nowMs > holdUntilMs) {
          activeLongNotesByChannel.delete(channel);
          longHoldUntilMsByChannel.delete(channel);
          audioSession?.stopChannel?.(channel);
        }
      }

      for (const [channel, suppressUntil] of longNoteSuppressUntilSecondsByChannel.entries()) {
        if (nowSec >= suppressUntil) {
          longNoteSuppressUntilSecondsByChannel.delete(channel);
        }
      }

      for (const note of notes) {
        if (note.judged) {
          continue;
        }
        if (nowSec - note.seconds > badWindowMs / 1000) {
          note.judged = true;
          applyJudgeToSummary(summary, 'MISS', scoreTracker);
          combo = 0;
          if (tui) {
            tui.setLatestJudge('MISS');
            tui.setCombo(combo);
          }
        }
      }

      tui?.render({
        currentBeat: nowBeat,
        currentSeconds: nowSec,
        totalSeconds,
        summary,
        notes: renderNotes,
        ...createBgaRenderFrame(bgaRenderer, nowSec, preferSixel),
      });

      for (const landmine of landmineNotes) {
        if (landmine.judged) {
          continue;
        }
        if (nowSec - landmine.seconds > badWindowMs / 1000) {
          landmine.judged = true;
        }
      }

      if (notes.every((note) => note.judged) && landmineNotes.every((note) => note.judged)) {
        break;
      }

      await waitPrecise(TUI_FRAME_INTERVAL_MS);
    }

    if (!interruptedReason) {
      const judgedCount = summary.perfect + summary.great + summary.good + summary.bad + summary.miss;
      if (judgedCount < summary.total) {
        const missingCount = summary.total - judgedCount;
        for (let index = 0; index < missingCount; index += 1) {
          applyJudgeToSummary(summary, 'MISS', scoreTracker);
        }
        combo = 0;
        if (tui) {
          tui.setLatestJudge('MISS');
          tui.setCombo(combo);
          tui.render({
            currentBeat: beatAtSeconds(totalSeconds),
            currentSeconds: totalSeconds,
            totalSeconds,
            summary,
            notes: renderNotes,
            ...createBgaRenderFrame(bgaRenderer, totalSeconds, preferSixel),
          });
        }
      }
    }
  } finally {
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

function createTuiIfEnabled(
  json: BmsJson,
  options: PlayerOptions,
  mode: 'AUTO' | 'MANUAL',
  laneBindings: LaneBinding[],
  speed: number,
  judgeWindowMs: number,
): PlayerTui | undefined {
  if (options.tui === false) {
    return undefined;
  }

  const has2P = laneBindings.some((binding) => binding.side === '2P');
  const splitAfterIndex = has2P ? findLastLaneIndex(laneBindings, (binding) => binding.side === '1P') : -1;
  const lanes = laneBindings.map((binding) => ({
    channel: binding.channel,
    key: binding.keyLabel,
  }));
  const timingResolver = createTimingResolver(json);
  const beatResolver = createBeatResolver(json);
  const measureTimeline = createMeasureTimeline(json, timingResolver, beatResolver);
  const bpmTimeline = createBpmTimeline(json, timingResolver);
  const measureBoundariesBeats = createMeasureBoundariesBeats(json, beatResolver);
  const tui = new PlayerTui({
    mode,
    title: json.metadata.title ?? 'Untitled',
    artist: json.metadata.artist,
    player: json.bms.player,
    rank: json.metadata.rank,
    playLevel: json.metadata.playLevel,
    lanes,
    speed,
    judgeWindowMs,
    bpmTimeline,
    measureTimeline,
    measureBoundariesBeats,
    splitAfterIndex,
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
  const finishCompleted = await settleWithTimeout(audioSession.finish(), 2_000);
  if (!finishCompleted) {
    await settleWithTimeout(audioSession.dispose(), 600);
    return;
  }
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
  preferSixel: boolean,
): { bgaAnsiLines?: string[]; bgaSixel?: string } {
  if (!bgaRenderer) {
    return {};
  }
  if (preferSixel) {
    const scale = estimateSixelScaleForCurrentTerminal();
    return {
      bgaSixel: bgaRenderer.getSixel(currentSeconds, scale.x, scale.y),
    };
  }
  return {
    bgaAnsiLines: bgaRenderer.getAnsiLines(currentSeconds),
  };
}

function estimateSixelScaleForCurrentTerminal(): { x: number; y: number } {
  const columns = process.stdout.columns ?? DEFAULT_TERMINAL_COLUMNS;
  const rows = process.stdout.rows ?? DEFAULT_GRID_ROWS + STATIC_TUI_LINES;
  const baseRows = DEFAULT_GRID_ROWS + STATIC_TUI_LINES;
  const x = clampInt(Math.round((columns / DEFAULT_TERMINAL_COLUMNS) * 8), 4, 24);
  const y = clampInt(Math.round((rows / baseRows) * 16), 8, 48);
  return { x, y };
}

async function createAudioSessionIfEnabled(
  json: BmsJson,
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
  const renderOptions = {
    baseDir: options.audioBaseDir ?? process.cwd(),
    tailSeconds: options.audioTailSeconds ?? 1.5,
  } as const;
  onLoadProgress?.({
    ratio: 0.05,
    message: 'Rendering playback buffer...',
  });
  const rendered =
    mode === 'manual'
      ? applyGainToRenderResult(
          await renderJson(stripPlayableEvents(json), {
            ...renderOptions,
            onSampleLoadProgress: (progress) => {
              if (progress.stage !== 'reading') {
                return;
              }
              onLoadProgress?.({
                ratio: 0.2,
                message: 'Loading audio file...',
                detail: formatSampleLoadDetail(progress),
              });
            },
          }),
          bgmVolume,
        )
      : await renderAutoBackgroundWithBgmVolume(json, bgmVolume, {
          ...renderOptions,
          onSampleLoadProgress: (progress) => {
            if (progress.stage !== 'reading') {
              return;
            }
            onLoadProgress?.({
              ratio: 0.2,
              message: 'Loading audio file...',
              detail: formatSampleLoadDetail(progress),
            });
          },
        });
  onLoadProgress?.({
    ratio: 0.55,
    message: 'Initializing audio backend...',
  });
  const padded = addHeadPadding(rendered, headPaddingMs);

  const sampleRate = toPlaybackSampleRate(padded.sampleRate, options.speed ?? 1);
  const samplesPerFrame = mode === 'manual' ? MANUAL_AUDIO_CHUNK_FRAMES : AUTO_AUDIO_CHUNK_FRAMES;
  const requestedBackend = options.audioBackend ?? 'auto';
  const output = await createAudioOutputBackend(requestedBackend, {
    sampleRate,
    channels: 2,
    samplesPerFrame,
    mode,
  });
  if (!output) {
    const attempted = createAudioBackendResolutionOrder(requestedBackend).join(', ');
    process.stdout.write(
      `Audio playback disabled: no available audio backend (requested: ${requestedBackend}; tried: ${attempted}).\n`,
    );
    onLoadProgress?.({
      ratio: 1,
      message: 'No available audio backend; continuing without audio.',
    });
    return undefined;
  }

  if (requestedBackend === 'auto') {
    process.stdout.write(`Audio backend: ${output.backend}\n`);
  }

  const playableSamples =
    mode === 'manual'
      ? await buildPlayableSampleMap(json, options, padded.sampleRate, (progress) => {
          const ratio = progress.total <= 0 ? 1 : progress.loaded / progress.total;
          onLoadProgress?.({
            ratio: 0.72 + Math.max(0, Math.min(1, ratio)) * 0.26,
            message: `Loading key sounds... (${progress.loaded}/${progress.total})`,
            detail: progress.samplePath ?? progress.sampleKey,
          });
        })
      : undefined;
  const playableNotePlaybackMap = mode === 'manual' ? buildPlayableNotePlaybackMap(json) : undefined;
  onLoadProgress?.({
    ratio: 1,
    message: 'Audio ready.',
  });

  let closed = false;
  let abortRequested = false;
  let draining = false;
  let playbackTask: Promise<void> | undefined;
  const activeVoices: ActiveVoice[] = [];

  output.onError(() => {
    process.stdout.write(`Audio playback stream error (${output.backend}).\n`);
  });

  const finish = async (): Promise<void> => {
    if (closed) {
      return;
    }
    draining = true;
    if (!playbackTask) {
      return;
    }
    const completed = await Promise.race([
      playbackTask.then(() => true).catch(() => true),
      delay(5_000).then(() => false),
    ]);
    if (completed) {
      return;
    }
    await dispose();
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
    start: () => {
      if (closed || playbackTask) {
        return;
      }

      playbackTask = playMixedPcmThroughOutput({
        output,
        background: padded,
        playableSamples,
        activeVoices,
        shouldStop: () => abortRequested,
        isDraining: () => draining,
        mode,
        playbackSampleRate: sampleRate,
      }).catch(() => undefined);
    },
    finish,
    dispose,
    chartStartDelayMs: headPaddingMs,
    triggerEvent:
      mode === 'manual'
        ? (event: BmsEvent) => {
            if (draining || abortRequested) {
              return;
            }
            const normalized = normalizeObjectKey(event.value);
            const sample = playableSamples?.get(normalized);
            if (!sample) {
              return;
            }
            const playback = playableNotePlaybackMap?.get(event);
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
              for (let index = activeVoices.length - 1; index >= 0; index -= 1) {
                if (activeVoices[index].sampleKey === normalized) {
                  activeVoices.splice(index, 1);
                }
              }
            }
            if (playback?.sliceId && activeVoices.some((voice) => voice.sliceId === playback.sliceId)) {
              return;
            }
            activeVoices.push({
              sample,
              position: offsetFrames,
              endPosition,
              channel: normalizeChannel(event.channel),
              sampleKey: normalized,
              sliceId: playback?.sliceId,
            });
          }
        : undefined,
    stopChannel:
      mode === 'manual'
        ? (channel: string) => {
            const normalizedChannel = normalizeChannel(channel);
            for (let index = activeVoices.length - 1; index >= 0; index -= 1) {
              if (activeVoices[index].channel === normalizedChannel) {
                activeVoices.splice(index, 1);
              }
            }
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
  sliceId?: string;
}

async function playMixedPcmThroughOutput(params: {
  output: AudioOutputBackend;
  background: RenderResult;
  playableSamples?: Map<string, RenderResult>;
  activeVoices: ActiveVoice[];
  shouldStop: () => boolean;
  isDraining: () => boolean;
  mode: 'auto' | 'manual';
  playbackSampleRate: number;
}): Promise<void> {
  const { output, background, activeVoices, shouldStop, isDraining, mode, playbackSampleRate } = params;

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

  while (!shouldStop()) {
    if (mode === 'manual') {
      await waitForPlaybackRealtime(playhead, playbackSampleRate, playbackStartMs, shouldStop);
    }

    const backgroundEnded = playhead >= background.left.length;
    if ((mode === 'auto' || isDraining()) && backgroundEnded && activeVoices.length === 0) {
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
      let sourceFrame = voice.position;
      for (let frame = 0; frame < voiceFrames; frame += 1) {
        mixedLeft[frame] += voiceLeft[sourceFrame];
        mixedRight[frame] += voiceRight[sourceFrame];
        sourceFrame += 1;
      }
    }

    for (let frame = 0; frame < chunkFrames; frame += 1) {
      const sampleOffset = frame * 2;
      chunkSamples[sampleOffset] = floatToInt16(mixedLeft[frame]);
      chunkSamples[sampleOffset + 1] = floatToInt16(mixedRight[frame]);
    }

    for (let index = activeVoices.length - 1; index >= 0; index -= 1) {
      const voice = activeVoices[index];
      voice.position += chunkFrames;
      if (voice.position >= voice.endPosition) {
        activeVoices.splice(index, 1);
      }
    }
    playhead += chunkFrames;

    const writable = output.write(chunk);
    if (!writable) {
      await output.waitWritable(shouldStop);
    }
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
): Promise<void> {
  const targetLeadFrames = Math.max(0, Math.round((MANUAL_AUDIO_TARGET_LEAD_MS / 1000) * sampleRate));

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

function stripPlayableEvents(json: BmsJson): BmsJson {
  const cloned = structuredClone(json);
  cloned.events = cloned.events.filter((event) => !isPlayableChannel(event.channel));
  return cloned;
}

function stripNonPlayableEvents(json: BmsJson): BmsJson {
  const cloned = structuredClone(json);
  cloned.events = cloned.events.filter((event) => isPlayableChannel(event.channel));
  return cloned;
}

async function renderAutoBackgroundWithBgmVolume(
  json: BmsJson,
  bgmVolume: number,
  options: {
    baseDir: string;
    tailSeconds: number;
    onSampleLoadProgress?: (progress: RenderSampleLoadProgress) => void;
  },
): Promise<RenderResult> {
  if (bgmVolume === 1) {
    return renderJson(json, options);
  }

  const playableOnly = stripNonPlayableEvents(json);
  if (bgmVolume === 0) {
    return renderJson(playableOnly, options);
  }

  const bgmOnly = stripPlayableEvents(json);
  const splitRenderOptions = {
    ...options,
    normalize: false,
  } as const;
  const [bgmRendered, playableRendered] = await Promise.all([
    renderJson(bgmOnly, splitRenderOptions),
    renderJson(playableOnly, splitRenderOptions),
  ]);

  return normalizeRenderResultIfNeeded(
    mixRenderResults(applyGainToRenderResult(bgmRendered, bgmVolume), playableRendered),
  );
}

async function buildPlayableSampleMap(
  json: BmsJson,
  options: PlayerOptions,
  sampleRate: number,
  onProgress?: (progress: { loaded: number; total: number; sampleKey: string; samplePath?: string }) => void,
): Promise<Map<string, RenderResult>> {
  const sampleMap = new Map<string, RenderResult>();
  const keys = [
    ...new Set(
      json.events.filter((event) => isPlayableChannel(event.channel)).map((event) => normalizeObjectKey(event.value)),
    ),
  ];

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
    const sampleJson = createEmptyJson('json');
    sampleJson.metadata.bpm = json.metadata.bpm;

    const sourcePath = json.resources.wav[key];
    if (sourcePath) {
      sampleJson.resources.wav[key] = sourcePath;
    }

    sampleJson.events.push({
      measure: 0,
      channel: '11',
      position: [0, 1],
      value: key,
    });

    const rendered = await renderJson(sampleJson, {
      baseDir: options.audioBaseDir ?? process.cwd(),
      sampleRate,
      tailSeconds: 0,
      gain: 1,
      normalize: false,
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

function buildPlayableNotePlaybackMap(json: BmsJson): Map<BmsEvent, PlayableNotePlayback> {
  const playbackMap = new Map<BmsEvent, PlayableNotePlayback>();
  const resolver = createTimingResolver(json);
  for (const trigger of collectSampleTriggers(json, resolver)) {
    if (!isPlayableChannel(trigger.channel)) {
      continue;
    }
    playbackMap.set(trigger.event, {
      offsetSeconds: trigger.sampleOffsetSeconds,
      durationSeconds: trigger.sampleDurationSeconds,
      sliceId: trigger.sampleSliceId,
    });
  }
  return playbackMap;
}

function normalizeBgmVolume(value: number | undefined): number {
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

function normalizeRenderResultIfNeeded(result: RenderResult): RenderResult {
  if (result.peak <= 1) {
    return result;
  }
  return applyGainToRenderResult(result, 1 / result.peak);
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

function floatToInt16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  if (clamped >= 0) {
    return Math.round(clamped * 32767);
  }
  return Math.round(clamped * 32768);
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

function createMeasureTimeline(
  json: BmsJson,
  resolver: ReturnType<typeof createTimingResolver>,
  beatResolver: ReturnType<typeof createBeatResolver>,
): MeasureTimelinePoint[] {
  const maxEventMeasure = json.events.reduce((max, event) => Math.max(max, event.measure), 0);
  const maxDefinedMeasure = json.measures.reduce((max, measure) => Math.max(max, measure.index), 0);
  const maxMeasure = Math.max(0, maxEventMeasure, maxDefinedMeasure);
  const timeline: MeasureTimelinePoint[] = [];
  for (let measure = 0; measure <= maxMeasure + 1; measure += 1) {
    const seconds = resolver.beatToSeconds(beatResolver.measureToBeat(measure, 0));
    if (!Number.isFinite(seconds)) {
      continue;
    }
    timeline.push({ measure, seconds });
  }

  return timeline;
}

function createBpmTimeline(json: BmsJson, resolver: ReturnType<typeof createTimingResolver>): BpmTimelinePoint[] {
  const timeline: BpmTimelinePoint[] = [];
  let previousSeconds = Number.NaN;
  let previousBpm = Number.NaN;

  for (const point of resolver.tempoPoints) {
    const seconds = resolver.beatToSeconds(point.beat);
    if (!Number.isFinite(seconds) || !Number.isFinite(point.bpm) || point.bpm <= 0) {
      continue;
    }
    if (Math.abs(seconds - previousSeconds) < 1e-6 && Math.abs(point.bpm - previousBpm) < 1e-6) {
      continue;
    }
    timeline.push({
      bpm: point.bpm,
      seconds,
    });
    previousSeconds = seconds;
    previousBpm = point.bpm;
  }

  if (timeline.length === 0) {
    const fallbackBpm = Number.isFinite(json.metadata.bpm) && json.metadata.bpm > 0 ? json.metadata.bpm : 130;
    timeline.push({ bpm: fallbackBpm, seconds: 0 });
  }

  return timeline;
}

function createBeatAtSecondsResolver(json: BmsJson): (seconds: number) => number {
  const resolver = createTimingResolver(json);
  const stopWindows = createStopBeatWindows(resolver);

  return (seconds: number): number => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return 0;
    }

    let endedStopSeconds = 0;
    for (const window of stopWindows) {
      if (seconds < window.startSeconds) {
        break;
      }
      if (seconds < window.endSeconds) {
        return window.beat;
      }
      endedStopSeconds += window.durationSeconds;
    }

    const adjustedSeconds = Math.max(0, seconds - endedStopSeconds);
    return secondsToBeatWithoutStops(resolver.tempoPoints, adjustedSeconds);
  };
}

function createStopBeatWindows(resolver: ReturnType<typeof createTimingResolver>): StopBeatWindow[] {
  const durationByBeat = new Map<number, number>();
  for (const point of resolver.stopPoints) {
    const current = durationByBeat.get(point.beat) ?? 0;
    durationByBeat.set(point.beat, current + point.seconds);
  }

  return [...durationByBeat.entries()]
    .sort(([leftBeat], [rightBeat]) => leftBeat - rightBeat)
    .map(([beat, durationSeconds]) => {
      const startSeconds = resolver.beatToSeconds(beat);
      return {
        beat,
        startSeconds,
        endSeconds: startSeconds + durationSeconds,
        durationSeconds,
      } satisfies StopBeatWindow;
    });
}

function secondsToBeatWithoutStops(
  tempoPoints: ReadonlyArray<{ beat: number; bpm: number; seconds: number }>,
  seconds: number,
): number {
  if (tempoPoints.length === 0 || seconds <= 0) {
    return 0;
  }

  let low = 0;
  let high = tempoPoints.length - 1;
  let index = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const point = tempoPoints[mid];
    if (point.seconds <= seconds) {
      index = mid;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  const point = tempoPoints[index];
  const elapsed = Math.max(0, seconds - point.seconds);
  return point.beat + (elapsed * point.bpm) / 60;
}

function createMeasureBoundariesBeats(json: BmsJson, beatResolver: ReturnType<typeof createBeatResolver>): number[] {
  const maxEventMeasure = json.events.reduce((max, event) => Math.max(max, event.measure), 0);
  const maxDefinedMeasure = json.measures.reduce((max, measure) => Math.max(max, measure.index), 0);
  const maxMeasure = Math.max(0, maxEventMeasure, maxDefinedMeasure);
  const boundaries: number[] = [];
  let previous = Number.NaN;

  for (let measure = 0; measure <= maxMeasure + 1; measure += 1) {
    const beat = beatResolver.measureToBeat(measure, 0);
    if (!Number.isFinite(beat)) {
      continue;
    }
    if (Math.abs(beat - previous) < 1e-9) {
      continue;
    }
    boundaries.push(beat);
    previous = beat;
  }

  return boundaries;
}

function estimateBgaAnsiDisplaySize(bindings: LaneBinding[]): { width: number; height: number } {
  const laneWidths = bindings.map((binding) =>
    binding.channel === '16' || binding.channel === '26' ? WIDE_SCRATCH_LANE_WIDTH : DEFAULT_LANE_WIDTH,
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

function printLaneMap(bindings: LaneBinding[]): void {
  process.stdout.write('Channel map:\n');
  for (const binding of bindings) {
    process.stdout.write(`  ${binding.channel} => ${binding.keyLabel}\n`);
  }
}

function formatSeconds(seconds: number): string {
  return seconds.toFixed(3);
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
      `GREAT  : ${summary.great}`,
      `GOOD   : ${summary.good}`,
      `BAD    : ${summary.bad}`,
      `MISS   : ${summary.miss}`,
      `EX-SCORE: ${summary.exScore} / ${maxExScore} (${(exScoreRate * 100).toFixed(2)}%)`,
      `SCORE   : ${summary.score} / ${IIDX_SCORE_MAX} (${(scoreRate * 100).toFixed(2)}%)`,
    ].join('\n') + '\n'
  );
}

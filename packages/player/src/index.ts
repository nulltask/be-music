import { basename, dirname, resolve } from 'node:path';
import readline from 'node:readline';
import { setImmediate as delayImmediate, setTimeout as delay } from 'node:timers/promises';
import {
  createEmptyJson,
  eventToBeat,
  measureToBeat,
  type BmsEvent,
  type BmsJson,
  isPlayableChannel,
  normalizeChannel,
  normalizeObjectKey,
  sortEvents,
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
  miss: number;
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

  /**
   * constructor に対応する処理を実行します。
   * @param reason - 中断要因。
   * @returns 戻り値はありません。
   */
  constructor(reason: PlayerInterruptReason) {
    super(`Player interrupted: ${reason}`);
    this.reason = reason;
    this.exitCode = reason === 'ctrl-c' ? 130 : 0;
  }
}

interface TimedPlayableNote {
  event: BmsEvent;
  channel: string;
  beat: number;
  endBeat?: number;
  endSeconds?: number;
  visibleUntilBeat?: number;
  seconds: number;
  judged: boolean;
}

interface LaneBinding {
  channel: string;
  keyLabel: string;
  inputTokens: string[];
  side: '1P' | '2P' | 'OTHER';
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
const MANUAL_AUDIO_CHUNK_FRAMES = 64;
const MANUAL_AUDIO_TARGET_LEAD_MS = 8;
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

const KEY_LAYOUT = [
  'a',
  's',
  'd',
  'f',
  'g',
  'h',
  'j',
  'k',
  'l',
  ';',
  'q',
  'w',
  'e',
  'r',
  'u',
  'i',
  'o',
  'p',
  'z',
  'x',
  'c',
  'v',
  'b',
  'n',
  'm',
  ',',
  '.',
  '/',
];

const FIXED_BINDINGS: Array<{
  channel: string;
  keyLabel: string;
  inputTokens: string[];
  side: '1P' | '2P';
}> = [
  { channel: '16', keyLabel: 'Ctrl', inputTokens: ['ctrl', 'control'], side: '1P' },
  { channel: '11', keyLabel: 'z', inputTokens: ['z'], side: '1P' },
  { channel: '12', keyLabel: 's', inputTokens: ['s'], side: '1P' },
  { channel: '13', keyLabel: 'x', inputTokens: ['x'], side: '1P' },
  { channel: '14', keyLabel: 'd', inputTokens: ['d'], side: '1P' },
  { channel: '15', keyLabel: 'c', inputTokens: ['c'], side: '1P' },
  { channel: '18', keyLabel: 'f', inputTokens: ['f'], side: '1P' },
  { channel: '19', keyLabel: 'v', inputTokens: ['v'], side: '1P' },
  { channel: '21', keyLabel: ',', inputTokens: [','], side: '2P' },
  { channel: '22', keyLabel: 'l', inputTokens: ['l'], side: '2P' },
  { channel: '23', keyLabel: '.', inputTokens: ['.'], side: '2P' },
  { channel: '24', keyLabel: ';', inputTokens: [';'], side: '2P' },
  { channel: '25', keyLabel: '/', inputTokens: ['/'], side: '2P' },
  { channel: '28', keyLabel: ':', inputTokens: [':'], side: '2P' },
  { channel: '29', keyLabel: '_', inputTokens: ['_'], side: '2P' },
  { channel: '26', keyLabel: 'Enter', inputTokens: ['enter', 'return'], side: '2P' },
];

/**
 * 非同期で再生処理を実行し、結果を返します。
 * @param filePath - 対象ファイルまたはディレクトリのパス。
 * @param options - 動作を制御するオプション。
 * @returns 非同期処理完了後の結果（PlayerSummary）を解決する Promise。
 */
export async function playChartFile(filePath: string, options: PlayerOptions = {}): Promise<PlayerSummary> {
  const json = await parseChartFile(filePath);
  const mergedOptions: PlayerOptions = {
    ...options,
    audioBaseDir: options.audioBaseDir ?? dirname(resolve(filePath)),
  };
  return mergedOptions.auto ? autoPlay(json, mergedOptions) : manualPlay(json, mergedOptions);
}

/**
 * extract Playable Notes に対応する処理を実行します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @returns 処理結果の配列。
 */
export function extractPlayableNotes(json: BmsJson): TimedPlayableNote[] {
  const resolver = createTimingResolver(json);
  const notes = sortEvents(json.events)
    .filter((event) => isPlayableChannel(event.channel))
    .map((event) => {
      const beat = eventToBeat(json, event);
      const endBeat = resolveLongNoteEndBeat(json, event, beat);
      return {
        event,
        channel: normalizeChannel(event.channel),
        beat,
        endBeat,
        endSeconds: endBeat !== undefined ? resolver.beatToSeconds(endBeat) : undefined,
        seconds: resolver.eventToSeconds(event),
        judged: false,
      };
    })
    .sort((left, right) => left.seconds - right.seconds);

  applyLnobjEndBeatIfNeeded(json, notes, resolver);
  return notes;
}

/**
 * apply Lnobj End Beat If Needed に対応する処理を実行します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @param notes - notes に対応する入力値。
 * @param resolver - resolver に対応する入力値。
 * @returns 戻り値はありません。
 */
function applyLnobjEndBeatIfNeeded(
  json: BmsJson,
  notes: TimedPlayableNote[],
  resolver: ReturnType<typeof createTimingResolver>,
): void {
  if (json.sourceFormat !== 'bms') {
    return;
  }

  const lnObj =
    typeof json.bms.lnObj === 'string' && json.bms.lnObj.length > 0 ? normalizeObjectKey(json.bms.lnObj) : undefined;
  if (!lnObj) {
    return;
  }

  const pendingStartByChannel = new Map<string, TimedPlayableNote>();
  for (const note of notes) {
    const value = normalizeObjectKey(note.event.value);
    if (value === lnObj) {
      const start = pendingStartByChannel.get(note.channel);
      if (start && note.beat > start.beat) {
        start.endBeat = note.beat;
        start.endSeconds = resolver.beatToSeconds(note.beat);
      }
      pendingStartByChannel.delete(note.channel);
      continue;
    }
    pendingStartByChannel.set(note.channel, note);
  }
}

/**
 * ロード進捗を通知します。
 * @param options - 動作を制御するオプション。
 * @param ratio - 進捗率（0.0-1.0）。
 * @param message - 表示メッセージ。
 * @param detail - 追加詳細表示。
 * @returns 戻り値はありません。
 */
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

/**
 * サンプル読み込み進捗を表示用文字列に変換します。
 * @param progress - サンプル読み込み進捗。
 * @returns 変換後または整形後の文字列。
 */
function formatSampleLoadDetail(progress: RenderSampleLoadProgress): string {
  if (typeof progress.resolvedPath === 'string' && progress.resolvedPath.length > 0) {
    return basename(progress.resolvedPath);
  }
  if (typeof progress.samplePath === 'string' && progress.samplePath.length > 0) {
    return progress.samplePath;
  }
  return `#WAV${progress.sampleKey}`;
}

/**
 * 非同期でauto Play に対応する処理を実行します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @param options - 動作を制御するオプション。
 * @returns 非同期処理完了後の結果（PlayerSummary）を解決する Promise。
 */
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
    miss: 0,
  };
  let combo = 0;

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

  try {
    await delay(leadInMs);
    audioSession?.start();

    const startedAt = performance.now() + audioOffsetMs + (audioSession?.chartStartDelayMs ?? 0);
    for (const note of notes) {
      const scheduledMs = (note.seconds * 1000) / speed;

      while (true) {
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

      note.judged = true;
      summary.perfect += 1;
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

    tui?.render({
      currentBeat: beatAtSeconds(totalSeconds),
      currentSeconds: totalSeconds,
      totalSeconds,
      summary,
      notes,
      ...createBgaRenderFrame(bgaRenderer, totalSeconds, preferSixel),
    });
  } finally {
    await audioSession?.finish();
    tui?.stop();
    await audioSession?.dispose();
  }

  process.stdout.write(renderSummary(summary));
  return summary;
}

/**
 * 非同期でmanual Play に対応する処理を実行します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @param options - 動作を制御するオプション。
 * @returns 非同期処理完了後の結果（PlayerSummary）を解決する Promise。
 */
export async function manualPlay(json: BmsJson, options: PlayerOptions = {}): Promise<PlayerSummary> {
  reportLoadProgress(options, 0.02, 'Resolving chart...');
  const resolvedJson = resolveBmsControlFlow(json);
  const speed = options.speed ?? 1;
  const judgeWindowMs = options.judgeWindowMs ?? 120;
  const leadInMs = options.leadInMs ?? 1500;
  const audioOffsetMs = options.audioOffsetMs ?? 0;
  const beatAtSeconds = createBeatAtSecondsResolver(resolvedJson);

  const notes = extractPlayableNotes(resolvedJson);
  const totalSeconds = notes.at(-1)?.seconds ?? 0;
  const channels = [...new Set(notes.map((note) => note.channel))];
  const laneBindings = createLaneBindings(channels);
  const inputTokenToChannels = createInputTokenToChannelsMap(laneBindings);

  const summary: PlayerSummary = {
    total: notes.length,
    perfect: 0,
    great: 0,
    good: 0,
    miss: 0,
  };
  let combo = 0;

  reportLoadProgress(options, 0.18, 'Preparing BGA...');
  const tui = createTuiIfEnabled(resolvedJson, options, 'MANUAL', laneBindings, speed, judgeWindowMs);
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
    process.stdout.write(`Judge window: +/-${judgeWindowMs}ms\n`);
    process.stdout.write('Press Ctrl+C or Esc to quit.\n');
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
      notes,
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
  const horizon = ((notes.at(-1)?.seconds ?? 0) * 1000) / speed + leadInMs + judgeWindowMs + 1000;
  let interruptedReason: PlayerInterruptReason | undefined;
  const longHoldUntilMsByChannel = new Map<string, number>();
  const activeLongNotesByChannel = new Map<string, { endSeconds: number }>();
  const longNoteSuppressUntilSecondsByChannel = new Map<string, number>();

  /**
   * stop Input Capture に対応する処理を実行します。
   * @returns 戻り値はありません。
   */
  const stopInputCapture = () => {
    process.stdin.removeListener('keypress', onKeyPress);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  };

  /**
   * on Key Press に対応する処理を実行します。
   * @param chunk - キー入力から取得した文字列チャンク。
   * @param key - キー入力イベント情報。
   * @returns 戻り値はありません。
   */
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

    const candidate = findBestCandidate(notes, candidateChannels, nowSec, judgeWindowMs / 1000);

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
    if (deltaMs <= 30) {
      summary.perfect += 1;
      combo += 1;
      if (!tui) {
        process.stdout.write(`PERFECT channel:${channel} delta:${Math.round(deltaMs)}ms\n`);
      } else {
        tui.setLatestJudge('PERFECT');
        tui.setCombo(combo);
      }
      return;
    }
    if (deltaMs <= 70) {
      summary.great += 1;
      combo += 1;
      if (!tui) {
        process.stdout.write(`GREAT channel:${channel} delta:${Math.round(deltaMs)}ms\n`);
      } else {
        tui.setLatestJudge('GOOD');
        tui.setCombo(combo);
      }
      return;
    }

    summary.good += 1;
    combo += 1;
    if (!tui) {
      process.stdout.write(`GOOD channel:${channel} delta:${Math.round(deltaMs)}ms\n`);
    } else {
      tui.setLatestJudge('GOOD');
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
        if (nowSec - note.seconds > judgeWindowMs / 1000) {
          note.judged = true;
          summary.miss += 1;
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
        notes,
        ...createBgaRenderFrame(bgaRenderer, nowSec, preferSixel),
      });

      if (notes.every((note) => note.judged)) {
        break;
      }

      await waitPrecise(TUI_FRAME_INTERVAL_MS);
    }

    if (!interruptedReason) {
      const judgedCount = summary.perfect + summary.great + summary.good + summary.miss;
      if (judgedCount < summary.total) {
        summary.miss += summary.total - judgedCount;
        combo = 0;
        if (tui) {
          tui.setLatestJudge('MISS');
          tui.setCombo(combo);
          tui.render({
            currentBeat: beatAtSeconds(totalSeconds),
            currentSeconds: totalSeconds,
            totalSeconds,
            summary,
            notes,
            ...createBgaRenderFrame(bgaRenderer, totalSeconds, preferSixel),
          });
        }
      }
    }
  } finally {
    stopInputCapture();
    tui?.stop();
    if (interruptedReason) {
      await audioSession?.dispose();
    } else {
      await audioSession?.finish();
      await audioSession?.dispose();
    }
  }

  if (interruptedReason) {
    throw new PlayerInterruptedError(interruptedReason);
  }

  process.stdout.write(renderSummary(summary));
  return summary;
}

/**
 * 条件に一致する要素を探索して返します。
 * @param notes - notes に対応する入力値。
 * @param candidateChannels - candidateChannels に対応する入力値。
 * @param nowSec - nowSec に対応する入力値。
 * @param judgeWindowSec - judgeWindowSec に対応する入力値。
 * @returns 処理結果（TimedPlayableNote | undefined）。
 */
function findBestCandidate(
  notes: TimedPlayableNote[],
  candidateChannels: ReadonlySet<string>,
  nowSec: number,
  judgeWindowSec: number,
): TimedPlayableNote | undefined {
  let best: TimedPlayableNote | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const note of notes) {
    if (note.judged || !candidateChannels.has(note.channel)) {
      continue;
    }
    const delta = Math.abs(note.seconds - nowSec);
    if (delta > judgeWindowSec) {
      continue;
    }
    if (delta < bestDelta) {
      bestDelta = delta;
      best = note;
    }
  }

  return best;
}

/**
 * 条件に一致する要素を探索して返します。
 * @param notes - notes に対応する入力値。
 * @param candidateChannels - candidateChannels に対応する入力値。
 * @param nowSec - nowSec に対応する入力値。
 * @returns 処理結果（TimedPlayableNote | undefined）。
 */
function findLaneSoundCandidate(
  notes: TimedPlayableNote[],
  candidateChannels: ReadonlySet<string>,
  nowSec: number,
): TimedPlayableNote | undefined {
  let nearestUnjudged: TimedPlayableNote | undefined;
  let nearestUnjudgedDelta = Number.POSITIVE_INFINITY;
  let nearestAny: TimedPlayableNote | undefined;
  let nearestAnyDelta = Number.POSITIVE_INFINITY;

  for (const note of notes) {
    if (!candidateChannels.has(note.channel)) {
      continue;
    }

    const delta = Math.abs(note.seconds - nowSec);
    if (delta < nearestAnyDelta) {
      nearestAnyDelta = delta;
      nearestAny = note;
    }

    if (note.judged) {
      continue;
    }
    if (delta < nearestUnjudgedDelta) {
      nearestUnjudgedDelta = delta;
      nearestUnjudged = note;
    }
  }

  return nearestUnjudged ?? nearestAny;
}

/**
 * 処理に必要な初期データを生成します。
 * @param channels - channels に対応する入力値。
 * @returns 処理結果の配列。
 */
function createLaneBindings(channels: string[]): LaneBinding[] {
  const existing = new Set(channels.map((channel) => normalizeChannel(channel)));
  const bindings: LaneBinding[] = [];
  const usedTokens = new Set<string>();

  for (const definition of FIXED_BINDINGS) {
    if (!existing.has(definition.channel)) {
      continue;
    }
    bindings.push({
      channel: definition.channel,
      keyLabel: definition.keyLabel,
      inputTokens: [...definition.inputTokens],
      side: definition.side,
    });
    definition.inputTokens.forEach((token) => usedTokens.add(token));
  }

  const unknownChannels = [...existing].filter(
    (channel) => !FIXED_BINDINGS.some((definition) => definition.channel === channel),
  );
  unknownChannels.sort();

  let fallbackIndex = 0;
  for (const channel of unknownChannels) {
    let token = KEY_LAYOUT[fallbackIndex] ?? `f${fallbackIndex + 1}`;
    while (usedTokens.has(token)) {
      fallbackIndex += 1;
      token = KEY_LAYOUT[fallbackIndex] ?? `f${fallbackIndex + 1}`;
    }
    fallbackIndex += 1;
    usedTokens.add(token);
    bindings.push({
      channel,
      keyLabel: token,
      inputTokens: [token],
      side: 'OTHER',
    });
  }

  return bindings;
}

/**
 * 処理に必要な初期データを生成します。
 * @param bindings - bindings に対応する入力値。
 * @returns 処理結果（Map<string, string[]>）。
 */
function createInputTokenToChannelsMap(bindings: LaneBinding[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const binding of bindings) {
    for (const token of binding.inputTokens) {
      const normalized = token.toLowerCase();
      const channels = map.get(normalized) ?? [];
      channels.push(binding.channel);
      map.set(normalized, channels);
    }
  }
  return map;
}

/**
 * 依存する値を解決し、確定値を返します。
 * @param chunk - キー入力から取得した文字列チャンク。
 * @param key - キー入力イベント情報。
 * @returns 処理結果の配列。
 */
function resolveInputTokens(chunk: string, key: readline.Key): string[] {
  const tokens = new Set<string>();
  const normalizedChunk = normalizeKey(chunk);
  if (normalizedChunk) {
    tokens.add(normalizedChunk);
  }

  if (isStandaloneShiftKeypress(chunk, key)) {
    tokens.add('shift');
    return [...tokens];
  }

  if (isStandaloneControlKeypress(chunk, key)) {
    tokens.add('ctrl');
    tokens.add('control');
    return [...tokens];
  }

  if (key.name) {
    const normalizedName = key.name.toLowerCase();
    tokens.add(normalizedName);
    if (normalizedName === 'return') {
      tokens.add('enter');
    } else if (normalizedName === 'enter') {
      tokens.add('return');
    } else if (normalizedName === 'ctrl') {
      tokens.add('control');
    } else if (normalizedName === 'control') {
      tokens.add('ctrl');
    }
  }

  return [...tokens];
}

/**
 * 条件判定を行い、真偽値を返します。
 * @param chunk - キー入力から取得した文字列チャンク。
 * @param key - キー入力イベント情報。
 * @returns 条件を満たす場合は `true`、それ以外は `false`。
 */
function isStandaloneShiftKeypress(chunk: string, key: readline.Key): boolean {
  if (key.name === 'shift') {
    return true;
  }

  const sequence = key.sequence ?? '';
  return chunk.length === 0 && sequence.length === 0 && Boolean(key.shift) && !key.ctrl && !key.meta && !key.name;
}

/**
 * 条件判定を行い、真偽値を返します。
 * @param chunk - キー入力から取得した文字列チャンク。
 * @param key - キー入力イベント情報。
 * @returns 条件を満たす場合は `true`、それ以外は `false`。
 */
function isStandaloneControlKeypress(chunk: string, key: readline.Key): boolean {
  if (key.name === 'ctrl' || key.name === 'control') {
    return true;
  }

  const sequence = key.sequence ?? '';
  return chunk.length === 0 && sequence.length === 0 && Boolean(key.ctrl) && !key.shift && !key.meta && !key.name;
}

/**
 * 処理に必要な初期データを生成します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @param options - 動作を制御するオプション。
 * @param mode - mode に対応する入力値。
 * @param laneBindings - laneBindings に対応する入力値。
 * @param speed - speed に対応する入力値。
 * @param judgeWindowMs - judgeWindowMs に対応する入力値。
 * @returns 処理結果（PlayerTui | undefined）。
 */
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
  const measureTimeline = createMeasureTimeline(json);
  const bpmTimeline = createBpmTimeline(json);
  const measureBoundariesBeats = createMeasureBoundariesBeats(json);
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

/**
 * 処理に必要な初期データを生成します。
 * @param bgaRenderer - bgaRenderer に対応する入力値。
 * @param currentSeconds - currentSeconds に対応する入力値。
 * @param preferSixel - preferSixel に対応する入力値。
 * @returns 処理結果（{ bgaAnsiLines?: string[]; bgaSixel?: string }）。
 */
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

/**
 * estimate Sixel Scale For Current Terminal に対応する処理を実行します。
 * @returns 処理結果（{ x: number; y: number }）。
 */
function estimateSixelScaleForCurrentTerminal(): { x: number; y: number } {
  const columns = process.stdout.columns ?? DEFAULT_TERMINAL_COLUMNS;
  const rows = process.stdout.rows ?? DEFAULT_GRID_ROWS + STATIC_TUI_LINES;
  const baseRows = DEFAULT_GRID_ROWS + STATIC_TUI_LINES;
  const x = clampInt(Math.round((columns / DEFAULT_TERMINAL_COLUMNS) * 8), 4, 24);
  const y = clampInt(Math.round((rows / baseRows) * 16), 8, 48);
  return { x, y };
}

/**
 * 非同期で処理に必要な初期データを生成します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @param options - 動作を制御するオプション。
 * @param mode - mode に対応する入力値。
 * @returns 非同期処理完了後の結果（AudioSession | undefined）を解決する Promise。
 */
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

  /**
   * 非同期でfinish に対応する処理を実行します。
   * @returns 戻り値はありません。
   */
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

  /**
   * 非同期でdispose に対応する処理を実行します。
   * @returns 戻り値はありません。
   */
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

/**
 * 非同期で再生処理を実行し、結果を返します。
 * @param params - params に対応する入力値。
 * @returns 戻り値はありません。
 */
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
  const chunk = Buffer.allocUnsafe(chunkFrames * 4);
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
      let left = 0;
      let right = 0;

      const sourceFrame = playhead + frame;
      if (sourceFrame < background.left.length) {
        left += background.left[sourceFrame];
        right += background.right[sourceFrame];
      }

      for (const voice of activeVoices) {
        const voiceFrame = voice.position + frame;
        if (voiceFrame >= voice.endPosition) {
          continue;
        }
        left += voice.sample.left[voiceFrame];
        right += voice.sample.right[voiceFrame];
      }

      const offset = frame * 4;
      chunk.writeInt16LE(floatToInt16(left), offset);
      chunk.writeInt16LE(floatToInt16(right), offset + 2);
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

/**
 * 非同期でwait For Playback Realtime に対応する処理を実行します。
 * @param playheadFrames - playheadFrames に対応する入力値。
 * @param sampleRate - sampleRate に対応する入力値。
 * @param startMs - startMs に対応する入力値。
 * @param shouldStop - shouldStop に対応する入力値。
 * @returns 戻り値はありません。
 */
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

/**
 * strip Playable Events に対応する処理を実行します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @returns 処理結果（BmsJson）。
 */
function stripPlayableEvents(json: BmsJson): BmsJson {
  const cloned = structuredClone(json);
  cloned.events = cloned.events.filter((event) => !isPlayableChannel(event.channel));
  return cloned;
}

/**
 * strip Non Playable Events に対応する処理を実行します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @returns 処理結果（BmsJson）。
 */
function stripNonPlayableEvents(json: BmsJson): BmsJson {
  const cloned = structuredClone(json);
  cloned.events = cloned.events.filter((event) => isPlayableChannel(event.channel));
  return cloned;
}

/**
 * 非同期で描画または音声レンダリングを行い、結果を返します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @param bgmVolume - bgmVolume に対応する入力値。
 * @param options - 動作を制御するオプション。
 * @returns 非同期処理完了後の結果（RenderResult）を解決する Promise。
 */
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

/**
 * 非同期で派生情報を組み立てて返します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @param options - 動作を制御するオプション。
 * @param sampleRate - sampleRate に対応する入力値。
 * @returns 非同期処理完了後の結果（Map<string, RenderResult>）を解決する Promise。
 */
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

/**
 * 派生情報を組み立てて返します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @returns 処理結果（Map<BmsEvent, PlayableNotePlayback>）。
 */
function buildPlayableNotePlaybackMap(json: BmsJson): Map<BmsEvent, PlayableNotePlayback> {
  const playbackMap = new Map<BmsEvent, PlayableNotePlayback>();
  for (const trigger of collectSampleTriggers(json, createTimingResolver(json))) {
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

/**
 * 入力値を仕様に沿う正規形に整えます。
 * @param value - 処理対象の値。
 * @returns 計算結果の数値。
 */
function normalizeBgmVolume(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, value);
}

/**
 * apply Gain To Render Result に対応する処理を実行します。
 * @param result - result に対応する入力値。
 * @param gain - gain に対応する入力値。
 * @returns 処理結果（RenderResult）。
 */
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

/**
 * 入力値を仕様に沿う正規形に整えます。
 * @param result - result に対応する入力値。
 * @returns 処理結果（RenderResult）。
 */
function normalizeRenderResultIfNeeded(result: RenderResult): RenderResult {
  if (result.peak <= 1) {
    return result;
  }
  return applyGainToRenderResult(result, 1 / result.peak);
}

/**
 * mix Render Results に対応する処理を実行します。
 * @param leftResult - leftResult に対応する入力値。
 * @param rightResult - rightResult に対応する入力値。
 * @returns 処理結果（RenderResult）。
 */
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

/**
 * measure Render Peak に対応する処理を実行します。
 * @param left - 比較・演算対象の値。
 * @param right - 比較・演算対象の値。
 * @returns 計算結果の数値。
 */
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

/**
 * float To Int16 に対応する処理を実行します。
 * @param value - 処理対象の値。
 * @returns 計算結果の数値。
 */
function floatToInt16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  if (clamped >= 0) {
    return Math.round(clamped * 32767);
  }
  return Math.round(clamped * 32768);
}

/**
 * elapsed Ms To Game Seconds に対応する処理を実行します。
 * @param elapsedMs - elapsedMs に対応する入力値。
 * @param speed - speed に対応する入力値。
 * @returns 計算結果の数値。
 */
function elapsedMsToGameSeconds(elapsedMs: number, speed: number): number {
  return Math.max(0, (elapsedMs / 1000) * speed);
}

/**
 * 非同期でwait Precise に対応する処理を実行します。
 * @param delayMs - delayMs に対応する入力値。
 * @returns 戻り値はありません。
 */
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

/**
 * add Head Padding に対応する処理を実行します。
 * @param result - result に対応する入力値。
 * @param paddingMs - paddingMs に対応する入力値。
 * @returns 処理結果（RenderResult）。
 */
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

/**
 * to Playback Sample Rate に対応する処理を実行します。
 * @param baseSampleRate - baseSampleRate に対応する入力値。
 * @param speed - speed に対応する入力値。
 * @returns 計算結果の数値。
 */
function toPlaybackSampleRate(baseSampleRate: number, speed: number): number {
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const scaled = Math.round(baseSampleRate * safeSpeed);
  return Math.max(8_000, Math.min(192_000, scaled));
}

/**
 * 条件に一致する要素を探索して返します。
 * @param bindings - bindings に対応する入力値。
 * @param predicate - predicate に対応する入力値。
 * @returns 計算結果の数値。
 */
function findLastLaneIndex(bindings: LaneBinding[], predicate: (binding: LaneBinding) => boolean): number {
  for (let index = bindings.length - 1; index >= 0; index -= 1) {
    if (predicate(bindings[index])) {
      return index;
    }
  }
  return -1;
}

/**
 * 処理に必要な初期データを生成します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @returns 処理結果の配列。
 */
function createMeasureTimeline(json: BmsJson): MeasureTimelinePoint[] {
  const resolver = createTimingResolver(json);
  const maxEventMeasure = json.events.reduce((max, event) => Math.max(max, event.measure), 0);
  const maxDefinedMeasure = json.measures.reduce((max, measure) => Math.max(max, measure.index), 0);
  const maxMeasure = Math.max(0, maxEventMeasure, maxDefinedMeasure);
  const timeline: MeasureTimelinePoint[] = [];
  for (let measure = 0; measure <= maxMeasure + 1; measure += 1) {
    const seconds = resolver.beatToSeconds(measureToBeat(json, measure, 0));
    if (!Number.isFinite(seconds)) {
      continue;
    }
    timeline.push({ measure, seconds });
  }

  return timeline;
}

/**
 * 依存する値を解決し、確定値を返します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @param event - 処理対象のイベント。
 * @param beat - 拍位置（beat）を表す値。
 * @returns 処理結果（number | undefined）。
 */
function resolveLongNoteEndBeat(json: BmsJson, event: BmsEvent, beat: number): number | undefined {
  const length = event.bmson?.l;
  if (typeof length !== 'number' || !Number.isFinite(length) || length <= 0) {
    return undefined;
  }

  const resolution =
    typeof json.bmson.info.resolution === 'number' && Number.isFinite(json.bmson.info.resolution)
      ? json.bmson.info.resolution
      : 240;
  if (resolution <= 0) {
    return undefined;
  }

  return beat + length / resolution;
}

/**
 * 処理に必要な初期データを生成します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @returns 処理結果の配列。
 */
function createBpmTimeline(json: BmsJson): BpmTimelinePoint[] {
  const resolver = createTimingResolver(json);
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

/**
 * 処理に必要な初期データを生成します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @returns 処理結果（(seconds: number) => number）。
 */
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

/**
 * 処理に必要な初期データを生成します。
 * @param resolver - resolver に対応する入力値。
 * @returns 処理結果の配列。
 */
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

/**
 * seconds To Beat Without Stops に対応する処理を実行します。
 * @param tempoPoints - tempoPoints に対応する入力値。
 * @param seconds - 秒単位の時刻または長さ。
 * @returns 計算結果の数値。
 */
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

/**
 * 処理に必要な初期データを生成します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @returns 処理結果の配列。
 */
function createMeasureBoundariesBeats(json: BmsJson): number[] {
  const maxEventMeasure = json.events.reduce((max, event) => Math.max(max, event.measure), 0);
  const maxDefinedMeasure = json.measures.reduce((max, measure) => Math.max(max, measure.index), 0);
  const maxMeasure = Math.max(0, maxEventMeasure, maxDefinedMeasure);
  const boundaries: number[] = [];
  let previous = Number.NaN;

  for (let measure = 0; measure <= maxMeasure + 1; measure += 1) {
    const beat = measureToBeat(json, measure, 0);
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

/**
 * estimate Bga Ansi Display Size に対応する処理を実行します。
 * @param bindings - bindings に対応する入力値。
 * @returns 処理結果（{ width: number; height: number }）。
 */
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

/**
 * print Lane Map に対応する処理を実行します。
 * @param bindings - bindings に対応する入力値。
 * @returns 戻り値はありません。
 */
function printLaneMap(bindings: LaneBinding[]): void {
  process.stdout.write('Channel map:\n');
  for (const binding of bindings) {
    process.stdout.write(`  ${binding.channel} => ${binding.keyLabel}\n`);
  }
}

/**
 * 表示・出力に適した形式へ整形します。
 * @param seconds - 秒単位の時刻または長さ。
 * @returns 変換後または整形後の文字列。
 */
function formatSeconds(seconds: number): string {
  return seconds.toFixed(3);
}

/**
 * 入力値を仕様に沿う正規形に整えます。
 * @param value - 処理対象の値。
 * @returns 変換後または整形後の文字列。
 */
function normalizeKey(value: string): string {
  return value.length === 1 ? value.toLowerCase() : value;
}

/**
 * 描画または音声レンダリングを行い、結果を返します。
 * @param summary - summary に対応する入力値。
 * @returns 変換後または整形後の文字列。
 */
function renderSummary(summary: PlayerSummary): string {
  const score =
    summary.total === 0 ? 0 : (summary.perfect * 1 + summary.great * 0.7 + summary.good * 0.4) / summary.total;
  return (
    [
      '--- Result ---',
      `TOTAL  : ${summary.total}`,
      `PERFECT: ${summary.perfect}`,
      `GREAT  : ${summary.great}`,
      `GOOD   : ${summary.good}`,
      `MISS   : ${summary.miss}`,
      `SCORE  : ${(score * 100).toFixed(2)}%`,
    ].join('\n') + '\n'
  );
}

import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, resolve } from 'node:path';
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis';
import { MPEGDecoder } from 'mpg123-decoder';
import { OggOpusDecoder } from 'ogg-opus-decoder';
import {
  DEFAULT_BPM,
  eventToBeat,
  isSampleTriggerChannel,
  normalizeChannel,
  normalizeObjectKey,
  parseBpmFrom03Token,
  sortEvents,
  type BmsEvent,
  type BmsJson,
} from '@be-music/json';
import { parseChartFile, resolveBmsControlFlow } from '@be-music/parser';
import { clampSignedUnit } from '@be-music/utils';
export interface TempoPoint {
  beat: number;
  bpm: number;
  seconds: number;
}

export interface StopPoint {
  beat: number;
  seconds: number;
  cumulativeSeconds: number;
}

export interface TimingResolver {
  tempoPoints: TempoPoint[];
  stopPoints: StopPoint[];
  beatToSeconds: (beat: number) => number;
  eventToSeconds: (event: BmsEvent) => number;
  bpmAtBeat: (beat: number) => number;
}

export interface TimedSampleTrigger {
  event: BmsEvent;
  beat: number;
  seconds: number;
  channel: string;
  sampleKey: string;
  samplePath?: string;
  sampleOffsetSeconds: number;
  sampleDurationSeconds?: number;
  sampleSliceId?: string;
}

export interface RenderOptions {
  sampleRate?: number;
  normalize?: boolean;
  tailSeconds?: number;
  gain?: number;
  baseDir?: string;
  fallbackToneSeconds?: number;
  onSampleLoadProgress?: (progress: RenderSampleLoadProgress) => void;
}

export interface RenderSampleLoadProgress {
  stage: 'resolving' | 'reading' | 'decoded' | 'cached' | 'fallback';
  sampleKey: string;
  samplePath?: string;
  resolvedPath?: string;
}

export interface RenderResult {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  durationSeconds: number;
  peak: number;
}

interface StereoSample {
  left: Float32Array;
  right: Float32Array;
}

interface DecodedAudio {
  sampleRate: number;
  left: Float32Array;
  right?: Float32Array;
}

const DEFAULT_SAMPLE_RATE = 44_100;
const DEFAULT_TAIL_SECONDS = 2;
const DEFAULT_GAIN = 0.9;
const MPG123_SUPPRESSED_LOG_PATTERNS = [
  /\bcoreaudio\.c:\d+\]\s*warning:\s*didn't have any audio data in callback \(buffer underflow\)/i,
];

/**
 * 処理に必要な初期データを生成します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @returns 処理結果（TimingResolver）。
 */
export function createTimingResolver(json: BmsJson): TimingResolver {
  const tempoPoints = createTempoPoints(json);
  const stopPoints = createStopPoints(json, tempoPoints);

  /**
   * beat To Seconds Without Stops に対応する処理を実行します。
   * @param beat - 拍位置（beat）を表す値。
   * @returns 計算結果の数値。
   */
  const beatToSecondsWithoutStops = (beat: number): number => {
    if (beat <= 0 || tempoPoints.length === 0) {
      return 0;
    }

    const index = findLastIndex(tempoPoints, (point) => point.beat <= beat);
    const point = tempoPoints[Math.max(0, index)];
    const deltaBeat = beat - point.beat;
    return point.seconds + (deltaBeat * 60) / point.bpm;
  };

  /**
   * bpm At Beat に対応する処理を実行します。
   * @param beat - 拍位置（beat）を表す値。
   * @returns 計算結果の数値。
   */
  const bpmAtBeat = (beat: number): number => {
    if (tempoPoints.length === 0) {
      return json.metadata.bpm > 0 ? json.metadata.bpm : DEFAULT_BPM;
    }
    const index = findLastIndex(tempoPoints, (point) => point.beat <= beat);
    return tempoPoints[Math.max(0, index)].bpm;
  };

  /**
   * beat To Seconds に対応する処理を実行します。
   * @param beat - 拍位置（beat）を表す値。
   * @returns 計算結果の数値。
   */
  const beatToSeconds = (beat: number): number => {
    const base = beatToSecondsWithoutStops(beat);
    if (stopPoints.length === 0) {
      return base;
    }
    const index = findLastIndex(stopPoints, (point) => point.beat < beat);
    if (index < 0) {
      return base;
    }
    return base + stopPoints[index].cumulativeSeconds;
  };

  return {
    tempoPoints,
    stopPoints,
    bpmAtBeat,
    beatToSeconds,
    eventToSeconds: (event) => beatToSeconds(eventToBeat(json, event)),
  };
}

/**
 * 条件に一致する要素を収集します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @param resolver - resolver に対応する入力値。
 * @returns 処理結果の配列。
 */
export function collectSampleTriggers(json: BmsJson, resolver = createTimingResolver(json)): TimedSampleTrigger[] {
  const events = sortEvents(json.events).filter((event) => isSampleTriggerChannel(event.channel));
  const bmsonPlaybackMap =
    json.sourceFormat === 'bmson' ? createBmsonSamplePlaybackMap(json, resolver, events) : undefined;

  return events.map((event) => {
    const sampleKey = normalizeObjectKey(event.value);
    const playback = bmsonPlaybackMap?.get(event);
    return {
      event,
      beat: eventToBeat(json, event),
      seconds: resolver.eventToSeconds(event),
      channel: normalizeChannel(event.channel),
      sampleKey,
      samplePath: json.resources.wav[sampleKey],
      sampleOffsetSeconds: playback?.offsetSeconds ?? 0,
      sampleDurationSeconds: playback?.durationSeconds,
      sampleSliceId: playback?.sliceId,
    } satisfies TimedSampleTrigger;
  });
}

/**
 * 非同期で描画または音声レンダリングを行い、結果を返します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @param options - 動作を制御するオプション。
 * @returns 非同期処理完了後の結果（RenderResult）を解決する Promise。
 */
export async function renderJson(json: BmsJson, options: RenderOptions = {}): Promise<RenderResult> {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const normalize = options.normalize ?? true;
  const tailSeconds = options.tailSeconds ?? DEFAULT_TAIL_SECONDS;
  const gain = options.gain ?? DEFAULT_GAIN;
  const fallbackToneSeconds = options.fallbackToneSeconds ?? 0.08;
  const baseDir = options.baseDir ?? process.cwd();
  const onSampleLoadProgress = options.onSampleLoadProgress;

  const resolver = createTimingResolver(json);
  const triggers = collectSampleTriggers(json, resolver);

  const loadedSamples = new Map<string, StereoSample>();
  const resolvedPathCache = new Map<string, string | undefined>();

  const scheduled: Array<{
    start: number;
    sample: StereoSample;
    sampleOffsetFrames: number;
    sampleMaxFrames?: number;
  }> = [];
  const bmsonScheduledSlices = new Set<string>();
  const latestBmsScheduleBySampleKey = new Map<string, number>();
  let maxFrame = Math.max(1, Math.round(tailSeconds * sampleRate));

  for (const trigger of triggers) {
    const sample = await getOrCreateSample({
      sampleKey: trigger.sampleKey,
      samplePath: trigger.samplePath,
      sampleRate,
      baseDir,
      fallbackToneSeconds,
      loadedSamples,
      resolvedPathCache,
      onSampleLoadProgress,
    });

    const sampleOffsetFrames = Math.max(0, Math.round(trigger.sampleOffsetSeconds * sampleRate));
    const availableFrames = sample.left.length - sampleOffsetFrames;
    if (availableFrames <= 0) {
      continue;
    }
    const requestedDurationFrames =
      typeof trigger.sampleDurationSeconds === 'number' && Number.isFinite(trigger.sampleDurationSeconds)
        ? Math.max(1, Math.round(trigger.sampleDurationSeconds * sampleRate))
        : undefined;
    const sampleMaxFrames =
      requestedDurationFrames === undefined ? availableFrames : Math.min(availableFrames, requestedDurationFrames);
    if (sampleMaxFrames <= 0) {
      continue;
    }

    const start = Math.max(0, Math.round(trigger.seconds * sampleRate));
    if (json.sourceFormat === 'bmson' && trigger.sampleSliceId) {
      const dedupeKey = `${trigger.sampleSliceId}@${start}`;
      if (bmsonScheduledSlices.has(dedupeKey)) {
        continue;
      }
      bmsonScheduledSlices.add(dedupeKey);
    }
    if (json.sourceFormat === 'bms') {
      const previousIndex = latestBmsScheduleBySampleKey.get(trigger.sampleKey);
      if (previousIndex !== undefined) {
        const previous = scheduled[previousIndex];
        const maxFramesUntilRetrigger = Math.max(0, start - previous.start);
        const currentPreviousMaxFrames =
          previous.sampleMaxFrames ?? previous.sample.left.length - previous.sampleOffsetFrames;
        previous.sampleMaxFrames = Math.min(currentPreviousMaxFrames, maxFramesUntilRetrigger);
      }
    }

    const scheduleIndex = scheduled.push({ start, sample, sampleOffsetFrames, sampleMaxFrames }) - 1;
    if (json.sourceFormat === 'bms') {
      latestBmsScheduleBySampleKey.set(trigger.sampleKey, scheduleIndex);
    }
    maxFrame = Math.max(maxFrame, start + sampleMaxFrames + Math.round(tailSeconds * sampleRate));
  }

  const left = new Float32Array(maxFrame);
  const right = new Float32Array(maxFrame);

  for (const item of scheduled) {
    mixSample(left, right, item.sample, item.start, gain, item.sampleOffsetFrames, item.sampleMaxFrames);
  }

  const peak = measurePeak(left, right);
  if (normalize && peak > 1) {
    const scale = 1 / peak;
    scalePcm(left, scale);
    scalePcm(right, scale);
  }

  return {
    sampleRate,
    left,
    right,
    durationSeconds: left.length / sampleRate,
    peak: normalize && peak > 1 ? 1 : peak,
  };
}

/**
 * 非同期で描画または音声レンダリングを行い、結果を返します。
 * @param inputPath - 対象ファイルまたはディレクトリのパス。
 * @param outputPath - 対象ファイルまたはディレクトリのパス。
 * @param options - 動作を制御するオプション。
 * @returns 非同期処理完了後の結果（RenderResult）を解決する Promise。
 */
export async function renderChartFile(
  inputPath: string,
  outputPath: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const chartPath = resolve(inputPath);
  const json = resolveBmsControlFlow(await parseChartFile(chartPath));
  const audioRendered = await renderJson(json, {
    ...options,
    baseDir: options.baseDir ?? dirname(chartPath),
  });
  await writeAudioFile(outputPath, audioRendered);
  return audioRendered;
}

/**
 * 非同期で指定先へデータを書き込みます。
 * @param outputPath - 対象ファイルまたはディレクトリのパス。
 * @param result - result に対応する入力値。
 * @returns 戻り値はありません。
 */
export async function writeAudioFile(outputPath: string, result: RenderResult): Promise<void> {
  const destination = resolve(outputPath);
  const format = detectAudioFormat(destination);
  const encoded = format === 'aiff' ? encodeAiff16(result) : encodeWav16(result);
  await writeFile(destination, encoded);
}

/**
 * 処理に必要な初期データを生成します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @returns 処理結果の配列。
 */
function createTempoPoints(json: BmsJson): TempoPoint[] {
  const baseBpm = json.metadata.bpm > 0 ? json.metadata.bpm : DEFAULT_BPM;
  const points: TempoPoint[] = [{ beat: 0, bpm: baseBpm, seconds: 0 }];

  const changes = sortEvents(json.events)
    .map((event) => {
      const channel = normalizeChannel(event.channel);
      const beat = eventToBeat(json, event);
      if (channel === '03') {
        const bpm = parseBpmFrom03Token(event.value);
        if (bpm > 0) {
          return { beat, bpm };
        }
      }
      if (channel === '08') {
        const bpm = json.resources.bpm[normalizeObjectKey(event.value)];
        if (typeof bpm === 'number' && bpm > 0) {
          return { beat, bpm };
        }
      }
      return undefined;
    })
    .filter((value): value is { beat: number; bpm: number } => value !== undefined)
    .sort((left, right) => left.beat - right.beat);

  for (const change of changes) {
    const last = points[points.length - 1];
    if (change.beat < last.beat) {
      continue;
    }

    if (Math.abs(change.beat - last.beat) < 1e-9) {
      last.bpm = change.bpm;
      continue;
    }

    const seconds = last.seconds + ((change.beat - last.beat) * 60) / last.bpm;
    points.push({
      beat: change.beat,
      bpm: change.bpm,
      seconds,
    });
  }

  return points;
}

/**
 * 処理に必要な初期データを生成します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @param tempoPoints - tempoPoints に対応する入力値。
 * @returns 処理結果の配列。
 */
function createStopPoints(json: BmsJson, tempoPoints: TempoPoint[]): StopPoint[] {
  const stopEvents = sortEvents(json.events)
    .filter((event) => normalizeChannel(event.channel) === '09')
    .map((event) => {
      const beat = eventToBeat(json, event);
      const duration = json.resources.stop[normalizeObjectKey(event.value)];
      if (typeof duration !== 'number' || duration <= 0) {
        return undefined;
      }
      const bpm = bpmAtBeatFromTempoPoints(tempoPoints, beat);
      const seconds = (duration / 192) * (60 / bpm);
      return { beat, seconds };
    })
    .filter((value): value is { beat: number; seconds: number } => value !== undefined)
    .sort((left, right) => left.beat - right.beat);

  const points: StopPoint[] = [];
  let cumulativeSeconds = 0;
  for (const stopEvent of stopEvents) {
    cumulativeSeconds += stopEvent.seconds;
    points.push({
      beat: stopEvent.beat,
      seconds: stopEvent.seconds,
      cumulativeSeconds,
    });
  }
  return points;
}

/**
 * bpm At Beat From Tempo Points に対応する処理を実行します。
 * @param tempoPoints - tempoPoints に対応する入力値。
 * @param beat - 拍位置（beat）を表す値。
 * @returns 計算結果の数値。
 */
function bpmAtBeatFromTempoPoints(tempoPoints: TempoPoint[], beat: number): number {
  if (tempoPoints.length === 0) {
    return DEFAULT_BPM;
  }
  const index = findLastIndex(tempoPoints, (point) => point.beat <= beat);
  return tempoPoints[Math.max(0, index)].bpm;
}

/**
 * 条件に一致する要素を探索して返します。
 * @param items - items に対応する入力値。
 * @param predicate - predicate に対応する入力値。
 * @returns 計算結果の数値。
 */
function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  let low = 0;
  let high = items.length - 1;
  let answer = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (predicate(items[mid])) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return answer;
}

/**
 * 非同期でget Or Create Sample に対応する処理を実行します。
 * @param params - params に対応する入力値。
 * @returns 非同期処理完了後の結果（StereoSample）を解決する Promise。
 */
async function getOrCreateSample(params: {
  sampleKey: string;
  samplePath?: string;
  sampleRate: number;
  baseDir: string;
  fallbackToneSeconds: number;
  loadedSamples: Map<string, StereoSample>;
  resolvedPathCache: Map<string, string | undefined>;
  onSampleLoadProgress?: (progress: RenderSampleLoadProgress) => void;
}): Promise<StereoSample> {
  const {
    sampleKey,
    samplePath,
    sampleRate,
    baseDir,
    fallbackToneSeconds,
    loadedSamples,
    resolvedPathCache,
    onSampleLoadProgress,
  } = params;

  const cached = loadedSamples.get(sampleKey);
  if (cached) {
    onSampleLoadProgress?.({
      stage: 'cached',
      sampleKey,
      samplePath,
    });
    return cached;
  }

  const fallback = createFallbackTone(sampleKey, sampleRate, fallbackToneSeconds);
  if (!samplePath) {
    loadedSamples.set(sampleKey, fallback);
    onSampleLoadProgress?.({
      stage: 'fallback',
      sampleKey,
      samplePath,
    });
    return fallback;
  }

  onSampleLoadProgress?.({
    stage: 'resolving',
    sampleKey,
    samplePath,
  });
  const cacheKey = `${baseDir}:${samplePath}`;
  const resolvedPath = resolvedPathCache.has(cacheKey)
    ? resolvedPathCache.get(cacheKey)
    : await resolveSamplePath(baseDir, samplePath);
  resolvedPathCache.set(cacheKey, resolvedPath);

  if (!resolvedPath) {
    loadedSamples.set(sampleKey, fallback);
    onSampleLoadProgress?.({
      stage: 'fallback',
      sampleKey,
      samplePath,
    });
    return fallback;
  }

  try {
    onSampleLoadProgress?.({
      stage: 'reading',
      sampleKey,
      samplePath,
      resolvedPath,
    });
    const buffer = await readFile(resolvedPath);
    const decoded = await decodeAudioSample(buffer, resolvedPath);
    const left = resampleLinear(decoded.left, decoded.sampleRate, sampleRate);
    const rightSource = decoded.right ?? decoded.left;
    const right = resampleLinear(rightSource, decoded.sampleRate, sampleRate);
    const sample = { left, right };
    loadedSamples.set(sampleKey, sample);
    onSampleLoadProgress?.({
      stage: 'decoded',
      sampleKey,
      samplePath,
      resolvedPath,
    });
    return sample;
  } catch {
    loadedSamples.set(sampleKey, fallback);
    onSampleLoadProgress?.({
      stage: 'fallback',
      sampleKey,
      samplePath,
      resolvedPath,
    });
    return fallback;
  }
}

/**
 * mix Sample に対応する処理を実行します。
 * @param destinationLeft - destinationLeft に対応する入力値。
 * @param destinationRight - destinationRight に対応する入力値。
 * @param sample - sample に対応する入力値。
 * @param startFrame - startFrame に対応する入力値。
 * @param gain - gain に対応する入力値。
 * @param sampleOffsetFrames - sampleOffsetFrames に対応する入力値。
 * @param sampleMaxFrames - sampleMaxFrames に対応する入力値。
 * @returns 戻り値はありません。
 */
function mixSample(
  destinationLeft: Float32Array,
  destinationRight: Float32Array,
  sample: StereoSample,
  startFrame: number,
  gain: number,
  sampleOffsetFrames = 0,
  sampleMaxFrames?: number,
): void {
  let source = Math.max(0, sampleOffsetFrames);
  let index = 0;
  const maxFrames = sampleMaxFrames ?? sample.left.length;
  while (source < sample.left.length) {
    if (index >= maxFrames) {
      break;
    }
    const target = startFrame + index;
    if (target >= destinationLeft.length) {
      break;
    }
    destinationLeft[target] += sample.left[source] * gain;
    destinationRight[target] += sample.right[source] * gain;
    source += 1;
    index += 1;
  }
}

/**
 * 処理に必要な初期データを生成します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @param resolver - resolver に対応する入力値。
 * @param sampleEvents - sampleEvents に対応する入力値。
 * @returns 処理結果（Map<BmsEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }>）。
 */
function createBmsonSamplePlaybackMap(
  json: BmsJson,
  resolver: TimingResolver,
  sampleEvents: BmsEvent[],
): Map<BmsEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }> {
  const perSampleKey = new Map<string, Array<{ event: BmsEvent; beat: number; seconds: number }>>();
  for (const event of sampleEvents) {
    const sampleKey = normalizeObjectKey(event.value);
    const entries = perSampleKey.get(sampleKey) ?? [];
    entries.push({
      event,
      beat: eventToBeat(json, event),
      seconds: resolver.eventToSeconds(event),
    });
    perSampleKey.set(sampleKey, entries);
  }

  const playbackMap = new Map<BmsEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }>();
  for (const entries of perSampleKey.values()) {
    entries.sort((left, right) => left.beat - right.beat);
    let anchorSeconds = 0;
    let hasAnchor = false;
    let sliceIndex = 0;

    for (let index = 0; index < entries.length; ) {
      const currentBeat = entries[index].beat;
      let end = index + 1;
      while (end < entries.length && Math.abs(entries[end].beat - currentBeat) < 1e-9) {
        end += 1;
      }

      const group = entries.slice(index, end);
      const shouldRestart = group.some((entry) => entry.event.bmson?.c !== true);
      if (!hasAnchor || shouldRestart) {
        anchorSeconds = group[0].seconds;
        hasAnchor = true;
      }

      const offsetSeconds = Math.max(0, group[0].seconds - anchorSeconds);
      const next = entries[end];
      const durationSeconds = next ? Math.max(0, next.seconds - group[0].seconds) : undefined;
      const sampleKey = normalizeObjectKey(group[0].event.value);
      const sliceId = `${sampleKey}:${sliceIndex}`;
      sliceIndex += 1;

      for (const entry of group) {
        playbackMap.set(entry.event, { offsetSeconds, durationSeconds, sliceId });
      }
      index = end;
    }
  }

  return playbackMap;
}

/**
 * measure Peak に対応する処理を実行します。
 * @param left - 比較・演算対象の値。
 * @param right - 比較・演算対象の値。
 * @returns 計算結果の数値。
 */
function measurePeak(left: Float32Array, right: Float32Array): number {
  let peak = 0;
  for (let index = 0; index < left.length; index += 1) {
    const absLeft = Math.abs(left[index]);
    const absRight = Math.abs(right[index]);
    if (absLeft > peak) {
      peak = absLeft;
    }
    if (absRight > peak) {
      peak = absRight;
    }
  }
  return peak;
}

/**
 * scale Pcm に対応する処理を実行します。
 * @param channel - 対象チャンネル番号。
 * @param scale - scale に対応する入力値。
 * @returns 戻り値はありません。
 */
function scalePcm(channel: Float32Array, scale: number): void {
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] *= scale;
  }
}

/**
 * 処理に必要な初期データを生成します。
 * @param sampleKey - sampleKey に対応する入力値。
 * @param sampleRate - sampleRate に対応する入力値。
 * @param seconds - 秒単位の時刻または長さ。
 * @returns 処理結果（StereoSample）。
 */
function createFallbackTone(sampleKey: string, sampleRate: number, seconds: number): StereoSample {
  const frameLength = Math.max(1, Math.round(sampleRate * seconds));
  const left = new Float32Array(frameLength);
  const right = new Float32Array(frameLength);
  const seed = Number.parseInt(sampleKey, 36);
  const frequency = 220 + ((Number.isFinite(seed) ? seed : 1) % 36) * 18;

  for (let index = 0; index < frameLength; index += 1) {
    const envelope = Math.max(0, 1 - index / frameLength);
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * envelope * 0.3;
    left[index] = value;
    right[index] = value;
  }

  return { left, right };
}

/**
 * 非同期で依存する値を解決し、確定値を返します。
 * @param baseDir - baseDir に対応する入力値。
 * @param samplePath - 対象ファイルまたはディレクトリのパス。
 * @returns 非同期処理完了後の結果（string | undefined）を解決する Promise。
 */
async function resolveSamplePath(baseDir: string, samplePath: string): Promise<string | undefined> {
  const candidates = createSamplePathCandidates(samplePath);

  for (const candidate of candidates) {
    const absolute = isAbsolute(candidate) ? candidate : resolve(baseDir, candidate);
    if (await exists(absolute)) {
      return absolute;
    }
  }

  return undefined;
}

/**
 * 処理に必要な初期データを生成します。
 * @param samplePath - 対象ファイルまたはディレクトリのパス。
 * @returns 処理結果の配列。
 */
function createSamplePathCandidates(samplePath: string): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  /**
   * push に対応する処理を実行します。
   * @param value - 処理対象の値。
   * @returns 戻り値はありません。
   */
  const push = (value: string): void => {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  const basePaths = [samplePath];
  const slashNormalized = samplePath.replaceAll('\\', '/');
  if (slashNormalized !== samplePath) {
    basePaths.push(slashNormalized);
  }

  for (const basePath of basePaths) {
    appendSampleCandidatesByRule(basePath, push);
  }

  return candidates;
}

/**
 * append Sample Candidates By Rule に対応する処理を実行します。
 * @param samplePath - 対象ファイルまたはディレクトリのパス。
 * @param push - push に対応する入力値。
 * @returns 戻り値はありません。
 */
function appendSampleCandidatesByRule(samplePath: string, push: (candidatePath: string) => void): void {
  push(samplePath);

  const extension = extname(samplePath).toLowerCase();
  const withoutExtension = extension.length > 0 ? samplePath.slice(0, -extension.length) : samplePath;

  if (extension === '.mp3') {
    // If .mp3 is explicitly specified, try mp3 first and then fallback to ogg/opus.
    push(`${withoutExtension}.mp3`);
    push(`${withoutExtension}.MP3`);
    push(`${withoutExtension}.ogg`);
    push(`${withoutExtension}.OGG`);
    push(`${withoutExtension}.oga`);
    push(`${withoutExtension}.OGA`);
    push(`${withoutExtension}.opus`);
    push(`${withoutExtension}.OPUS`);
    return;
  }

  if (extension === '.wav') {
    // If .wav is specified but not found, fallback to mp3 -> ogg -> opus.
    push(`${withoutExtension}.wav`);
    push(`${withoutExtension}.WAV`);
    push(`${withoutExtension}.mp3`);
    push(`${withoutExtension}.MP3`);
    push(`${withoutExtension}.ogg`);
    push(`${withoutExtension}.OGG`);
    push(`${withoutExtension}.oga`);
    push(`${withoutExtension}.OGA`);
    push(`${withoutExtension}.opus`);
    push(`${withoutExtension}.OPUS`);
    return;
  }

  if (extension === '.ogg' || extension === '.oga') {
    push(`${withoutExtension}.ogg`);
    push(`${withoutExtension}.OGG`);
    push(`${withoutExtension}.oga`);
    push(`${withoutExtension}.OGA`);
    push(`${withoutExtension}.opus`);
    push(`${withoutExtension}.OPUS`);
    return;
  }

  if (extension === '.opus') {
    push(`${withoutExtension}.opus`);
    push(`${withoutExtension}.OPUS`);
    push(`${withoutExtension}.ogg`);
    push(`${withoutExtension}.OGG`);
    push(`${withoutExtension}.oga`);
    push(`${withoutExtension}.OGA`);
    return;
  }

  // Extension omitted or unknown: wav -> mp3 -> ogg -> opus.
  push(`${withoutExtension}.wav`);
  push(`${withoutExtension}.WAV`);
  push(`${withoutExtension}.mp3`);
  push(`${withoutExtension}.MP3`);
  push(`${withoutExtension}.ogg`);
  push(`${withoutExtension}.OGG`);
  push(`${withoutExtension}.oga`);
  push(`${withoutExtension}.OGA`);
  push(`${withoutExtension}.opus`);
  push(`${withoutExtension}.OPUS`);
}

/**
 * 非同期でexists に対応する処理を実行します。
 * @param filePath - 対象ファイルまたはディレクトリのパス。
 * @returns 非同期処理完了後の結果（boolean）を解決する Promise。
 */
async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 非同期で入力データをデコードして扱いやすい形に変換します。
 * @param buffer - 読み取り対象のバッファ。
 * @param pathHint - pathHint に対応する入力値。
 * @returns 非同期処理完了後の結果（DecodedAudio）を解決する Promise。
 */
async function decodeAudioSample(buffer: Buffer, pathHint?: string): Promise<DecodedAudio> {
  if (isWavBuffer(buffer)) {
    return decodeWav(buffer);
  }
  if (isMp3Buffer(buffer)) {
    return decodeMp3(buffer);
  }
  if (isOggBuffer(buffer)) {
    return decodeOggLike(buffer);
  }

  const extension = pathHint ? extname(pathHint).toLowerCase() : '';
  if (extension === '.ogg' || extension === '.oga' || extension === '.opus') {
    return decodeOggLike(buffer);
  }
  if (extension === '.mp3') {
    return decodeMp3(buffer);
  }
  if (extension === '.wav') {
    return decodeWav(buffer);
  }

  try {
    return decodeWav(buffer);
  } catch {
    try {
      return decodeMp3(buffer);
    } catch {
      return decodeOggLike(buffer);
    }
  }
}

/**
 * 非同期で入力データをデコードして扱いやすい形に変換します。
 * @param buffer - 読み取り対象のバッファ。
 * @returns 非同期処理完了後の結果（DecodedAudio）を解決する Promise。
 */
async function decodeOggLike(buffer: Buffer): Promise<DecodedAudio> {
  if (isOggOpusBuffer(buffer)) {
    return decodeOggOpus(buffer);
  }

  try {
    return await decodeOggVorbis(buffer);
  } catch {
    return decodeOggOpus(buffer);
  }
}

/**
 * 入力データをデコードして扱いやすい形に変換します。
 * @param buffer - 読み取り対象のバッファ。
 * @returns 処理結果（DecodedAudio）。
 */
function decodeWav(buffer: Buffer): DecodedAudio {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('Unsupported file format. Only RIFF/WAVE is supported for samples.');
  }

  let offset = 12;
  let format:
    | {
        audioFormat: number;
        channels: number;
        sampleRate: number;
        blockAlign: number;
        bitsPerSample: number;
      }
    | undefined;
  let pcmOffset = -1;
  let pcmSize = 0;

  while (offset + 8 <= view.byteLength) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const bodyOffset = offset + 8;

    if (id === 'fmt ') {
      format = {
        audioFormat: view.getUint16(bodyOffset, true),
        channels: view.getUint16(bodyOffset + 2, true),
        sampleRate: view.getUint32(bodyOffset + 4, true),
        blockAlign: view.getUint16(bodyOffset + 12, true),
        bitsPerSample: view.getUint16(bodyOffset + 14, true),
      };
    }

    if (id === 'data') {
      pcmOffset = bodyOffset;
      pcmSize = size;
    }

    offset = bodyOffset + size + (size % 2);
  }

  if (!format || pcmOffset < 0 || pcmSize <= 0) {
    throw new Error('Invalid WAV file. Missing fmt/data chunks.');
  }

  const frameCount = Math.floor(pcmSize / format.blockAlign);
  const channels = Math.max(1, format.channels);
  const channelBuffers = Array.from({ length: channels }, () => new Float32Array(frameCount));

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sampleOffset = pcmOffset + frame * format.blockAlign + channel * (format.bitsPerSample / 8);
      channelBuffers[channel][frame] = decodeSample(view, sampleOffset, format.audioFormat, format.bitsPerSample);
    }
  }

  return {
    sampleRate: format.sampleRate,
    left: channelBuffers[0],
    right: channelBuffers[1],
  };
}

/**
 * 非同期で入力データをデコードして扱いやすい形に変換します。
 * @param buffer - 読み取り対象のバッファ。
 * @returns 非同期処理完了後の結果（DecodedAudio）を解決する Promise。
 */
async function decodeOggVorbis(buffer: Buffer): Promise<DecodedAudio> {
  const decoder = new OggVorbisDecoder();
  await decoder.ready;
  try {
    const decoded = await decoder.decodeFile(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
    const channels = decoded.channelData ?? [];
    if (channels.length === 0) {
      throw new Error('Failed to decode OGG file: no channel data.');
    }

    return {
      sampleRate: decoded.sampleRate,
      left: channels[0],
      right: channels[1],
    };
  } finally {
    decoder.free();
  }
}

/**
 * 非同期で入力データをデコードして扱いやすい形に変換します。
 * @param buffer - 読み取り対象のバッファ。
 * @returns 非同期処理完了後の結果（DecodedAudio）を解決する Promise。
 */
async function decodeMp3(buffer: Buffer): Promise<DecodedAudio> {
  return withSuppressedMpg123Warnings(async () => {
    const decoder = new MPEGDecoder();
    await decoder.ready;
    try {
      const decoded = decoder.decode(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
      const channels = decoded.channelData ?? [];
      if (channels.length === 0) {
        throw new Error('Failed to decode MP3 file: no channel data.');
      }

      return {
        sampleRate: decoded.sampleRate,
        left: channels[0],
        right: channels[1],
      };
    } finally {
      decoder.free();
    }
  });
}

/**
 * 非同期で入力データをデコードして扱いやすい形に変換します。
 * @param buffer - 読み取り対象のバッファ。
 * @returns 非同期処理完了後の結果（DecodedAudio）を解決する Promise。
 */
async function decodeOggOpus(buffer: Buffer): Promise<DecodedAudio> {
  const decoder = new OggOpusDecoder();
  await decoder.ready;
  try {
    const decoded = await decoder.decodeFile(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
    const channels = decoded.channelData ?? [];
    if (channels.length === 0) {
      throw new Error('Failed to decode Opus file: no channel data.');
    }

    return {
      sampleRate: decoded.sampleRate,
      left: channels[0],
      right: channels[1],
    };
  } finally {
    decoder.free();
  }
}

/**
 * 入力データをデコードして扱いやすい形に変換します。
 * @param view - バイナリ読み取りに使う DataView。
 * @param offset - 読み書き開始位置のオフセット。
 * @param audioFormat - audioFormat に対応する入力値。
 * @param bitsPerSample - bitsPerSample に対応する入力値。
 * @returns 計算結果の数値。
 */
function decodeSample(view: DataView, offset: number, audioFormat: number, bitsPerSample: number): number {
  if (audioFormat === 3 && bitsPerSample === 32) {
    return clampSignedUnit(view.getFloat32(offset, true));
  }

  if (audioFormat !== 1) {
    throw new Error(`Unsupported WAV encoding format: ${audioFormat}`);
  }

  switch (bitsPerSample) {
    case 8:
      return (view.getUint8(offset) - 128) / 128;
    case 16:
      return view.getInt16(offset, true) / 32768;
    case 24: {
      const byte0 = view.getUint8(offset);
      const byte1 = view.getUint8(offset + 1);
      const byte2 = view.getUint8(offset + 2);
      let sample = byte0 | (byte1 << 8) | (byte2 << 16);
      if (sample & 0x800000) {
        sample |= ~0xffffff;
      }
      return sample / 8388608;
    }
    case 32:
      return view.getInt32(offset, true) / 2147483648;
    default:
      throw new Error(`Unsupported PCM bit depth: ${bitsPerSample}`);
  }
}

/**
 * resample Linear に対応する処理を実行します。
 * @param input - 解析または変換の入力データ。
 * @param inputRate - inputRate に対応する入力値。
 * @param outputRate - outputRate に対応する入力値。
 * @returns 処理結果（Float32Array）。
 */
function resampleLinear(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) {
    return input;
  }

  const outputLength = Math.max(1, Math.round((input.length * outputRate) / inputRate));
  const output = new Float32Array(outputLength);
  const ratio = inputRate / outputRate;

  for (let index = 0; index < outputLength; index += 1) {
    const source = index * ratio;
    const left = Math.floor(source);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = source - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }

  return output;
}

/**
 * 入力データをエンコードして出力形式へ変換します。
 * @param result - result に対応する入力値。
 * @returns 処理結果（Buffer）。
 */
function encodeWav16(result: RenderResult): Buffer {
  const frameCount = Math.min(result.left.length, result.right.length);
  const dataSize = frameCount * 4;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 4, 'ascii');
  buffer.write('fmt ', 12, 4, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(result.sampleRate, 24);
  buffer.writeUInt32LE(result.sampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  let pointer = 44;
  for (let index = 0; index < frameCount; index += 1) {
    buffer.writeInt16LE(floatToInt16(result.left[index]), pointer);
    buffer.writeInt16LE(floatToInt16(result.right[index]), pointer + 2);
    pointer += 4;
  }

  return buffer;
}

/**
 * 入力データをエンコードして出力形式へ変換します。
 * @param result - result に対応する入力値。
 * @returns 処理結果（Buffer）。
 */
function encodeAiff16(result: RenderResult): Buffer {
  const frameCount = Math.min(result.left.length, result.right.length);
  const dataSize = frameCount * 4;
  const ssndSize = 8 + dataSize;
  const formSize = 4 + (8 + 18) + (8 + ssndSize);

  const buffer = Buffer.alloc(8 + formSize);
  let pointer = 0;

  buffer.write('FORM', pointer, 4, 'ascii');
  pointer += 4;
  buffer.writeUInt32BE(formSize, pointer);
  pointer += 4;
  buffer.write('AIFF', pointer, 4, 'ascii');
  pointer += 4;

  buffer.write('COMM', pointer, 4, 'ascii');
  pointer += 4;
  buffer.writeUInt32BE(18, pointer);
  pointer += 4;
  buffer.writeUInt16BE(2, pointer);
  pointer += 2;
  buffer.writeUInt32BE(frameCount, pointer);
  pointer += 4;
  buffer.writeUInt16BE(16, pointer);
  pointer += 2;
  writeExtended80(buffer, pointer, result.sampleRate);
  pointer += 10;

  buffer.write('SSND', pointer, 4, 'ascii');
  pointer += 4;
  buffer.writeUInt32BE(ssndSize, pointer);
  pointer += 4;
  buffer.writeUInt32BE(0, pointer);
  pointer += 4;
  buffer.writeUInt32BE(0, pointer);
  pointer += 4;

  for (let index = 0; index < frameCount; index += 1) {
    buffer.writeInt16BE(floatToInt16(result.left[index]), pointer);
    buffer.writeInt16BE(floatToInt16(result.right[index]), pointer + 2);
    pointer += 4;
  }

  return buffer;
}

/**
 * 指定先へデータを書き込みます。
 * @param buffer - 読み取り対象のバッファ。
 * @param offset - 読み書き開始位置のオフセット。
 * @param value - 処理対象の値。
 * @returns 戻り値はありません。
 */
function writeExtended80(buffer: Buffer, offset: number, value: number): void {
  if (value <= 0) {
    buffer.fill(0, offset, offset + 10);
    return;
  }

  let exponent = 16383;
  let normalized = value;

  while (normalized >= 1) {
    normalized /= 2;
    exponent += 1;
  }

  while (normalized < 0.5) {
    normalized *= 2;
    exponent -= 1;
  }

  normalized *= 2;
  exponent -= 1;

  const mantissa = normalized * 2 ** 63;
  const hi = Math.floor(mantissa / 2 ** 32);
  const lo = Math.floor(mantissa - hi * 2 ** 32);

  buffer.writeUInt16BE(exponent & 0x7fff, offset);
  buffer.writeUInt32BE(hi >>> 0, offset + 2);
  buffer.writeUInt32BE(lo >>> 0, offset + 6);
}

/**
 * float To Int16 に対応する処理を実行します。
 * @param sample - sample に対応する入力値。
 * @returns 計算結果の数値。
 */
function floatToInt16(sample: number): number {
  const clamped = clampSignedUnit(sample);
  if (clamped >= 0) {
    return Math.round(clamped * 32767);
  }
  return Math.round(clamped * 32768);
}

/**
 * 入力内容からフォーマットや状態を判定します。
 * @param path - 対象ファイルまたはディレクトリのパス。
 * @returns 処理結果（'wav' | 'aiff'）。
 */
function detectAudioFormat(path: string): 'wav' | 'aiff' {
  const extension = extname(path).toLowerCase();
  if (extension === '.aiff' || extension === '.aif') {
    return 'aiff';
  }
  return 'wav';
}

/**
 * 条件判定を行い、真偽値を返します。
 * @param buffer - 読み取り対象のバッファ。
 * @returns 条件を満たす場合は `true`、それ以外は `false`。
 */
function isWavBuffer(buffer: Buffer): boolean {
  if (buffer.byteLength < 12) {
    return false;
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return readAscii(view, 0, 4) === 'RIFF' && readAscii(view, 8, 4) === 'WAVE';
}

/**
 * 条件判定を行い、真偽値を返します。
 * @param buffer - 読み取り対象のバッファ。
 * @returns 条件を満たす場合は `true`、それ以外は `false`。
 */
function isOggBuffer(buffer: Buffer): boolean {
  if (buffer.byteLength < 4) {
    return false;
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return readAscii(view, 0, 4) === 'OggS';
}

/**
 * 条件判定を行い、真偽値を返します。
 * @param buffer - 読み取り対象のバッファ。
 * @returns 条件を満たす場合は `true`、それ以外は `false`。
 */
function isOggOpusBuffer(buffer: Buffer): boolean {
  if (buffer.byteLength < 32) {
    return false;
  }
  return buffer.includes(Buffer.from('OpusHead', 'ascii'));
}

/**
 * 条件判定を行い、真偽値を返します。
 * @param buffer - 読み取り対象のバッファ。
 * @returns 条件を満たす場合は `true`、それ以外は `false`。
 */
function isMp3Buffer(buffer: Buffer): boolean {
  if (buffer.byteLength >= 3) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (readAscii(view, 0, 3) === 'ID3') {
      return true;
    }
  }
  if (buffer.byteLength < 2) {
    return false;
  }
  const header0 = buffer[0];
  const header1 = buffer[1];
  return header0 === 0xff && (header1 & 0xe0) === 0xe0;
}

/**
 * 外部データを読み込み、処理可能な形式で返します。
 * @param view - バイナリ読み取りに使う DataView。
 * @param offset - 読み書き開始位置のオフセット。
 * @param length - 長さを表す値。
 * @returns 変換後または整形後の文字列。
 */
function readAscii(view: DataView, offset: number, length: number): string {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(view.getUint8(offset + index));
  }
  return result;
}

/**
 * 非同期でwith Suppressed Mpg123 Warnings に対応する処理を実行します。
 * @param fn - fn に対応する入力値。
 * @returns 非同期処理完了後の結果（T）を解決する Promise。
 */
async function withSuppressedMpg123Warnings<T>(fn: () => Promise<T>): Promise<T> {
  const originalConsoleError = console.error;
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  console.error = (...args: unknown[]) => {
    const message = args.map((value) => String(value)).join(' ');
    if (MPG123_SUPPRESSED_LOG_PATTERNS.some((pattern) => pattern.test(message))) {
      return;
    }
    originalConsoleError(...args);
  };
  process.stderr.write = ((
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean => {
    const message = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    if (MPG123_SUPPRESSED_LOG_PATTERNS.some((pattern) => pattern.test(message))) {
      if (typeof encoding === 'function') {
        encoding();
      }
      callback?.();
      return true;
    }
    if (typeof encoding === 'function') {
      return originalStderrWrite(chunk, encoding);
    }
    return originalStderrWrite(chunk, encoding, callback);
  }) as typeof process.stderr.write;

  try {
    return await fn();
  } finally {
    console.error = originalConsoleError;
    process.stderr.write = originalStderrWrite;
  }
}

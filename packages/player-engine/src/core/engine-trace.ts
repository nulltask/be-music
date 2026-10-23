import {
  createBeatResolver,
  createBPMTimeline,
  createStopBeatWindows,
  isBmsBGMVolumeChangeChannel,
  isBMSKeyVolumeChangeChannel,
  type ResolvedChart,
  type TimedSampleTrigger,
  type TimingResolver,
} from '@be-music/chart-model';
import type { LogLevel } from '@be-music/shared-utils/log';
import {
  type BeMusicEvent,
  type BeMusicJSON,
  normalizeChannel,
  normalizeObjectKey,
  resolveBMSBase,
} from '@be-music/chart-source';
import { type LaneBinding } from './lane-layout.ts';
import { formatSeconds } from '../utils.ts';
import { type PlaybackStateLogger } from './playback-support.ts';
import { _____EX_SCORE_PER_PGREAT, LR2_MONEY_SCORE_MAX } from './scoring.ts';
import { resolveBMSJudgeWindowsMsForExRankValue } from './judge-window.ts';
import { type JudgeWindowSetUs } from '../ruleset/index.ts';
import { RULESET_JUDGE_KINDS } from './judge-rules.ts';
import { REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS } from './engine-clock.ts';
import { type PlayerOptions, type PlayerSummary } from './engine-types.ts';

/**
 * No-TUI output of a play: runtime event lines, the playback-state logger, the scheduled
 * chart-event tracer and the result summary text.
 */
// Hand-rolled stand-in for `node:path.basename`: the engine stays free of `node:`-prefixed imports so it runs unchanged
// in the browser. Only the trailing-segment semantics the log output needs.
const basename = (path: string): string => {
  // Match `node:path.basename`'s "drop the trailing separator(s) and return the final segment" semantics for both
  // POSIX and Windows-style separators. An all-separator input ("/" / "\\") returns an empty string.
  const trimmed = path.replace(/[\\/]+$/, '');
  const lastSep = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return lastSep === -1 ? trimmed : trimmed.slice(lastSep + 1);
};

type LoggedBGALayer = 'base' | 'poor' | 'layer' | 'layer2';

interface LoggedBGACue {
  seconds: number;
  key?: string;
  resourcePath?: string;
  layer: LoggedBGALayer;
}

interface NoTUIScheduledPlaybackEvent {
  seconds: number;
  order: number;
  text: string;
}

type RuntimeEventFieldValue = string | number | boolean;

type RuntimeEventField = readonly [key: string, value: RuntimeEventFieldValue | undefined];

export interface NoTUIPlaybackEventTracer {
  flushUntil: (seconds: number) => void;
  logPoorTriggered: (seconds: number) => void;
  logPoorCleared: (seconds: number) => void;
}

const BGA_BASE_CHANNEL = '04';

const BGA_POOR_CHANNEL = '06';

const BGA_LAYER_CHANNEL = '07';

const BGA_LAYER2_CHANNEL = '0A';

/** Renders one window set as `PGREAT -8.0/+8.0ms ...` (early / late reach) for the TUI's start banner. */
export function formatJudgeWindowSet(windows: JudgeWindowSetUs): string {
  return RULESET_JUDGE_KINDS.map((kind, index) => {
    const [lateBoundUs, earlyBoundUs] = windows.judges[index]!;
    return `${kind} -${(earlyBoundUs / 1000).toFixed(1)}/+${(-lateBoundUs / 1000).toFixed(1)}ms`;
  }).join(' ');
}

export function resolveOutputWriter(options: PlayerOptions): (text: string) => void {
  if (typeof options.writeOutput === 'function') {
    return options.writeOutput;
  }
  const stdout = (globalThis as { process?: { stdout?: { write?: (value: string) => unknown } } }).process?.stdout;
  if (stdout && typeof stdout.write === 'function') {
    const write = stdout.write.bind(stdout);
    return (text: string): void => {
      write(text);
    };
  }
  return (): void => undefined;
}

export function emitPlayerLog(
  options: PlayerOptions,
  level: LogLevel,
  event: string,
  fields?: Record<string, unknown>,
): void {
  options.onLog?.({
    source: 'engine',
    level,
    event,
    fields: {
      emittedAtUnixMs: Date.now(),
      emittedAtMonotonicMs: performance.now(),
      ...fields,
    },
  });
}

export function writeRealtimeTriggeredEventLog(
  writeOutput: (text: string) => void,
  trigger: Pick<TimedSampleTrigger, 'seconds' | 'channel' | 'sampleKey' | 'event'>,
  resourcePath?: string,
  source = 'realtime',
): void {
  const normalizedResourcePath =
    typeof resourcePath === 'string' ? normalizeLoggedResourcePath(resourcePath) : undefined;
  writeRuntimeEventLog(writeOutput, 'sample-trigger', [
    ['time', formatSeconds(trigger.seconds)],
    ['source', source],
    ['channel', normalizeChannel(trigger.channel)],
    ['value', trigger.event.value],
    ['sample', trigger.sampleKey],
    ['asset', normalizedResourcePath],
    ['file', normalizedResourcePath ? basename(normalizedResourcePath) : undefined],
  ]);
}

export function writeRuntimeEventLog(
  writeOutput: (text: string) => void,
  kind: string,
  fields: readonly RuntimeEventField[],
): void {
  const orderedFields = orderRuntimeEventFields(fields);
  let line = 'EVENT';
  const timeField = orderedFields.find(([key]) => key === 'time');
  if (timeField && timeField[1] !== undefined) {
    line += ` time:${String(timeField[1])}`;
  }
  line += ` kind:${kind}`;
  for (const [key, value] of orderedFields) {
    if (value === undefined) {
      continue;
    }
    if (key === 'time') {
      continue;
    }
    line += ` ${key}:${String(value)}`;
  }
  writeOutput(`${line}\n`);
}

function resolveEventResourceInfo(
  resources: Readonly<Record<string, string>>,
  event: Pick<BeMusicEvent, 'value'>,
  base: 36 | 62 = 36,
): { sampleKey: string; resourcePath?: string } {
  const sampleKey = normalizeObjectKey(event.value, base);
  return {
    sampleKey,
    resourcePath: resources[sampleKey],
  };
}

export function writePlayableSampleTriggerEventLog(
  writeOutput: (text: string) => void,
  event: BeMusicEvent,
  seconds: number,
  resources: Readonly<Record<string, string>>,
  source: 'auto-note' | 'auto-scratch' | 'manual-note' | 'lane-fallback' | 'mine-hit',
  channel?: string,
  base: 36 | 62 = 36,
): void {
  const { sampleKey, resourcePath } = resolveEventResourceInfo(resources, event, base);
  writeRealtimeTriggeredEventLog(
    writeOutput,
    {
      seconds,
      channel: channel ?? event.channel,
      sampleKey,
      event,
    },
    resourcePath,
    source,
  );
}

export function writeSampleStopEventLog(
  writeOutput: (text: string) => void,
  channel: string,
  seconds: number,
  reason: 'long-note-release' | 'long-note-break',
  event?: BeMusicEvent,
  resources?: Readonly<Record<string, string>>,
  base: 36 | 62 = 36,
): void {
  const resourceInfo = event && resources ? resolveEventResourceInfo(resources, event, base) : undefined;
  const normalizedResourcePath =
    typeof resourceInfo?.resourcePath === 'string' ? normalizeLoggedResourcePath(resourceInfo.resourcePath) : undefined;
  writeRuntimeEventLog(writeOutput, 'sample-stop', [
    ['time', formatSeconds(seconds)],
    ['channel', normalizeChannel(channel)],
    ['reason', reason],
    ['sample', resourceInfo?.sampleKey],
    ['asset', normalizedResourcePath],
    ['file', normalizedResourcePath ? basename(normalizedResourcePath) : undefined],
  ]);
}

export function createNoTUIPlaybackStateLogger(params: {
  writeOutput: (text: string) => void;
  summary: PlayerSummary;
  /**
   * Object-ID radix used for resolving sample keys in `logLongNoteState`. Defaults to base 36; pass `62` for charts
   * that opted into `#BASE 62` so lowercase IDs hit the right resource entry instead of being case-folded.
   */
  base?: 36 | 62;
}): PlaybackStateLogger {
  const { writeOutput, summary } = params;
  const base = params.base ?? 36;

  return {
    logGaugeChange: (seconds, logParams): void => {
      const gauge = summary.gauge;
      if (!gauge) {
        return;
      }
      writeRuntimeEventLog(writeOutput, 'gauge-change', [
        ['time', formatSeconds(seconds)],
        ['value', formatLoggedNumericValue(gauge.current)],
        ['max', formatLoggedNumericValue(gauge.max)],
        ['delta', logParams.delta === undefined ? undefined : formatLoggedNumericValue(logParams.delta)],
        ['reason', logParams.reason],
        ['judge', logParams.judge],
        ['cleared', gauge.cleared],
      ]);
    },
    logComboChange: (seconds, logParams): void => {
      writeRuntimeEventLog(writeOutput, 'combo-change', [
        ['time', formatSeconds(seconds)],
        ['value', logParams.value],
        ['reason', logParams.reason],
        ['judge', logParams.judge],
        ['channel', logParams.channel ? normalizeChannel(logParams.channel) : undefined],
      ]);
    },
    logLongNoteState: (seconds, logParams): void => {
      const { sampleKey, resourcePath } = resolveEventResourceInfo(logParams.resources, logParams.event, base);
      const normalizedResourcePath =
        typeof resourcePath === 'string' ? normalizeLoggedResourcePath(resourcePath) : undefined;
      writeRuntimeEventLog(writeOutput, 'long-note', [
        ['time', formatSeconds(seconds)],
        ['channel', normalizeChannel(logParams.channel)],
        ['state', logParams.state],
        ['mode', logParams.mode],
        ['sample', sampleKey],
        ['asset', normalizedResourcePath],
        ['file', normalizedResourcePath ? basename(normalizedResourcePath) : undefined],
        ['end', logParams.endSeconds === undefined ? undefined : formatSeconds(logParams.endSeconds)],
      ]);
    },
    logResult: (seconds, logParams): void => {
      const gauge = logParams.summary.gauge;
      writeRuntimeEventLog(writeOutput, 'result', [
        ['time', formatSeconds(seconds)],
        ['reason', logParams.reason],
        ['total', logParams.summary.total],
        ['perfect', logParams.summary.perfect],
        ['great', logParams.summary.great],
        ['good', logParams.summary.good],
        ['bad', logParams.summary.bad],
        ['poor', logParams.summary.poor],
        ['fast', logParams.summary.fast],
        ['slow', logParams.summary.slow],
        ['exScore', logParams.summary.exScore],
        ['score', logParams.summary.score],
        ['gauge', gauge ? formatLoggedNumericValue(gauge.current) : undefined],
        ['gaugeMax', gauge ? formatLoggedNumericValue(gauge.max) : undefined],
        ['gaugeCleared', gauge?.cleared],
      ]);
    },
  };
}

export function writeRealtimeVolumeEventLog(
  writeOutput: (text: string) => void,
  seconds: number,
  event: BeMusicEvent,
): void {
  const normalizedChannel = normalizeChannel(event.channel);
  const target = isBMSKeyVolumeChangeChannel(normalizedChannel)
    ? 'key'
    : isBmsBGMVolumeChangeChannel(normalizedChannel)
      ? 'bgm'
      : 'master';
  writeRuntimeEventLog(writeOutput, 'volume-change', [
    ['time', formatSeconds(seconds)],
    ['target', target],
    ['channel', normalizedChannel],
    ['value', event.value],
  ]);
}

function formatLoggedNumericValue(value: number, maximumFractionDigits = 3): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const rounded = value.toFixed(maximumFractionDigits);
  return rounded.replace(/(?:\.0+|(\.\d*?[1-9])0+)$/, '$1');
}

function normalizeLoggedResourcePath(resourcePath: string): string {
  return resourcePath.replaceAll('\\', '/');
}

function resolveLoggedMeasureLengthTimeline(
  json: BeMusicJSON,
  resolver: TimingResolver,
  beatResolver: ReturnType<typeof createBeatResolver>,
): Array<{ measure: number; length: number; seconds: number }> {
  const measureLengths = new Map<number, number>();
  let maxMeasure = 0;
  for (const event of json.events) {
    if (event.measure > maxMeasure) {
      maxMeasure = event.measure;
    }
  }
  for (const measure of json.measures) {
    const index = Math.max(0, Math.floor(measure.index));
    if (index > maxMeasure) {
      maxMeasure = index;
    }
    if (!Number.isFinite(measure.length) || measure.length <= 0) {
      continue;
    }
    measureLengths.set(index, measure.length);
  }

  const timeline: Array<{ measure: number; length: number; seconds: number }> = [];
  let previousLength = 1;
  for (let measure = 0; measure <= maxMeasure; measure += 1) {
    const length = measureLengths.get(measure) ?? 1;
    if (measure > 0 && Math.abs(length - previousLength) < 1e-9) {
      previousLength = length;
      continue;
    }
    const seconds = resolver.beatToSeconds(beatResolver.measureToBeat(measure, 0));
    if (!Number.isFinite(seconds)) {
      previousLength = length;
      continue;
    }
    timeline.push({
      measure,
      length,
      seconds: Math.max(0, seconds),
    });
    previousLength = length;
  }

  return timeline;
}

function buildLoggedBGACueTimeline(
  sortedEvents: readonly BeMusicEvent[],
  resolver: TimingResolver,
  resources: Record<string, string>,
  channel: string,
  layer: LoggedBGALayer,
  base: 36 | 62 = 36,
): LoggedBGACue[] {
  const normalizedChannel = normalizeChannel(channel);
  const timeline: LoggedBGACue[] = [];
  for (const event of sortedEvents) {
    if (normalizeChannel(event.channel) !== normalizedChannel) {
      continue;
    }
    const key = normalizeObjectKey(event.value, base);
    const normalizedKey = key === '00' ? undefined : key;
    timeline.push({
      seconds: Math.max(0, resolver.eventToSeconds(event)),
      key: normalizedKey,
      resourcePath: normalizedKey ? resources[normalizedKey] : undefined,
      layer,
    });
  }
  return timeline;
}

function findActiveLoggedBGACue(timeline: readonly LoggedBGACue[], seconds: number): LoggedBGACue | undefined {
  let low = 0;
  let high = timeline.length - 1;
  let answer = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (timeline[mid]!.seconds <= seconds) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return answer >= 0 ? timeline[answer] : undefined;
}

function formatLoggedBGACueText(cue: LoggedBGACue): string {
  if (!cue.key) {
    return createRuntimeEventLine('bga-cue', [
      ['time', formatSeconds(cue.seconds)],
      ['layer', cue.layer],
      ['state', 'clear'],
    ]);
  }
  const normalizedResourcePath = cue.resourcePath ? normalizeLoggedResourcePath(cue.resourcePath) : undefined;
  return createRuntimeEventLine('bga-cue', [
    ['time', formatSeconds(cue.seconds)],
    ['layer', cue.layer],
    ['key', cue.key],
    ['asset', normalizedResourcePath],
    ['file', normalizedResourcePath ? basename(normalizedResourcePath) : undefined],
  ]);
}

function createRuntimeEventLine(kind: string, fields: readonly RuntimeEventField[]): string {
  const orderedFields = orderRuntimeEventFields(fields);
  let line = 'EVENT';
  const timeField = orderedFields.find(([key]) => key === 'time');
  if (timeField && timeField[1] !== undefined) {
    line += ` time:${String(timeField[1])}`;
  }
  line += ` kind:${kind}`;
  for (const [key, value] of orderedFields) {
    if (value === undefined) {
      continue;
    }
    if (key === 'time') {
      continue;
    }
    line += ` ${key}:${String(value)}`;
  }
  return `${line}\n`;
}

function orderRuntimeEventFields(fields: readonly RuntimeEventField[]): RuntimeEventField[] {
  const timeFields: RuntimeEventField[] = [];
  const otherFields: RuntimeEventField[] = [];
  for (const field of fields) {
    if (field[0] === 'time') {
      timeFields.push(field);
      continue;
    }
    otherFields.push(field);
  }
  return [...timeFields, ...otherFields];
}

function createScheduledPlaybackEvent(
  seconds: number,
  order: number,
  text: string,
): NoTUIScheduledPlaybackEvent | undefined {
  if (!Number.isFinite(seconds)) {
    return undefined;
  }
  return {
    seconds: Math.max(0, seconds),
    order,
    text,
  };
}

function mergeScheduledPlaybackEventGroups(
  groups: ReadonlyArray<ReadonlyArray<NoTUIScheduledPlaybackEvent>>,
): NoTUIScheduledPlaybackEvent[] {
  const cursors = Array.from({ length: groups.length }, () => 0);
  const merged: NoTUIScheduledPlaybackEvent[] = [];

  while (true) {
    let selectedGroupIndex = -1;
    let selectedEvent: NoTUIScheduledPlaybackEvent | undefined;

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const event = groups[groupIndex]?.[cursors[groupIndex] ?? 0];
      if (!event) {
        continue;
      }
      if (
        !selectedEvent ||
        event.seconds < selectedEvent.seconds ||
        (event.seconds === selectedEvent.seconds && event.order < selectedEvent.order)
      ) {
        selectedEvent = event;
        selectedGroupIndex = groupIndex;
      }
    }

    if (selectedGroupIndex < 0 || !selectedEvent) {
      break;
    }

    merged.push(selectedEvent);
    cursors[selectedGroupIndex] = (cursors[selectedGroupIndex] ?? 0) + 1;
  }

  return merged;
}

export function createNoopPlaybackEventTracer(): NoTUIPlaybackEventTracer {
  return {
    flushUntil: () => undefined,
    logPoorTriggered: () => undefined,
    logPoorCleared: () => undefined,
  };
}

export function createNoTUIPlaybackEventTracer(params: {
  resolved: ResolvedChart;
  writeOutput: (text: string) => void;
  judgeWindowMs?: number;
}): NoTUIPlaybackEventTracer {
  const { resolved, writeOutput, judgeWindowMs } = params;
  const json = resolved.source;
  const resolver = resolved.timing;
  const beatResolver = resolved.beatResolver;
  const sortedEvents = resolved.sortedEvents;
  let nextOrder = 0;
  const measureLengthEvents = resolveLoggedMeasureLengthTimeline(json, resolver, beatResolver)
    .map((point) =>
      createScheduledPlaybackEvent(
        point.seconds,
        nextOrder++,
        createRuntimeEventLine('measure-length-change', [
          ['time', formatSeconds(point.seconds)],
          ['measure', point.measure],
          ['length', formatLoggedNumericValue(point.length)],
        ]),
      ),
    )
    .filter((event): event is NoTUIScheduledPlaybackEvent => event !== undefined);
  const bpmEvents = createBPMTimeline(json, resolver)
    .map((point) =>
      createScheduledPlaybackEvent(
        point.seconds,
        nextOrder++,
        createRuntimeEventLine('bpm-change', [
          ['time', formatSeconds(point.seconds)],
          ['value', formatLoggedNumericValue(point.bpm)],
        ]),
      ),
    )
    .filter((event): event is NoTUIScheduledPlaybackEvent => event !== undefined);
  const scrollEvents = resolved.scroll
    .map((point) => {
      const seconds = resolver.beatToSeconds(point.beat);
      return createScheduledPlaybackEvent(
        seconds,
        nextOrder++,
        createRuntimeEventLine('scroll-change', [
          ['time', formatSeconds(seconds)],
          ['value', formatLoggedNumericValue(point.speed)],
        ]),
      );
    })
    .filter((event): event is NoTUIScheduledPlaybackEvent => event !== undefined);
  const speedEvents = resolved.speed
    .map((point) => {
      const seconds = resolver.beatToSeconds(point.beat);
      return createScheduledPlaybackEvent(
        seconds,
        nextOrder++,
        createRuntimeEventLine('speed-change', [
          ['time', formatSeconds(seconds)],
          ['value', formatLoggedNumericValue(point.speed)],
        ]),
      );
    })
    .filter((event): event is NoTUIScheduledPlaybackEvent => event !== undefined);
  const stopEvents = createStopBeatWindows(resolver)
    .flatMap((window) => [
      createScheduledPlaybackEvent(
        window.startSeconds,
        nextOrder++,
        createRuntimeEventLine('stop', [
          ['time', formatSeconds(window.startSeconds)],
          ['state', 'start'],
          ['duration', `${formatLoggedNumericValue(window.durationSeconds)}s`],
        ]),
      ),
      createScheduledPlaybackEvent(
        window.endSeconds,
        nextOrder++,
        createRuntimeEventLine('stop', [
          ['time', formatSeconds(window.endSeconds)],
          ['state', 'end'],
        ]),
      ),
    ])
    .filter((event): event is NoTUIScheduledPlaybackEvent => event !== undefined);
  const judgeRankEvents = resolved.judgeRank.changes
    .map((change) => {
      const badWindow = resolveBMSJudgeWindowsMsForExRankValue(change.exRankValue, judgeWindowMs).bad;
      return createScheduledPlaybackEvent(
        change.seconds,
        nextOrder++,
        createRuntimeEventLine('judge-rank-change', [
          ['time', formatSeconds(change.seconds)],
          ['rank', formatLoggedNumericValue(change.exRankValue)],
          ['bad', `${formatLoggedNumericValue(badWindow)}ms`],
        ]),
      );
    })
    .filter((event): event is NoTUIScheduledPlaybackEvent => event !== undefined);

  const idBase = resolveBMSBase(json);
  const baseBGATimeline = buildLoggedBGACueTimeline(
    sortedEvents,
    resolver,
    json.resources.bmp,
    BGA_BASE_CHANNEL,
    'base',
    idBase,
  );
  const poorBGATimeline = buildLoggedBGACueTimeline(
    sortedEvents,
    resolver,
    json.resources.bmp,
    BGA_POOR_CHANNEL,
    'poor',
    idBase,
  );
  const layerBGATimeline = buildLoggedBGACueTimeline(
    sortedEvents,
    resolver,
    json.resources.bmp,
    BGA_LAYER_CHANNEL,
    'layer',
    idBase,
  );
  const layer2BGATimeline = buildLoggedBGACueTimeline(
    sortedEvents,
    resolver,
    json.resources.bmp,
    BGA_LAYER2_CHANNEL,
    'layer2',
    idBase,
  );
  const baseBGAEvents = baseBGATimeline
    .map((cue) => createScheduledPlaybackEvent(cue.seconds, nextOrder++, formatLoggedBGACueText(cue)))
    .filter((event): event is NoTUIScheduledPlaybackEvent => event !== undefined);
  const poorBGAEvents = poorBGATimeline
    .map((cue) => createScheduledPlaybackEvent(cue.seconds, nextOrder++, formatLoggedBGACueText(cue)))
    .filter((event): event is NoTUIScheduledPlaybackEvent => event !== undefined);
  const layerBGAEvents = layerBGATimeline
    .map((cue) => createScheduledPlaybackEvent(cue.seconds, nextOrder++, formatLoggedBGACueText(cue)))
    .filter((event): event is NoTUIScheduledPlaybackEvent => event !== undefined);
  const layer2BGAEvents = layer2BGATimeline
    .map((cue) => createScheduledPlaybackEvent(cue.seconds, nextOrder++, formatLoggedBGACueText(cue)))
    .filter((event): event is NoTUIScheduledPlaybackEvent => event !== undefined);
  const scheduledEvents = mergeScheduledPlaybackEventGroups([
    measureLengthEvents,
    bpmEvents,
    scrollEvents,
    speedEvents,
    stopEvents,
    judgeRankEvents,
    baseBGAEvents,
    poorBGAEvents,
    layerBGAEvents,
    layer2BGAEvents,
  ]);

  // LR2 starts its miss layer from `#BMP00`; only `#POORBGA 2` (no POOR image) turns that off, and a missing,
  // unparsable or out-of-range value is `0`, the usual behaviour.
  const shouldUsePoorBMP00Fallback =
    (json.bms.poorBGA === undefined || Number.parseInt(json.bms.poorBGA.trim(), 10) !== 2) &&
    typeof json.resources.bmp['00'] === 'string' &&
    json.resources.bmp['00'].length > 0;
  const poorFallbackKey = shouldUsePoorBMP00Fallback ? '00' : undefined;
  const poorFallbackResourcePath = poorFallbackKey ? json.resources.bmp[poorFallbackKey] : undefined;
  const poorFallbackUntilSeconds = poorBGATimeline[0]?.seconds ?? Number.POSITIVE_INFINITY;
  let cursor = 0;
  let poorActive = false;

  const resolvePoorCueAt = (seconds: number): LoggedBGACue | undefined => {
    const activeCue = findActiveLoggedBGACue(poorBGATimeline, seconds);
    if (activeCue?.key) {
      return activeCue;
    }
    if (poorFallbackKey && seconds < poorFallbackUntilSeconds) {
      return {
        seconds,
        key: poorFallbackKey,
        resourcePath: poorFallbackResourcePath,
        layer: 'poor',
      };
    }
    return undefined;
  };

  return {
    flushUntil: (seconds) => {
      const safeSeconds = Math.max(0, seconds) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
      while (cursor < scheduledEvents.length) {
        const scheduledEvent = scheduledEvents[cursor]!;
        if (scheduledEvent.seconds > safeSeconds) {
          break;
        }
        writeOutput(scheduledEvent.text);
        cursor += 1;
      }
    },
    logPoorTriggered: (seconds) => {
      const cue = resolvePoorCueAt(seconds);
      const normalizedResourcePath =
        typeof cue?.resourcePath === 'string' ? normalizeLoggedResourcePath(cue.resourcePath) : undefined;
      poorActive = true;
      writeOutput(
        createRuntimeEventLine('bga-poor', [
          ['time', formatSeconds(seconds)],
          ['state', 'trigger'],
          ['key', cue?.key],
          ['asset', normalizedResourcePath],
          ['file', normalizedResourcePath ? basename(normalizedResourcePath) : undefined],
        ]),
      );
    },
    logPoorCleared: (seconds) => {
      if (!poorActive) {
        return;
      }
      poorActive = false;
      writeOutput(
        createRuntimeEventLine('bga-poor', [
          ['time', formatSeconds(seconds)],
          ['state', 'clear'],
        ]),
      );
    },
  };
}

export function printLaneMap(writeOutput: (text: string) => void, bindings: LaneBinding[]): void {
  writeOutput('Channel map:\n');
  for (const binding of bindings) {
    writeOutput(`  ${binding.channel} => ${binding.keyLabel}\n`);
  }
}

function formatGrooveGaugeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  const rounded = Math.round(value);
  return Math.abs(value - rounded) <= 1e-9 ? String(rounded) : value.toFixed(2);
}

function formatGrooveGaugeStatus(summary: PlayerSummary): string {
  return summary.gauge?.cleared === true ? 'CLEAR' : 'FAILED';
}

export function renderSummary(summary: PlayerSummary, moneyScore: boolean): string {
  const maxExScore = Math.max(0, summary.total * _____EX_SCORE_PER_PGREAT);
  const exScoreRate = maxExScore > 0 ? summary.exScore / maxExScore : 0;
  const scoreRate = summary.score / LR2_MONEY_SCORE_MAX;
  const gauge = summary.gauge;
  return (
    [
      '--- Result ---',
      `TOTAL  : ${summary.total}`,
      ...(gauge
        ? [
            `GAUGE  : ${gauge.current.toFixed(2)} / ${gauge.max.toFixed(2)} ${formatGrooveGaugeStatus(summary)} (TOTAL ${formatGrooveGaugeNumber(gauge.effectiveTotal)})`,
          ]
        : []),
      `PGREAT : ${summary.perfect}`,
      `GREAT  : ${summary.great}`,
      `GOOD   : ${summary.good}`,
      `BAD    : ${summary.bad}`,
      `POOR   : ${summary.poor}`,
      `EMPTY  : ${summary.emptyPoor}`,
      `FAST   : ${summary.fast}`,
      `SLOW   : ${summary.slow}`,
      `EX-SCORE: ${summary.exScore} / ${maxExScore} (${(exScoreRate * 100).toFixed(2)}%)`,
      // Only LR2 defines a money score; the other rulesets report EX-SCORE in this field, so printing a
      // percentage of 200000 there would be meaningless.
      ...(moneyScore ? [`SCORE   : ${summary.score} / ${LR2_MONEY_SCORE_MAX} (${(scoreRate * 100).toFixed(2)}%)`] : []),
    ].join('\n') + '\n'
  );
}

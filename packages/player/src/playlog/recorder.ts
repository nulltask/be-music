import {
  computeChartFingerprint,
  computePlayFingerprint,
  hasControlFlow,
  resolveChart,
  type RandomDraws,
} from '@be-music/chart';
import { resolveBmsControlFlowWithDraws } from '@be-music/parser';
import { resolveBmsBase, type BeMusicJson } from '@be-music/json';
import type { PlayerSummary } from '../core/engine.ts';
import type { PreparedPlaybackChartData } from '../core/bootstrap.ts';
import { resolveChartJudgeRankFacts } from '../ruleset/index.ts';
import { resolveLandmineGaugeEffect } from '../core/landmine.ts';
import type { GrooveGaugeType } from '../core/groove-gauge.ts';
import packageJson from '../../package.json' with { type: 'json' };
import {
  BE_MUSIC_PLAYLOG_FORMAT,
  BE_MUSIC_PLAYLOG_VERSION,
  type BeMusicPlaylog,
  type PlaylogChart,
  type PlaylogInputAction,
  type PlaylogInputEvent,
  type PlaylogNote,
  type PlaylogPlay,
  type PlaylogRecorderInfo,
  type PlaylogRulesetResult,
} from './format.ts';

/** Ruleset id used for the engine's own summary cached into `results` at record time. */
export const PLAYLOG_NATIVE_RULESET_ID = 'be-music/native';

/** `@be-music/player` version stamped into `recorder.engine` of every log this engine records. */
export const PLAYLOG_ENGINE_VERSION: string = packageJson.version;
const ENGINE_VERSION = PLAYLOG_ENGINE_VERSION;

/**
 * Chart data the recorder snapshots — structurally a subset of the engine's `PreparedPlaybackChartData`, so the
 * engine can hand its prepared bundle over verbatim.
 */
export type PlaylogRecorderChartData = Pick<
  PreparedPlaybackChartData,
  'notes' | 'landmineNotes' | 'invisibleNotes' | 'activeFreeZoneChannels' | 'scorableNotes' | 'laneDisplayMode'
> &
  Partial<Pick<PreparedPlaybackChartData, 'resolvedChart'>>;

export interface PlaylogRecorderPlaySettings {
  mode: 'manual' | 'auto';
  autoScratch: boolean;
  /** Selected gauge — declared by the host (the engine's own summary path always runs GROOVE today). */
  gauge?: GrooveGaugeType;
  randomLane?: { p1?: string; p2?: string };
  dpFlip?: boolean;
  judgeWindowOverrideMs?: number;
  /** Judge-window ruleset the engine ran (`PlayerOptions.judgeRuleset`). Absent = `'lr2'`. */
  judgeRuleset?: 'lr2' | 'beatoraja' | 'iidx';
  /** The play's `#RANDOM` / `#SWITCH` outcomes (`PlayerOptions.randomDraws`). Recorded when non-empty. */
  randomDraws?: RandomDraws;
  native?: Record<string, string | number | boolean | null>;
}

/**
 * Host-declared subset of the recording inputs — the fields the engine cannot know by itself. Passed through
 * `PlayerOptions.recordPlaylog`. `chartSha256` is the SHA-256 (lowercase hex) of the source chart FILE bytes;
 * hosts that have the raw file compute it so dropped logs can be matched back to their chart by content. `chartMd5` is
 * the MD5 of the same bytes, the key LR2 and LR2IR use.
 * `sourceChart` is the chart as loaded, before `#RANDOM` / `#SWITCH` resolution and before any lane option; hosts that
 * resolve control flow or rewrite lanes on the chart themselves pass it so the fingerprints describe the chart, not
 * their working copy. Without it the engine uses the chart it was given. `recorder` identifies the host application;
 * the engine version is added by the recorder itself.
 */
export type PlaylogRecordingOptions = Pick<
  PlaylogRecorderPlaySettings,
  'gauge' | 'randomLane' | 'dpFlip' | 'native'
> & {
  chartSha256?: string;
  chartMd5?: string;
  sourceChart?: BeMusicJson;
  recorder?: Omit<PlaylogRecorderInfo, 'engine'>;
};

export interface PlaylogRecorderOptions {
  /** Resolved chart JSON (post `#RANDOM` control flow) — metadata source. */
  json: BeMusicJson;
  chart: PlaylogRecorderChartData;
  /** SHA-256 (lowercase hex) of the source chart file bytes, when the host computed one. */
  chartSha256?: string;
  /** MD5 (lowercase hex) of the source chart file bytes, when the host computed one. */
  chartMd5?: string;
  /**
   * The chart file's extension (`PlayerOptions.laneModeExtension`), the fingerprint's lane-mode input. Without it the
   * recorder infers `.pms` from a 9 KEY lane mode.
   */
  laneModeExtension?: string;
  /**
   * The chart before `#RANDOM` / `#SWITCH` resolution and before any lane option — the fingerprint source. Used when
   * `play.randomDraws` were drawn for its control flow; otherwise the fingerprints fall back to {@link json}.
   */
  sourceChart?: BeMusicJson;
  play: PlaylogRecorderPlaySettings;
  /** Host application that records the play. `engine` is always overwritten with this package's version. */
  recorder?: Omit<PlaylogRecorderInfo, 'engine'>;
  /** Dynamic `#EXRANKxx` changes the engine collected (chart order). */
  dynamicJudgeRankChanges?: ReadonlyArray<{ seconds: number; exRankValue: number }>;
  /** LR2 negative-BPM reversal (chart seconds, #134) — recorded so re-simulations freeze judging at the same point. */
  reversalSeconds?: number;
  /** Clock source for `createdAt` — injectable for tests. Defaults to `Date`. */
  now?: () => Date;
}

export interface PlaylogRecorderFinalizeInput {
  summary: PlayerSummary;
  maxCombo?: number;
  aborted?: boolean;
}

export interface PlaylogRecorder {
  recordInput(
    action: PlaylogInputAction,
    timeSeconds: number,
    tokens: readonly string[],
    channels: Iterable<string>,
  ): void;
  /** Counts an LR2-style empty POOR — cached into the native result for diagnostics. */
  recordEmptyPoor(): void;
  finalize(input: PlaylogRecorderFinalizeInput): BeMusicPlaylog;
}

export function createPlaylogRecorder(options: PlaylogRecorderOptions): PlaylogRecorder {
  const chart = buildPlaylogChart(options);
  const inputs: PlaylogInputEvent[] = [];
  let seq = 0;
  let emptyPoorCount = 0;

  return {
    recordInput: (action, timeSeconds, tokens, channels): void => {
      const channelList = [...channels];
      if (channelList.length === 0) {
        return;
      }
      const event: PlaylogInputEvent = {
        seq: seq++,
        timeUs: secondsToMicroseconds(timeSeconds),
        action,
        channels: channelList,
      };
      if (tokens.length > 0) {
        event.tokens = [...tokens];
      }
      inputs.push(event);
    },
    recordEmptyPoor: (): void => {
      emptyPoorCount += 1;
    },
    finalize: ({ summary, maxCombo, aborted }): BeMusicPlaylog => {
      const play: PlaylogPlay = {
        mode: options.play.mode,
        autoScratch: options.play.autoScratch,
        gauge: options.play.gauge ?? 'GROOVE',
      };
      if (options.play.randomLane !== undefined) play.randomLane = options.play.randomLane;
      if (options.play.dpFlip !== undefined) play.dpFlip = options.play.dpFlip;
      if (options.play.judgeWindowOverrideMs !== undefined) {
        play.judgeWindowOverrideMs = options.play.judgeWindowOverrideMs;
      }
      if (options.play.judgeRuleset !== undefined) play.judgeRuleset = options.play.judgeRuleset;
      if (options.play.randomDraws !== undefined && options.play.randomDraws.length > 0) {
        play.randomDraws = options.play.randomDraws.map((draw) => ({ ...draw }));
      }
      if (aborted === true) play.aborted = true;
      if (options.play.native !== undefined) play.native = options.play.native;

      const createdAt = (options.now?.() ?? new Date()).toISOString();
      return {
        format: BE_MUSIC_PLAYLOG_FORMAT,
        version: BE_MUSIC_PLAYLOG_VERSION,
        createdAt,
        recorder: { ...options.recorder, engine: ENGINE_VERSION },
        clock: { unit: 'us', origin: 'chart-zero' },
        chart,
        inputs,
        play,
        results: {
          native: buildNativeResult(summary, maxCombo, emptyPoorCount, play.gauge, chart.noteCount),
        },
      };
    },
  };
}

function buildPlaylogChart(options: PlaylogRecorderOptions): PlaylogChart {
  const { json, chart } = options;
  const idBase = resolveBmsBase(json);
  const resolved = chart.resolvedChart ?? resolveChart(json);
  const chartLnMode = resolved.lnMode;
  const notes: PlaylogNote[] = [];

  for (const note of chart.notes) {
    const isFreeZone = chart.activeFreeZoneChannels.has(note.channel);
    const hasTail =
      typeof note.endSeconds === 'number' && Number.isFinite(note.endSeconds) && note.endSeconds > note.seconds;
    const entry: PlaylogNote = {
      id: 0,
      channel: note.channel,
      type: isFreeZone ? 'freezone' : hasTail ? 'long' : 'normal',
      timeUs: secondsToMicroseconds(note.seconds),
    };
    if (hasTail) {
      entry.endTimeUs = secondsToMicroseconds(note.endSeconds!);
      if (!isFreeZone) {
        entry.lnMode = note.longNoteMode ?? chartLnMode;
      }
    }
    notes.push(entry);
  }
  for (const mine of chart.landmineNotes) {
    notes.push({
      id: 0,
      channel: mine.channel,
      type: 'mine',
      timeUs: secondsToMicroseconds(mine.seconds),
      damage: resolveLandmineGaugeEffect(mine.event, idBase, json.sourceFormat).damage,
    });
  }
  for (const invisible of chart.invisibleNotes) {
    notes.push({
      id: 0,
      channel: invisible.channel,
      type: 'invisible',
      timeUs: secondsToMicroseconds(invisible.seconds),
    });
  }
  notes.sort(comparePlaylogNotes);
  for (let index = 0; index < notes.length; index += 1) {
    notes[index]!.id = index;
  }

  const judgeRank: PlaylogChart['judgeRank'] = resolveChartJudgeRankFacts(json, resolved);
  const timelineSource = options.dynamicJudgeRankChanges ?? [];
  if (timelineSource.length > 0) {
    judgeRank.timeline = timelineSource.map((change) => ({
      timeUs: secondsToMicroseconds(change.seconds),
      exRankValue: change.exRankValue,
    }));
  }

  const result: PlaylogChart = {
    sourceFormat: json.sourceFormat === 'bmson' ? 'bmson' : 'bms',
    laneMode: chart.laneDisplayMode,
    lnMode: chartLnMode,
    judgeRank,
    noteCount: chart.scorableNotes.length,
    notes,
  };
  if (typeof options.reversalSeconds === 'number' && Number.isFinite(options.reversalSeconds)) {
    result.reversalTimeUs = secondsToMicroseconds(options.reversalSeconds);
  }
  if (typeof options.chartSha256 === 'string' && options.chartSha256.length > 0) {
    result.sha256 = options.chartSha256.toLowerCase();
  }
  if (typeof options.chartMd5 === 'string' && options.chartMd5.length > 0) {
    result.md5 = options.chartMd5.toLowerCase();
  }
  const { chartFingerprint, playFingerprint } = computePlaylogFingerprints(options);
  if (chartFingerprint !== undefined) result.chartFingerprint = chartFingerprint;
  if (playFingerprint !== undefined) result.playFingerprint = playFingerprint;
  if (typeof json.metadata.title === 'string' && json.metadata.title.length > 0) result.title = json.metadata.title;
  if (typeof json.metadata.subtitle === 'string' && json.metadata.subtitle.length > 0) {
    result.subtitle = json.metadata.subtitle;
  }
  if (typeof json.metadata.artist === 'string' && json.metadata.artist.length > 0) result.artist = json.metadata.artist;
  if (typeof json.metadata.genre === 'string' && json.metadata.genre.length > 0) result.genre = json.metadata.genre;
  const playLevel = json.metadata.playLevel;
  if (
    (typeof playLevel === 'number' && Number.isFinite(playLevel)) ||
    (typeof playLevel === 'string' && playLevel !== '')
  ) {
    result.playLevel = String(playLevel);
  }
  if (typeof json.metadata.difficulty === 'number' && Number.isFinite(json.metadata.difficulty)) {
    result.difficulty = json.metadata.difficulty;
  }
  if (resolved.total.value !== undefined) {
    result.total = resolved.total.value;
  }
  return result;
}

/**
 * Chart and play fingerprints (`bmfp0:…`) of the play. Their lane-mode input is the chart's extension, which the
 * engine passes as `laneModeExtension`; without it, a 9 KEY play stands in for `.pms` (it is 9 KEY exactly when the
 * chart is `.pms` or its content says so).
 *
 * The source chart rebuilds both whatever the host did to its working copy (a DP flip baked into the chart JSON, the
 * control flow resolved away), provided `play.randomDraws` were drawn for its control flow. Without a usable source the
 * engine's chart gives the play fingerprint, and the chart fingerprint only when the play has no draws — a chart with
 * control flow has none to resolve there, so its chart fingerprint is unknown and omitted. A failure only drops a
 * field — it must never break recording.
 */
function computePlaylogFingerprints(options: PlaylogRecorderOptions): {
  chartFingerprint?: string;
  playFingerprint?: string;
} {
  const chartPath =
    options.laneModeExtension ?? (options.chart.laneDisplayMode.startsWith('9 KEY') ? '.pms' : undefined);
  const draws = options.play.randomDraws ?? [];
  const source = options.sourceChart;
  const played = source !== undefined ? tryResolveSource(source, draws) : undefined;
  if (source !== undefined && played !== undefined) {
    return {
      chartFingerprint: tryFingerprint(() => computeChartFingerprint(source, { chartPath })),
      playFingerprint: tryFingerprint(() => computePlayFingerprint(played, { chartPath })),
    };
  }
  const playFingerprint = tryFingerprint(() => computePlayFingerprint(options.json, { chartPath }));
  return draws.length === 0 ? { chartFingerprint: playFingerprint, playFingerprint } : { playFingerprint };
}

/** The source chart resolved with the play's draws, or `undefined` when they were not drawn for its control flow. */
function tryResolveSource(source: BeMusicJson, draws: RandomDraws): BeMusicJson | undefined {
  if (!hasControlFlow(source)) {
    return draws.length === 0 ? source : undefined;
  }
  try {
    return resolveBmsControlFlowWithDraws(source, draws);
  } catch {
    return undefined;
  }
}

function tryFingerprint(compute: () => string): string | undefined {
  try {
    return compute();
  } catch {
    return undefined;
  }
}

function buildNativeResult(
  summary: PlayerSummary,
  maxCombo: number | undefined,
  emptyPoorCount: number,
  declaredGauge: GrooveGaugeType,
  noteCount: number,
): PlaylogRulesetResult {
  const result: PlaylogRulesetResult = {
    ruleset: PLAYLOG_NATIVE_RULESET_ID,
    judge: {
      pgreat: summary.perfect,
      great: summary.great,
      good: summary.good,
      bad: summary.bad,
      poor: summary.poor,
      emptyPoor: emptyPoorCount,
    },
    fast: summary.fast,
    slow: summary.slow,
    exScore: summary.exScore,
    noteCount,
    maxCombo: maxCombo ?? 0,
    score: summary.score,
    gauge: {
      type: summary.gauge?.type ?? declaredGauge,
      final: summary.gauge?.current ?? 0,
      cleared: summary.gauge?.cleared ?? false,
    },
  };
  return result;
}

function comparePlaylogNotes(left: PlaylogNote, right: PlaylogNote): number {
  if (left.timeUs !== right.timeUs) {
    return left.timeUs - right.timeUs;
  }
  if (left.channel !== right.channel) {
    return left.channel < right.channel ? -1 : 1;
  }
  if (left.type !== right.type) {
    return left.type < right.type ? -1 : 1;
  }
  return 0;
}

function secondsToMicroseconds(seconds: number): number {
  return Math.round(seconds * 1_000_000);
}

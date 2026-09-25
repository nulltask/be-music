import { resolveBmsBase, type BeMusicJson } from '@be-music/json';
import type { PlayerSummary } from '../core/engine.ts';
import type { PreparedPlaybackChartData } from '../core/bootstrap.ts';
import { resolveJudgeRankPercent } from '../core/judge-window.ts';
import { resolveChartLongNoteMode } from '../ruleset/index.ts';
import { resolveLandmineGaugeEffect } from '../core/landmine.ts';
import type { GrooveGaugeType } from '../core/groove-gauge.ts';
import {
  BE_MUSIC_PLAYLOG_FORMAT,
  BE_MUSIC_PLAYLOG_VERSION,
  type BeMusicPlaylog,
  type PlaylogChart,
  type PlaylogInputAction,
  type PlaylogInputEvent,
  type PlaylogNote,
  type PlaylogPlay,
  type PlaylogRulesetResult,
} from './format.ts';

/** Ruleset id used for the engine's own summary cached into `results` at record time. */
export const PLAYLOG_NATIVE_RULESET_ID = 'be-music/native';

/**
 * Chart data the recorder snapshots — structurally a subset of the engine's `PreparedPlaybackChartData`, so the
 * engine can hand its prepared bundle over verbatim.
 */
export type PlaylogRecorderChartData = Pick<
  PreparedPlaybackChartData,
  'notes' | 'landmineNotes' | 'invisibleNotes' | 'activeFreeZoneChannels' | 'scorableNotes' | 'laneDisplayMode'
>;

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
  native?: Record<string, string | number | boolean | null>;
}

/**
 * Host-declared subset of the recording inputs — the fields the engine cannot know by itself. Passed through
 * `PlayerOptions.recordPlaylog`. `chartSha256` is the SHA-256 (lowercase hex) of the source chart FILE bytes;
 * hosts that have the raw file compute it so dropped logs can be matched back to their chart by content.
 */
export type PlaylogRecordingOptions = Pick<
  PlaylogRecorderPlaySettings,
  'gauge' | 'randomLane' | 'dpFlip' | 'native'
> & {
  chartSha256?: string;
};

export interface PlaylogRecorderOptions {
  /** Resolved chart JSON (post `#RANDOM` control flow) — metadata source. */
  json: BeMusicJson;
  chart: PlaylogRecorderChartData;
  /** SHA-256 (lowercase hex) of the source chart file bytes, when the host computed one. */
  chartSha256?: string;
  play: PlaylogRecorderPlaySettings;
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
      if (aborted === true) play.aborted = true;
      if (options.play.native !== undefined) play.native = options.play.native;

      const createdAt = (options.now?.() ?? new Date()).toISOString();
      return {
        format: BE_MUSIC_PLAYLOG_FORMAT,
        version: BE_MUSIC_PLAYLOG_VERSION,
        createdAt,
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
  const chartLnMode = resolveChartLongNoteMode(json);
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
      damage: resolveLandmineGaugeEffect(mine.event, idBase).damage,
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

  const judgeRank: PlaylogChart['judgeRank'] = {
    percent: resolveJudgeRankPercent(json),
  };
  const sourceRank = json.metadata.rank;
  if (typeof sourceRank === 'number' && Number.isFinite(sourceRank)) {
    judgeRank.sourceRank = sourceRank;
  }
  const sourceExRank = json.sourceFormat === 'bmson' ? json.bmson.info.judgeRank : json.bms.defExRank;
  if (typeof sourceExRank === 'number' && Number.isFinite(sourceExRank)) {
    judgeRank.sourceExRank = sourceExRank;
  }
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
  if (typeof json.metadata.title === 'string' && json.metadata.title.length > 0) result.title = json.metadata.title;
  if (typeof json.metadata.subtitle === 'string' && json.metadata.subtitle.length > 0) {
    result.subtitle = json.metadata.subtitle;
  }
  if (typeof json.metadata.artist === 'string' && json.metadata.artist.length > 0) result.artist = json.metadata.artist;
  if (typeof json.metadata.genre === 'string' && json.metadata.genre.length > 0) result.genre = json.metadata.genre;
  if (typeof json.metadata.total === 'number' && Number.isFinite(json.metadata.total)) {
    result.total = json.metadata.total;
  }
  return result;
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

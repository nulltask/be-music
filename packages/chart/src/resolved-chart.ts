import {
  normalizeChannel,
  normalizeObjectKey,
  resolveBmsBase,
  type BeMusicEvent,
  type BeMusicJson,
  type BeMusicSourceFormat,
} from '@be-music/json';
import { buildBgaTimelines, type BgaTimelines } from './bga.ts';
import { hasControlFlow, type RandomDraws } from './control-flow.ts';
import {
  isBmsBgmVolumeChangeChannel,
  isBmsDynamicVolumeChangeChannel,
  isBmsKeyVolumeChangeChannel,
  parseBmsDynamicVolumeGain,
  resolveChartPlayVariant,
  type BeatResolver,
  type ChartPlayVariant,
} from './index.ts';
import { resolveChartLongNoteMode, type LongNoteMode } from './note-rules.ts';
import { getPlayModeLayouts, type PlayModeLayout } from './play-modes.ts';
import {
  resolveInvisibleNotes,
  resolveJudgedNoteEntries,
  resolveJudgedNotes,
  resolveMineNotes,
  type ResolvedNote,
  type ResolvedNoteContext,
  type ResolvedNoteLists,
} from './resolved-notes.ts';
import { collectSampleTriggersWithContext, type TimedSampleTrigger } from './sample-triggers.ts';
import {
  createMeasureBoundariesBeats,
  createScrollTimeline,
  createSpeedTimeline,
  type ScrollTimelinePoint,
  type SpeedTimelinePoint,
} from './timelines.ts';
import {
  createTimingBuildContext,
  createTimingResolverWithContext,
  type TempoReversalPoint,
  type TimingResolver,
} from './timing.ts';

export interface ResolveChartOptions {
  /**
   * The `#RANDOM` / `#SWITCH` outcomes the chart was resolved with (`drawRandomOutcomes`), recorded on the result for
   * the play log and the RANDOM summary. `resolveChart` does not apply them: resolve the control flow first
   * (`resolveBmsControlFlowWithDraws` in `@be-music/parser`, or `resolvePlayChart` in `@be-music/player`).
   */
  randomDraws?: RandomDraws;
  /** The chart's path or extension (`.pms` names 9 KEY). Only consulted when `playVariant` is omitted. */
  chartPath?: string;
  /** The play variant, when the host already decided it. Defaults to `resolveChartPlayVariant` over the chart. */
  playVariant?: ChartPlayVariant;
  /**
   * Infer `#LNTYPE 1` for `5x` / `6x` long notes when the chart declares no `#LNTYPE` (the browser hosts' choice);
   * otherwise such a chart reads `5x` / `6x` the strict way. Defaults to `false`, the engine's default.
   */
  inferBmsLnTypeWhenMissing?: boolean;
}

/** The judge-rank inputs a ruleset turns into judge windows. Raw chart values: each ruleset applies its own defaults. */
export interface ResolvedJudgeRank {
  /** `#RANK` (BMS) or the parsed rank, when the chart has one. */
  readonly rank?: number;
  /** `#DEFEXRANK` (BMS) or `info.judge_rank` (bmson), when the chart has one. */
  readonly exRank?: number;
  /** `#EXRANKxx` changes placed on channel `A0` (BMS), in time order, with the raw `#EXRANK` value (100 = NORMAL). */
  readonly changes: ReadonlyArray<{ readonly seconds: number; readonly exRankValue: number }>;
}

/** A BMS dynamic volume change (`#xxx97` BGM / `#xxx98` key sounds). */
export interface ResolvedVolumeChange {
  readonly seconds: number;
  /** Which bus the change scales: `bgm` (channel `97`) or `play` (channel `98`, the key sounds). */
  readonly bus: 'bgm' | 'play';
  /** Linear gain (`parseBmsDynamicVolumeGain`). */
  readonly gain: number;
  readonly event: BeMusicEvent;
}

/** The chart's TOTAL as authored. */
export interface ResolvedTotal {
  /** `#TOTAL` (BMS) or `info.total` (bmson), when the chart has a finite one. */
  readonly value?: number;
  /** `absolute` for BMS `#TOTAL`; `percent` for bmson, whose `total` is a percentage of the ruleset's default TOTAL. */
  readonly unit: 'absolute' | 'percent';
}

/**
 * A chart ready to play: the Resolved layer every player-side consumer reads, built once from the Source layer
 * (`BeMusicJson`) by {@link resolveChart}. Control flow is decided (the draws are recorded), the lane mode is fixed,
 * long notes, mines, invisible objects, FREE ZONE and duplicate notes are resolved, and every time is in seconds after
 * BPM / STOP / `#STP`. Consumers never re-read the format rules from the source chart.
 *
 * The heavy parts (notes, triggers, timelines) are computed on first access and then kept, so a consumer only pays for
 * what it reads. The value is deterministic: the same source and options always give the same result.
 */
export interface ResolvedChart {
  /** The (control-flow-resolved) source chart this was resolved from: metadata, resources and raw sections. */
  readonly source: BeMusicJson;
  readonly sourceFormat: BeMusicSourceFormat;
  /** The `#RANDOM` / `#SWITCH` outcomes the source was resolved with (`[]` when the chart had none or none were given). */
  readonly randomDraws: RandomDraws;
  /**
   * `true` when the source still carries `#RANDOM` / `#SWITCH` control flow. Only its unconditional content is then
   * resolved — what a song list shows before any draw; a play must resolve the control flow first.
   */
  readonly hasUnresolvedControlFlow: boolean;
  /** The object-ID base (`#BASE 62` or 36) keysound and resource keys are normalized under. */
  readonly idBase: 36 | 62;
  readonly playVariant: ChartPlayVariant;
  /** The play-mode table layouts of `playVariant` (two for 9 KEY: PMS-STD and BME-type). */
  readonly layouts: ReadonlyArray<PlayModeLayout>;
  /** The chart-level long-note mode (`#LNMODE` / bmson `info.ln_type`, otherwise LN). */
  readonly lnMode: LongNoteMode;
  readonly inferBmsLnTypeWhenMissing: boolean;
  readonly beatResolver: BeatResolver;
  /** The tempo map: BPM points, STOP / `#STP` points, beat → seconds. */
  readonly timing: TimingResolver;
  /**
   * The LR2 negative-BPM reversal (`timing.reversal`): where the first negative `#BPMxx` arms the reverse scroll and
   * the event pump freezes. Absent when the chart has none. See docs/bms-spec.md "Negative BPM".
   */
  readonly reversal: TempoReversalPoint | undefined;
  /** The source events in chart order (`sortEvents`). */
  readonly sortedEvents: ReadonlyArray<BeMusicEvent>;
  /** Judged notes (`tap` / `ln`), one per lane and position. */
  readonly notes: ReadonlyArray<ResolvedNote>;
  /** Duplicate notes that lost their lane and position to a judged note but carry another keysound. */
  readonly shadowedNotes: ReadonlyArray<ResolvedNote>;
  readonly mines: ReadonlyArray<ResolvedNote>;
  readonly invisibleNotes: ReadonlyArray<ResolvedNote>;
  /**
   * Every sound the chart triggers by itself or from a lane: BGM (`01`), lane keysounds and invisible objects, with
   * `#LNOBJ` ends and suppressed `#LNTYPE` halves left out and bmson slices resolved. Mines are not included.
   */
  readonly sampleTriggers: ReadonlyArray<TimedSampleTrigger>;
  /** BMS dynamic volume changes, in chart order (empty for bmson). */
  readonly volumeChanges: ReadonlyArray<ResolvedVolumeChange>;
  /** BGA cues (base / layer / layer 2 / POOR), BMS channels and bmson `bga` alike. */
  readonly bga: BgaTimelines;
  readonly scroll: ReadonlyArray<ScrollTimelinePoint>;
  readonly speed: ReadonlyArray<SpeedTimelinePoint>;
  /** Bar-line beats; empty when the chart suppresses them (bmson `lines: []`). */
  readonly barLines: ReadonlyArray<number>;
  readonly barLinesSuppressed: boolean;
  readonly judgeRank: ResolvedJudgeRank;
  readonly total: ResolvedTotal;
  /** When the last judged note, mine or invisible object ends, in seconds. */
  readonly lastNoteSeconds: number;
}

/**
 * The single Source → Resolved step: resolves `chart` for play and returns its {@link ResolvedChart}.
 *
 * `chart` should already carry no control flow (resolve it with `resolveBmsControlFlowWithDraws` or `resolvePlayChart`
 * and pass the draws as `options.randomDraws`); a chart that still does is resolved from its unconditional content
 * only, as a song list sees it.
 */
export function resolveChart(chart: BeMusicJson, options: ResolveChartOptions = {}): ResolvedChart {
  return new LazyResolvedChart(chart, options);
}

/** What {@link countScoredNotes} reports: the scored notes and the play variant they were resolved under. */
export interface ScoredNoteCount {
  /** The notes the engine scores: the judged notes without FREE ZONE ones (a long note counts once). */
  readonly notes: number;
  readonly playVariant: ChartPlayVariant;
}

/** Notes carry their time in seconds; counting them needs none, so this stands in for a BPM / STOP timing resolver. */
const NO_SECONDS = { beatToSeconds: () => 0 } as unknown as TimingResolver;

/**
 * How many notes a chart scores, as `resolveChart(chart, options).notes` counts them without its FREE ZONE notes, and
 * the play variant that decided FREE ZONE. A song list needs only the count, so this resolves the same judged notes
 * without timing every one of them.
 */
export function countScoredNotes(
  chart: BeMusicJson,
  options: Omit<ResolveChartOptions, 'randomDraws'> = {},
): ScoredNoteCount {
  const playVariant =
    options.playVariant ??
    resolveChartPlayVariant({
      chartPath: options.chartPath,
      events: chart.events,
      bms: chart.bms,
      bmson: chart.bmson,
    });
  const context = createTimingBuildContext(chart);
  const { notes } = resolveJudgedNoteEntries({
    json: chart,
    timing: NO_SECONDS,
    beatResolver: context.beatResolver,
    sortedEvents: context.sortedEvents,
    idBase: resolveBmsBase(chart),
    resolvePlayVariant: () => playVariant,
    inferBmsLnTypeWhenMissing: options.inferBmsLnTypeWhenMissing === true,
  });
  let count = 0;
  for (const note of notes) {
    if (note.freeZone !== true) {
      count += 1;
    }
  }
  return { notes: count, playVariant };
}

class LazyResolvedChart implements ResolvedChart {
  readonly source: BeMusicJson;
  readonly sourceFormat: BeMusicSourceFormat;
  readonly randomDraws: RandomDraws;
  readonly hasUnresolvedControlFlow: boolean;
  readonly idBase: 36 | 62;
  readonly inferBmsLnTypeWhenMissing: boolean;
  readonly beatResolver: BeatResolver;
  readonly sortedEvents: ReadonlyArray<BeMusicEvent>;
  readonly timing: TimingResolver;
  readonly reversal: TempoReversalPoint | undefined;
  private readonly playVariantInput: ChartPlayVariant | undefined;
  private readonly chartPath: string | undefined;
  private playVariantCache: ChartPlayVariant | undefined;
  private judgedCache: ResolvedNoteLists | undefined;
  private minesCache: ResolvedNote[] | undefined;
  private invisibleCache: ResolvedNote[] | undefined;
  private triggersCache: TimedSampleTrigger[] | undefined;
  private bgaCache: BgaTimelines | undefined;
  private volumeCache: ResolvedVolumeChange[] | undefined;
  private scrollCache: ScrollTimelinePoint[] | undefined;
  private speedCache: SpeedTimelinePoint[] | undefined;
  private barLinesCache: number[] | undefined;
  private judgeRankCache: ResolvedJudgeRank | undefined;

  constructor(chart: BeMusicJson, options: ResolveChartOptions) {
    this.source = chart;
    this.sourceFormat = chart.sourceFormat;
    this.randomDraws = options.randomDraws ?? [];
    this.hasUnresolvedControlFlow = hasControlFlow(chart);
    this.idBase = resolveBmsBase(chart);
    this.playVariantInput = options.playVariant;
    this.chartPath = options.chartPath;
    this.inferBmsLnTypeWhenMissing = options.inferBmsLnTypeWhenMissing === true;
    const context = createTimingBuildContext(chart);
    this.beatResolver = context.beatResolver;
    this.sortedEvents = context.sortedEvents;
    this.timing = createTimingResolverWithContext(chart, context);
    this.reversal = this.timing.reversal;
  }

  get playVariant(): ChartPlayVariant {
    this.playVariantCache ??=
      this.playVariantInput ??
      resolveChartPlayVariant({
        chartPath: this.chartPath,
        events: this.source.events,
        bms: this.source.bms,
        bmson: this.source.bmson,
      });
    return this.playVariantCache;
  }

  get layouts(): ReadonlyArray<PlayModeLayout> {
    return getPlayModeLayouts(this.playVariant);
  }

  get lnMode(): LongNoteMode {
    return resolveChartLongNoteMode(this.source);
  }

  get notes(): ReadonlyArray<ResolvedNote> {
    return this.judged().notes;
  }

  get shadowedNotes(): ReadonlyArray<ResolvedNote> {
    return this.judged().shadowedNotes;
  }

  get mines(): ReadonlyArray<ResolvedNote> {
    this.minesCache ??= resolveMineNotes(this.noteContext());
    return this.minesCache;
  }

  get invisibleNotes(): ReadonlyArray<ResolvedNote> {
    this.invisibleCache ??= resolveInvisibleNotes(this.noteContext());
    return this.invisibleCache;
  }

  get sampleTriggers(): ReadonlyArray<TimedSampleTrigger> {
    this.triggersCache ??= collectSampleTriggersWithContext(
      this.source,
      this.timing,
      { sortedEvents: this.sortedEvents as BeMusicEvent[], beatResolver: this.beatResolver },
      { inferBmsLnTypeWhenMissing: this.inferBmsLnTypeWhenMissing },
    );
    return this.triggersCache;
  }

  get volumeChanges(): ReadonlyArray<ResolvedVolumeChange> {
    this.volumeCache ??= resolveVolumeChanges(this.source, this.sortedEvents, this.timing);
    return this.volumeCache;
  }

  get bga(): BgaTimelines {
    this.bgaCache ??= buildBgaTimelines(this.source, this.timing);
    return this.bgaCache;
  }

  get scroll(): ReadonlyArray<ScrollTimelinePoint> {
    this.scrollCache ??= createScrollTimeline(this.source, this.beatResolver);
    return this.scrollCache;
  }

  get speed(): ReadonlyArray<SpeedTimelinePoint> {
    this.speedCache ??= createSpeedTimeline(this.source, this.beatResolver);
    return this.speedCache;
  }

  get barLinesSuppressed(): boolean {
    return this.source.bmson.barlinesSuppressed === true;
  }

  get barLines(): ReadonlyArray<number> {
    this.barLinesCache ??= this.barLinesSuppressed ? [] : createMeasureBoundariesBeats(this.source, this.beatResolver);
    return this.barLinesCache;
  }

  get judgeRank(): ResolvedJudgeRank {
    this.judgeRankCache ??= resolveJudgeRank(this.source, this.sortedEvents, this.timing, this.idBase);
    return this.judgeRankCache;
  }

  get total(): ResolvedTotal {
    return resolveTotalFacts(this.source);
  }

  get lastNoteSeconds(): number {
    let last = 0;
    for (const note of this.notes) {
      const end =
        typeof note.endSeconds === 'number' && Number.isFinite(note.endSeconds) && note.endSeconds > note.seconds
          ? note.endSeconds
          : note.seconds;
      if (end > last) {
        last = end;
      }
    }
    return Math.max(last, this.mines.at(-1)?.seconds ?? 0, this.invisibleNotes.at(-1)?.seconds ?? 0);
  }

  private judged(): ResolvedNoteLists {
    this.judgedCache ??= resolveJudgedNotes(this.noteContext());
    return this.judgedCache;
  }

  private noteContext(): ResolvedNoteContext {
    return {
      json: this.source,
      timing: this.timing,
      beatResolver: this.beatResolver,
      sortedEvents: this.sortedEvents,
      idBase: this.idBase,
      resolvePlayVariant: () => this.playVariant,
      inferBmsLnTypeWhenMissing: this.inferBmsLnTypeWhenMissing,
    };
  }
}

function resolveVolumeChanges(
  json: BeMusicJson,
  sortedEvents: ReadonlyArray<BeMusicEvent>,
  timing: TimingResolver,
): ResolvedVolumeChange[] {
  if (json.sourceFormat !== 'bms') {
    return [];
  }
  const changes: ResolvedVolumeChange[] = [];
  for (const event of sortedEvents) {
    const channel = normalizeChannel(event.channel);
    if (!isBmsDynamicVolumeChangeChannel(channel)) {
      continue;
    }
    const gain = parseBmsDynamicVolumeGain(event.value);
    if (gain === undefined) {
      continue;
    }
    changes.push({
      seconds: timing.eventToSeconds(event),
      bus: isBmsBgmVolumeChangeChannel(channel) && !isBmsKeyVolumeChangeChannel(channel) ? 'bgm' : 'play',
      gain,
      event,
    });
  }
  return changes;
}

function resolveJudgeRank(
  json: BeMusicJson,
  sortedEvents: ReadonlyArray<BeMusicEvent>,
  timing: TimingResolver,
  idBase: 36 | 62,
): ResolvedJudgeRank {
  const changes = collectExRankChanges(json, sortedEvents, idBase).map((change) => ({
    seconds: timing.eventToSeconds(change.event),
    exRankValue: change.exRankValue,
  }));
  return { ...resolveJudgeRankFacts(json), changes };
}

/**
 * The chart's own judge-rank values: `#RANK` (or the parsed rank) and `#DEFEXRANK` / bmson `judge_rank`, each only when
 * the chart has a finite one. Not part of the package API; {@link ResolvedChart.judgeRank} and the chart fingerprint
 * read them.
 */
export function resolveJudgeRankFacts(json: BeMusicJson): { rank?: number; exRank?: number } {
  const facts: { rank?: number; exRank?: number } = {};
  const rank = json.metadata.rank;
  if (typeof rank === 'number' && Number.isFinite(rank)) {
    facts.rank = rank;
  }
  const exRank = json.sourceFormat === 'bmson' ? json.bmson.info.judgeRank : json.bms.defExRank;
  if (typeof exRank === 'number' && Number.isFinite(exRank)) {
    facts.exRank = exRank;
  }
  return facts;
}

/** An `#EXRANKxx` change (BMS channel `A0`) with a positive value; `raw` is the definition as written. */
export interface ExRankChange {
  readonly event: BeMusicEvent;
  readonly raw: string;
  readonly exRankValue: number;
}

/**
 * The `#EXRANKxx` changes of a BMS chart in chart order (none for bmson): `A0` objects whose `#EXRANKxx` reads as a
 * positive number. Not part of the package API.
 */
export function collectExRankChanges(
  json: BeMusicJson,
  sortedEvents: ReadonlyArray<BeMusicEvent>,
  idBase: 36 | 62,
): ExRankChange[] {
  const changes: ExRankChange[] = [];
  if (json.sourceFormat !== 'bms') {
    return changes;
  }
  for (const event of sortedEvents) {
    if (normalizeChannel(event.channel) !== 'A0') {
      continue;
    }
    const raw = json.bms.exRank[normalizeObjectKey(event.value, idBase)];
    const parsed = Number.parseFloat(raw ?? '');
    if (raw === undefined || !Number.isFinite(parsed) || parsed <= 0) {
      continue;
    }
    changes.push({ event, raw, exRankValue: parsed });
  }
  return changes;
}

/**
 * The chart's TOTAL as authored: `#TOTAL` (absolute) or bmson `info.total` (a percentage of the ruleset's default),
 * with `value` only when it is finite. Not part of the package API; {@link ResolvedChart.total} and the chart
 * fingerprint read it.
 */
export function resolveTotalFacts(json: BeMusicJson): ResolvedTotal {
  const value = json.metadata.total;
  const unit = json.sourceFormat === 'bmson' ? 'percent' : 'absolute';
  return typeof value === 'number' && Number.isFinite(value) ? { value, unit } : { unit };
}

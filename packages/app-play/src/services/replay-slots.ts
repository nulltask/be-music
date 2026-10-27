// The replay slots: four replays the player keeps per chart and per course in this browser, as beatoraja keeps four
// replay files per chart (`PlayDataAccessor`). A result screen saves its play into a slot, by hand (keys 1-4, a skin's
// replay buttons) or by the slot's auto-save rule, and the select screen plays one back. Each slot holds the replay as a
// gzip-compressed `.bmplay.json` / `.bmcourse.json`, next to a small record of what it holds. All slots share one size
// budget: past it, the slots whose replays score worst go first.

import { computeChartFingerprint } from '@be-music/chart-model';
import {
  computeCourseFingerprint,
  parseCourseReplay,
  parseReplay,
  serializeCourseReplay,
  serializeReplay,
  type BeMusicCourseReplay,
  type BeMusicReplay,
} from '@be-music/player-engine/replay';
import { clearLampRank, type ClearLamp } from '@be-music/player-engine/ruleset';
import type { BestRecord, RecordPlay } from '@be-music/player-engine/records';
import { REPLAY_SLOT_COUNT, type LibraryChart, type LibraryCourse } from '@be-music/player-scene-model';

export { REPLAY_SLOT_COUNT };

/** The budget every slot shares, in compressed bytes: past it, the worst-scoring replays are removed. */
export const REPLAY_SLOT_BUDGET_BYTES = 500 * 1024 * 1024;

/** Bumped when a stored record's shape changes; a record of another version is ignored. */
const RECORD_VERSION = 1;

/**
 * What a slot belongs to: a chart, by its chart fingerprint (`bmfp0:…`, or `sha256:<file hash>` for a chart that cannot
 * be fingerprinted), or a course, by its course fingerprint (`bmcourse0:…`).
 */
export interface ReplaySlotTarget {
  readonly kind: 'chart' | 'course';
  readonly id: string;
}

/** What a slot holds, kept apart from the replay itself so the slots can be listed without reading any replay. */
export interface ReplaySlotRecord {
  readonly version: typeof RECORD_VERSION;
  /** {@link replaySlotKey}. */
  readonly key: string;
  readonly target: ReplaySlotTarget;
  /** 0 to {@link REPLAY_SLOT_COUNT} − 1. */
  readonly slot: number;
  /** When it was saved (ISO 8601). */
  readonly savedAt: string;
  /** The compressed replay's size in bytes. */
  readonly size: number;
  /** The chart's or the course's title, for the slot lists. */
  readonly title: string;
  readonly exScore: number;
  /** EX score over its maximum (0 to 1): the score the budget removes the worst of first. */
  readonly exRate: number;
  readonly lamp: ClearLamp;
}

/** The score of a replay being saved: its result as a best record would take it, and its judgment-note count. */
export interface ReplaySlotScore extends RecordPlay {
  readonly noteCount: number;
}

/** The replay a slot keeps: a single play's, or a course run's. */
export type ReplaySlotPayload =
  | { readonly kind: 'chart'; readonly replay: BeMusicReplay }
  | { readonly kind: 'course'; readonly replay: BeMusicCourseReplay };

/** How a save went. */
export type ReplaySlotSaveOutcome =
  | { readonly saved: true; readonly record: ReplaySlotRecord; readonly evicted: readonly ReplaySlotRecord[] }
  | { readonly saved: false; readonly reason: 'budget' | 'storage'; readonly error?: unknown };

/** Where the slots are kept: IndexedDB in the browser (`replay-slot-database.ts`), a map in tests. */
export interface ReplaySlotBackend {
  /** Every slot record kept. */
  listRecords(): Promise<unknown[]>;
  /** A slot's compressed replay. */
  readData(key: string): Promise<Blob | undefined>;
  /** Writes a slot (its record and replay) and removes others, all in one transaction. */
  write(entry: { record: ReplaySlotRecord; data: Blob } | undefined, remove: readonly string[]): Promise<void>;
}

/** The key of one slot: `<kind>:<id>#<slot>`. */
export function replaySlotKey(target: ReplaySlotTarget, slot: number): string {
  return `${target.kind}:${target.id}#${slot}`;
}

/** Whether `slot` names a slot. */
export function isReplaySlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < REPLAY_SLOT_COUNT;
}

/** The slot target of a chart, from its chart fingerprint, or its file's SHA-256 when it has none. */
export function chartReplaySlotTarget(
  chart: { chartFingerprint?: string; sha256?: string } | undefined,
): ReplaySlotTarget | undefined {
  if (chart?.chartFingerprint !== undefined && chart.chartFingerprint.length > 0) {
    return { kind: 'chart', id: chart.chartFingerprint };
  }
  if (chart?.sha256 !== undefined && chart.sha256.length > 0) return { kind: 'chart', id: `sha256:${chart.sha256}` };
  return undefined;
}

/** The slot target of a single play's replay: the chart it played. */
export function replaySlotTargetOfReplay(replay: BeMusicReplay): ReplaySlotTarget | undefined {
  return chartReplaySlotTarget(replay.chart);
}

const libraryChartTargets = new WeakMap<LibraryChart, ReplaySlotTarget | null>();

/**
 * The slot target of a library chart: its chart fingerprint, as a play of it records it (computed once per chart).
 * `undefined` for a chart that cannot be fingerprinted, whose slots are then out of reach from the select screen.
 */
export function libraryChartReplaySlotTarget(chartEntry: LibraryChart): ReplaySlotTarget | undefined {
  let target = libraryChartTargets.get(chartEntry);
  if (target === undefined) {
    try {
      target = { kind: 'chart', id: computeChartFingerprint(chartEntry.chart, { chartPath: chartEntry.chartPath }) };
    } catch {
      target = null;
    }
    libraryChartTargets.set(chartEntry, target);
  }
  return target ?? undefined;
}

/**
 * The slot target of a course bar: its course fingerprint over its stages' charts, as a run of it records it. A random
 * course (its stages are drawn on start), a NEW COURSE bar, a RANDOM MIX bar and a course with a stage missing have none.
 */
export function libraryCourseReplaySlotTarget(
  course: LibraryCourse,
  placement: 'intended' | 'lr2',
  fingerprintOf: (chartEntry: LibraryChart) => ReplaySlotTarget | undefined = libraryChartReplaySlotTarget,
): ReplaySlotTarget | undefined {
  if (course.random !== undefined || course.newCourse === true || course.randomMix === true || !course.playable) {
    return undefined;
  }
  const stageChartFingerprints: string[] = [];
  for (const stage of course.stages) {
    const chart = stage.chart;
    const target = chart !== undefined ? fingerprintOf(chart) : undefined;
    if (target === undefined || target.id.startsWith('sha256:')) return undefined;
    stageChartFingerprints.push(target.id);
  }
  const { definition } = course;
  return {
    kind: 'course',
    id: computeCourseFingerprint({
      kind: definition.kind,
      constraints: definition.constraints,
      stageChartFingerprints,
      ...(definition.kind === 'nonstop' ? { nonstop: { connections: definition.connections ?? [], placement } } : {}),
    }),
  };
}

/**
 * The rules beatoraja's result applies to each slot on entry (`ReplayAutoSaveConstraint`), against the best record as
 * it was before the play: never, on a better (or equal) EX score, fewer (or as few) BP, a better (or equal) max combo,
 * a better (or equal) clear lamp, any of those better, or always.
 */
export const REPLAY_AUTO_SAVE_RULES = [
  'never',
  'score-update',
  'score-update-or-equal',
  'miss-count-update',
  'miss-count-update-or-equal',
  'max-combo-update',
  'max-combo-update-or-equal',
  'clear-update',
  'clear-update-or-equal',
  'any-update',
  'always',
] as const;

/** A slot's auto-save rule (see {@link REPLAY_AUTO_SAVE_RULES}). */
export type ReplayAutoSaveRule = (typeof REPLAY_AUTO_SAVE_RULES)[number];

/**
 * The four slots' rules until the player picks others, so every slot keeps something by itself: the best EX score
 * (slot 1), the best clear lamp (slot 2), the fewest BP (slot 3) and the latest play (slot 4). beatoraja ships them all
 * as NOTHING; be-music saves by default, with beatoraja's own rules.
 */
export const DEFAULT_REPLAY_AUTO_SAVE_RULES: readonly ReplayAutoSaveRule[] = [
  'score-update',
  'clear-update',
  'miss-count-update',
  'always',
];

/** Reads stored rules back: four of them, an unknown one read as the slot's default. */
export function normalizeReplayAutoSaveRules(value: unknown): ReplayAutoSaveRule[] {
  const rules = Array.isArray(value) ? value : [];
  return Array.from({ length: REPLAY_SLOT_COUNT }, (_, index) => {
    const rule = rules[index];
    return (REPLAY_AUTO_SAVE_RULES as readonly unknown[]).includes(rule)
      ? (rule as ReplayAutoSaveRule)
      : DEFAULT_REPLAY_AUTO_SAVE_RULES[index]!;
  });
}

/**
 * Whether `rule` saves a play that scored `play` over the best record `previous` held before it. Without a record the
 * play is the first: as beatoraja's empty score (NO PLAY, EX 0, max combo 0), every update qualifies, and a BP rule
 * always does.
 */
export function qualifiesReplayAutoSave(
  rule: ReplayAutoSaveRule,
  previous: BestRecord | undefined,
  play: RecordPlay,
): boolean {
  const exScore = previous?.exScore ?? 0;
  const maxCombo = previous?.maxCombo ?? 0;
  const lamp = clearLampRank(previous?.lamp ?? 'NO_PLAY');
  const unplayed = previous === undefined || previous.lamp === 'NO_PLAY';
  const missCount = previous?.missCount ?? Number.POSITIVE_INFINITY;
  switch (rule) {
    case 'never':
      return false;
    case 'score-update':
      return play.exScore > exScore;
    case 'score-update-or-equal':
      return play.exScore >= exScore;
    case 'miss-count-update':
      return play.missCount < missCount || unplayed;
    case 'miss-count-update-or-equal':
      return play.missCount <= missCount || unplayed;
    case 'max-combo-update':
      return play.maxCombo > maxCombo;
    case 'max-combo-update-or-equal':
      return play.maxCombo >= maxCombo;
    case 'clear-update':
      return clearLampRank(play.lamp) > lamp;
    case 'clear-update-or-equal':
      return clearLampRank(play.lamp) >= lamp;
    case 'any-update':
      return (
        clearLampRank(play.lamp) > lamp ||
        play.maxCombo > maxCombo ||
        play.missCount < missCount ||
        play.exScore > exScore
      );
    case 'always':
      return true;
  }
}

/** The slots `rules` save a play into, in order. */
export function resolveReplayAutoSaveSlots(
  rules: readonly ReplayAutoSaveRule[],
  previous: BestRecord | undefined,
  play: RecordPlay,
): number[] {
  const slots: number[] = [];
  rules.slice(0, REPLAY_SLOT_COUNT).forEach((rule, slot) => {
    if (qualifiesReplayAutoSave(rule, previous, play)) slots.push(slot);
  });
  return slots;
}

/** Which of two slots goes first when the budget runs out: the lower EX rate, then the older save. */
function compareWorstFirst(
  a: Pick<ReplaySlotRecord, 'exRate' | 'savedAt'>,
  b: Pick<ReplaySlotRecord, 'exRate' | 'savedAt'>,
): number {
  if (a.exRate !== b.exRate) return a.exRate - b.exRate;
  return a.savedAt < b.savedAt ? -1 : a.savedAt > b.savedAt ? 1 : 0;
}

/**
 * What saving `incoming` takes within `budget` bytes: the slots to remove for it, worst-scoring first (the slot it
 * replaces aside, which goes anyway), or `undefined` when it does not fit — it is larger than the budget, or it would be
 * the worst replay left over the budget itself.
 */
export function planReplaySlotEviction(
  records: readonly ReplaySlotRecord[],
  incoming: Pick<ReplaySlotRecord, 'key' | 'size' | 'exRate' | 'savedAt'>,
  budget: number,
): ReplaySlotRecord[] | undefined {
  if (incoming.size > budget) return undefined;
  const others = records.filter((record) => record.key !== incoming.key);
  let total = others.reduce((sum, record) => sum + record.size, incoming.size);
  if (total <= budget) return [];
  const candidates: Array<Pick<ReplaySlotRecord, 'key' | 'size' | 'exRate' | 'savedAt'>> = [...others, incoming];
  candidates.sort(compareWorstFirst);
  const evicted: ReplaySlotRecord[] = [];
  for (const candidate of candidates) {
    if (total <= budget) break;
    if (candidate === incoming) return undefined;
    evicted.push(candidate as ReplaySlotRecord);
    total -= candidate.size;
  }
  return evicted;
}

/** Reads a stored slot record back, or `undefined` when it is not one of this version. */
export function parseReplaySlotRecord(value: unknown): ReplaySlotRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Partial<ReplaySlotRecord>;
  const target = record.target;
  if (
    record.version !== RECORD_VERSION ||
    typeof record.key !== 'string' ||
    typeof target !== 'object' ||
    target === null ||
    (target.kind !== 'chart' && target.kind !== 'course') ||
    typeof target.id !== 'string' ||
    typeof record.slot !== 'number' ||
    !isReplaySlot(record.slot) ||
    record.key !== replaySlotKey(target, record.slot) ||
    typeof record.savedAt !== 'string' ||
    typeof record.size !== 'number' ||
    typeof record.exRate !== 'number' ||
    typeof record.exScore !== 'number' ||
    typeof record.title !== 'string' ||
    typeof record.lamp !== 'string'
  ) {
    return undefined;
  }
  return record as ReplaySlotRecord;
}

/** Gzips `text` (`CompressionStream`). */
export async function compressReplayText(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob().then((blob) => new Blob([blob], { type: 'application/gzip' }));
}

/** The text {@link compressReplayText} compressed. */
export async function decompressReplayText(data: Blob): Promise<string> {
  return new Response(data.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

/** The four slots of a target, by slot: each one's record, or `undefined` when it is empty. */
export type ReplaySlotList = readonly (ReplaySlotRecord | undefined)[];

export interface ReplaySlotStoreOptions {
  readonly backend: ReplaySlotBackend;
  /** The shared budget in compressed bytes ({@link REPLAY_SLOT_BUDGET_BYTES}). */
  readonly budgetBytes?: number;
  /** The clock a save is stamped with. */
  readonly now?: () => Date;
}

/**
 * The replay slots: every slot's record held in memory once {@link load}ed, so the screens can ask which slots a chart
 * has on every frame, and each replay read from the backend only when it is played. Saves go one at a time.
 */
export class ReplaySlotStore {
  private readonly backend: ReplaySlotBackend;
  private readonly budgetBytes: number;
  private readonly now: () => Date;
  private readonly records = new Map<string, ReplaySlotRecord>();
  private loading: Promise<void> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  public constructor(options: ReplaySlotStoreOptions) {
    this.backend = options.backend;
    this.budgetBytes = options.budgetBytes ?? REPLAY_SLOT_BUDGET_BYTES;
    this.now = options.now ?? (() => new Date());
  }

  /** Reads every slot record (once; later calls wait on the first). A backend that fails leaves no slot. */
  public load(): Promise<void> {
    this.loading ??= this.backend.listRecords().then(
      (values) => {
        for (const value of values) {
          const record = parseReplaySlotRecord(value);
          if (record !== undefined) this.records.set(record.key, record);
        }
        this.notify();
      },
      () => undefined,
    );
    return this.loading;
  }

  /** Calls `listener` whenever the slots change; returns the unsubscribe. */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The four slots of `target` as far as they are loaded (all empty before {@link load} finishes). */
  public slots(target: ReplaySlotTarget | undefined): ReplaySlotList {
    return Array.from({ length: REPLAY_SLOT_COUNT }, (_, slot) =>
      target !== undefined ? this.records.get(replaySlotKey(target, slot)) : undefined,
    );
  }

  /** Whether each of `target`'s slots holds a replay. */
  public exists(target: ReplaySlotTarget | undefined): boolean[] {
    return this.slots(target).map((record) => record !== undefined);
  }

  /** The bytes every slot takes together. */
  public get totalBytes(): number {
    let total = 0;
    for (const record of this.records.values()) total += record.size;
    return total;
  }

  /**
   * Saves `payload` into `slot` of `target`, replacing what it held, and removes the worst-scoring replays the budget
   * needs room from. A replay that would itself be the worst over the budget is not saved (`reason: 'budget'`); a write
   * the browser refuses (its quota, blocked storage) leaves every slot as it was (`reason: 'storage'`).
   */
  public save(
    target: ReplaySlotTarget,
    slot: number,
    payload: ReplaySlotPayload,
    score: ReplaySlotScore,
    title: string,
  ): Promise<ReplaySlotSaveOutcome> {
    const run = async (): Promise<ReplaySlotSaveOutcome> => {
      if (!isReplaySlot(slot)) throw new RangeError(`no replay slot ${slot}`);
      await this.load();
      let data: Blob;
      try {
        const text = payload.kind === 'chart' ? serializeReplay(payload.replay) : serializeCourseReplay(payload.replay);
        data = await compressReplayText(text);
      } catch (error) {
        return { saved: false, reason: 'storage', error };
      }
      const maxExScore = score.noteCount * 2;
      const record: ReplaySlotRecord = {
        version: RECORD_VERSION,
        key: replaySlotKey(target, slot),
        target: { kind: target.kind, id: target.id },
        slot,
        savedAt: this.now().toISOString(),
        size: data.size,
        title,
        exScore: score.exScore,
        exRate: maxExScore > 0 ? Math.min(1, Math.max(0, score.exScore / maxExScore)) : 0,
        lamp: score.lamp,
      };
      const evicted = planReplaySlotEviction([...this.records.values()], record, this.budgetBytes);
      if (evicted === undefined) return { saved: false, reason: 'budget' };
      try {
        await this.backend.write(
          { record, data },
          evicted.map((entry) => entry.key),
        );
      } catch (error) {
        return { saved: false, reason: 'storage', error };
      }
      for (const entry of evicted) this.records.delete(entry.key);
      this.records.set(record.key, record);
      this.notify();
      return { saved: true, record, evicted };
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /**
   * The replay `slot` of `target` holds, as the `.bmplay.json` / `.bmcourse.json` text it was saved as, or `undefined`
   * when the slot is empty.
   */
  public async readText(target: ReplaySlotTarget, slot: number): Promise<string | undefined> {
    const key = replaySlotKey(target, slot);
    if (!this.records.has(key)) return undefined;
    const data = await this.backend.readData(key);
    return data !== undefined ? decompressReplayText(data) : undefined;
  }

  /** The replay `slot` of `target` holds, parsed, or `undefined` when it is empty. Throws on a replay it cannot read. */
  public async read(target: ReplaySlotTarget, slot: number): Promise<ReplaySlotPayload | undefined> {
    const text = await this.readText(target, slot);
    if (text === undefined) return undefined;
    return target.kind === 'chart'
      ? { kind: 'chart', replay: parseReplay(text) }
      : { kind: 'course', replay: parseCourseReplay(text) };
  }

  /** Empties `slot` of `target`. */
  public remove(target: ReplaySlotTarget, slot: number): Promise<void> {
    const key = replaySlotKey(target, slot);
    const run = async (): Promise<void> => {
      if (!this.records.has(key)) return;
      await this.backend.write(undefined, [key]);
      this.records.delete(key);
      this.notify();
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** A backend that keeps the slots in memory: where IndexedDB is unavailable, and in tests. */
export function createMemoryReplaySlotBackend(): ReplaySlotBackend & { readonly data: Map<string, Blob> } {
  const records = new Map<string, ReplaySlotRecord>();
  const data = new Map<string, Blob>();
  return {
    data,
    listRecords: () => Promise.resolve([...records.values()]),
    readData: (key) => Promise.resolve(data.get(key)),
    write: (entry, remove) => {
      for (const key of remove) {
        records.delete(key);
        data.delete(key);
      }
      if (entry !== undefined) {
        records.set(entry.record.key, entry.record);
        data.set(entry.record.key, entry.data);
      }
      return Promise.resolve();
    },
  };
}

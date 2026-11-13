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
import { clearLampOrder, type ClearLamp } from '@be-music/player-engine/ruleset';
import type { BestRecord, RecordPlay } from '@be-music/player-engine/records';
import { REPLAY_SLOT_COUNT, type LibraryChart, type LibraryCourse } from '@be-music/player-scene-model';

export { REPLAY_SLOT_COUNT };

/** The budget for compressed replay history. */
export const REPLAY_SLOT_BUDGET_BYTES = 500 * 1024 * 1024;

/** The record format marker. The database storage revision tracks migrations of these records. */
const RECORD_VERSION = 0;

/**
 * What a slot belongs to: a chart, by its chart fingerprint (`bmfp0:…`, or `sha256:<file hash>` for a chart that cannot
 * be fingerprinted), or a course, by its course fingerprint (`bmcourse0:…`).
 */
export interface ReplaySlotTarget {
  readonly kind: 'chart' | 'course';
  readonly id: string;
}

/** Metadata for listing history without opening the replay file. */
export interface ReplayHistoryRecord {
  readonly version: typeof RECORD_VERSION;
  readonly key: string;
  readonly target: ReplaySlotTarget;
  /** Slots that currently select this replay. */
  readonly slots: readonly number[];
  /** When it was saved (ISO 8601). */
  readonly savedAt: string;
  /** The compressed replay's size in bytes. */
  readonly size: number;
  /** The chart's or the course's title, for the slot lists. */
  readonly title: string;
  readonly exScore: number;
  /** EX score over its maximum (0 to 1). */
  readonly exRate: number;
  readonly lamp: ClearLamp;
}

/** A history entry as displayed in a numbered slot. */
export interface ReplaySlotRecord extends Omit<ReplayHistoryRecord, 'slots'> {
  readonly slot: number;
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
  | { readonly saved: true; readonly record: ReplayHistoryRecord; readonly evicted: readonly ReplayHistoryRecord[] }
  | { readonly saved: false; readonly reason: 'budget' | 'storage'; readonly error?: unknown };

/** Where the slots are kept: IndexedDB in the browser (`replay-slot-database.ts`), a map in tests. */
export interface ReplaySlotBackend {
  /** Runs a read-modify-write sequence exclusively across tabs when supported. */
  exclusive?<T>(action: () => Promise<T>): Promise<T>;
  /** Every history record kept. */
  listRecords(): Promise<unknown[]>;
  /** A slot's compressed replay. */
  readData(key: string): Promise<Blob | undefined>;
  /** Writes history data, updates slot selections and removes history entries in one transaction. */
  write(
    entry: { record: ReplayHistoryRecord; data: Blob } | undefined,
    remove: readonly string[],
    update?: readonly ReplayHistoryRecord[],
  ): Promise<void>;
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
 * as NOTHING; Be-Music saves by default, with beatoraja's own rules.
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
  const lamp = clearLampOrder(previous?.lamp ?? 'NO_PLAY');
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
      return clearLampOrder(play.lamp) > lamp;
    case 'clear-update-or-equal':
      return clearLampOrder(play.lamp) >= lamp;
    case 'any-update':
      return (
        clearLampOrder(play.lamp) > lamp ||
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

/** Evicts the oldest unselected history entries to make room for an incoming replay. */
export function planReplayHistoryEviction(
  records: readonly ReplayHistoryRecord[],
  incomingSize: number,
  budget: number,
): ReplayHistoryRecord[] | undefined {
  let remaining = records.reduce((sum, record) => sum + record.size, incomingSize);
  if (remaining <= budget) return [];
  const candidates = records.filter((record) => record.slots.length === 0).sort(compareReplayHistoryAge);
  const evicted: ReplayHistoryRecord[] = [];
  for (const candidate of candidates) {
    evicted.push(candidate);
    remaining -= candidate.size;
    if (remaining <= budget) return evicted;
  }
  return undefined;
}

function compareReplayHistoryAge(a: ReplayHistoryRecord, b: ReplayHistoryRecord): number {
  return a.savedAt.localeCompare(b.savedAt);
}

function isReplayRecordMetadata(value: unknown): value is Omit<ReplayHistoryRecord, 'slots'> {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<ReplayHistoryRecord>;
  const target = record.target;
  return (
    record.version === RECORD_VERSION &&
    typeof record.key === 'string' &&
    typeof target === 'object' &&
    target !== null &&
    (target.kind === 'chart' || target.kind === 'course') &&
    typeof target.id === 'string' &&
    typeof record.savedAt === 'string' &&
    typeof record.size === 'number' &&
    typeof record.exRate === 'number' &&
    typeof record.exScore === 'number' &&
    typeof record.title === 'string' &&
    typeof record.lamp === 'string'
  );
}

/** Reads a legacy slot record. Its key also identifies the compressed replay. */
export function parseReplaySlotRecord(value: unknown): ReplaySlotRecord | undefined {
  if (!isReplayRecordMetadata(value) || !('slot' in value)) return undefined;
  const { slot } = value;
  if (typeof slot !== 'number' || !isReplaySlot(slot) || value.key !== replaySlotKey(value.target, slot)) {
    return undefined;
  }
  return { ...value, slot };
}

/** Reads history metadata and adapts a legacy slot in place, keeping its replay data key. */
export function parseReplayHistoryRecord(value: unknown): ReplayHistoryRecord | undefined {
  if (!isReplayRecordMetadata(value)) return undefined;
  if ('slots' in value) {
    const { slots } = value;
    if (Array.isArray(slots) && slots.every(isReplaySlot) && new Set(slots).size === slots.length) {
      return value as ReplayHistoryRecord;
    }
    return undefined;
  }
  const legacy = parseReplaySlotRecord(value);
  if (legacy === undefined) return undefined;
  const { slot, ...record } = legacy;
  return { ...record, slots: [slot] };
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

/** Keeps replay metadata in memory and opens compressed replay data only when needed. */
export class ReplaySlotStore {
  private readonly backend: ReplaySlotBackend;
  private readonly budgetBytes: number;
  private readonly now: () => Date;
  private readonly records = new Map<string, ReplayHistoryRecord>();
  private readonly selected = new Map<string, ReplaySlotRecord>();
  private loading: Promise<void> | undefined;
  private settled = false;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  public constructor(options: ReplaySlotStoreOptions) {
    this.backend = options.backend;
    this.budgetBytes = options.budgetBytes ?? REPLAY_SLOT_BUDGET_BYTES;
    this.now = options.now ?? (() => new Date());
  }

  public load(): Promise<void> {
    this.loading ??= this.backend.listRecords().then(
      (values) => {
        this.replaceRecords(values);
        this.settled = true;
        this.notify();
      },
      () => {
        this.settled = true;
        this.notify();
      },
    );
    return this.loading;
  }

  public get loaded(): boolean {
    return this.settled;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public slots(target: ReplaySlotTarget | undefined): ReplaySlotList {
    return Array.from({ length: REPLAY_SLOT_COUNT }, (_, slot) =>
      target !== undefined ? this.selected.get(replaySlotKey(target, slot)) : undefined,
    );
  }

  public exists(target: ReplaySlotTarget | undefined): boolean[] {
    return this.slots(target).map((record) => record !== undefined);
  }

  /** Newest first. Without a target, includes every chart and course. */
  public history(target?: ReplaySlotTarget): ReplayHistoryRecord[] {
    return [...this.records.values()]
      .reverse()
      .filter(
        (record) => target === undefined || (record.target.kind === target.kind && record.target.id === target.id),
      )
      .sort((a, b) => compareReplayHistoryAge(b, a));
  }

  public get totalBytes(): number {
    let total = 0;
    for (const record of this.records.values()) total += record.size;
    return total;
  }

  /** Saves one payload and applies all slot rules that selected it. */
  public save(
    target: ReplaySlotTarget,
    slots: readonly number[],
    payload: ReplaySlotPayload,
    score: ReplaySlotScore,
    title: string,
  ): Promise<ReplaySlotSaveOutcome> {
    return this.enqueue<ReplaySlotSaveOutcome>(async () => {
      if (!slots.every(isReplaySlot)) throw new RangeError('Invalid replay slot');
      const text = payload.kind === 'chart' ? serializeReplay(payload.replay) : serializeCourseReplay(payload.replay);
      const data = await compressReplayText(text);
      const maxExScore = score.noteCount * 2;
      const record: ReplayHistoryRecord = {
        version: RECORD_VERSION,
        key: `history:${crypto.randomUUID()}`,
        target,
        slots: [...new Set(slots)],
        savedAt: this.now().toISOString(),
        size: data.size,
        title,
        exScore: score.exScore,
        exRate: maxExScore > 0 ? Math.min(1, Math.max(0, score.exScore / maxExScore)) : 0,
        lamp: score.lamp,
      };
      const update = this.clearSelections(target, record.slots);
      const updates = new Map(update.map((entry) => [entry.key, entry]));
      const evicted = planReplayHistoryEviction(
        [...this.records.values()].map((entry) => updates.get(entry.key) ?? entry),
        record.size,
        this.budgetBytes,
      );
      if (evicted === undefined) return { saved: false, reason: 'budget' };
      await this.write(
        { record, data },
        evicted.map((entry) => entry.key),
        update,
      );
      return { saved: true, record, evicted };
    }).catch((error: unknown): ReplaySlotSaveOutcome => ({ saved: false, reason: 'storage', error }));
  }

  /** Selects an already saved replay for a slot. */
  public assign(key: string, slot: number): Promise<ReplaySlotSaveOutcome> {
    return this.enqueue<ReplaySlotSaveOutcome>(async () => {
      if (!isReplaySlot(slot)) throw new RangeError('Invalid replay slot');
      const entry = this.records.get(key);
      if (entry === undefined) return { saved: false, reason: 'storage' };
      const record = { ...entry, slots: [...new Set([...entry.slots, slot])] };
      await this.write(undefined, [], [...this.clearSelections(entry.target, [slot], key), record]);
      return { saved: true, record, evicted: [] };
    }).catch((error: unknown): ReplaySlotSaveOutcome => ({ saved: false, reason: 'storage', error }));
  }

  public readText(target: ReplaySlotTarget, slot: number): Promise<string | undefined> {
    const key = this.selected.get(replaySlotKey(target, slot))?.key;
    return key === undefined ? Promise.resolve(undefined) : this.readHistoryText(key);
  }

  public async read(target: ReplaySlotTarget, slot: number): Promise<ReplaySlotPayload | undefined> {
    const text = await this.readText(target, slot);
    if (text === undefined) return undefined;
    return target.kind === 'chart'
      ? { kind: 'chart', replay: parseReplay(text) }
      : { kind: 'course', replay: parseCourseReplay(text) };
  }

  public async readHistoryText(key: string): Promise<string | undefined> {
    if (!this.records.has(key)) return undefined;
    const data = await this.backend.readData(key);
    return data !== undefined ? decompressReplayText(data) : undefined;
  }

  /** Clears a slot's selection and keeps its replay in history. */
  public remove(target: ReplaySlotTarget, slot: number): Promise<void> {
    return this.enqueue(async () => {
      const update = this.clearSelections(target, [slot]);
      if (update.length > 0) await this.write(undefined, [], update);
    });
  }

  /** Deletes the replay and clears any slots selecting it. */
  public removeHistory(key: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.records.has(key)) await this.write(undefined, [key], []);
    });
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      await this.load();
      if (this.backend.exclusive === undefined) return action();
      return this.backend.exclusive(async () => {
        this.replaceRecords(await this.backend.listRecords());
        return action();
      });
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private clearSelections(target: ReplaySlotTarget, slots: readonly number[], except?: string): ReplayHistoryRecord[] {
    const keys = new Set(slots.map((slot) => this.selected.get(replaySlotKey(target, slot))?.key));
    keys.delete(except);
    return [...keys].flatMap((key) => {
      const entry = key === undefined ? undefined : this.records.get(key);
      return entry === undefined ? [] : [{ ...entry, slots: entry.slots.filter((slot) => !slots.includes(slot)) }];
    });
  }

  private async write(
    entry: { record: ReplayHistoryRecord; data: Blob } | undefined,
    remove: readonly string[],
    update: readonly ReplayHistoryRecord[],
  ): Promise<void> {
    await this.backend.write(entry, remove, update);
    for (const record of update) this.records.set(record.key, record);
    for (const key of remove) this.records.delete(key);
    if (entry !== undefined) this.records.set(entry.record.key, entry.record);
    this.rebuildSelections();
    this.notify();
  }

  private replaceRecords(values: readonly unknown[]): void {
    this.records.clear();
    for (const value of values) {
      const record = parseReplayHistoryRecord(value);
      if (record !== undefined) this.records.set(record.key, record);
    }
    this.rebuildSelections();
  }

  private rebuildSelections(): void {
    this.selected.clear();
    for (const record of this.records.values()) {
      const { slots, ...replay } = record;
      for (const slot of slots) this.selected.set(replaySlotKey(record.target, slot), { ...replay, slot });
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** A backend that keeps the slots in memory: where IndexedDB is unavailable, and in tests. */
export function createMemoryReplaySlotBackend(): ReplaySlotBackend & { readonly data: Map<string, Blob> } {
  const records = new Map<string, ReplayHistoryRecord>();
  const data = new Map<string, Blob>();
  return {
    data,
    listRecords: () => Promise.resolve([...records.values()]),
    readData: (key) => Promise.resolve(data.get(key)),
    write: (entry, remove, update = []) => {
      for (const record of update) records.set(record.key, record);
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

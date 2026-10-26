// The replay slots as the screens use them (`replay-slots.ts` keeps them): which slots a select bar has, and a result
// screen's slots, saved into by hand or by each slot's auto-save rule, as beatoraja's `MusicResult` / `CourseResult` do.

import type { BestRecord } from '@be-music/player-engine/records';
import { REPLAY_SLOT_COUNT, type LibraryEntry, type ReplaySlotState } from '@be-music/player-scene-model';
import {
  libraryChartReplaySlotTarget,
  libraryCourseReplaySlotTarget,
  resolveReplayAutoSaveSlots,
  type ReplayAutoSaveRule,
  type ReplaySlotList,
  type ReplaySlotPayload,
  type ReplaySlotSaveOutcome,
  type ReplaySlotScore,
  type ReplaySlotStore,
  type ReplaySlotTarget,
} from './replay-slots.ts';

/** What a result can save: its replay, its score, its title, and the best record as it was before the play. */
export interface ResultReplaySave {
  readonly payload: ReplaySlotPayload;
  readonly score: ReplaySlotScore;
  readonly title: string;
  readonly previous: BestRecord | undefined;
}

/** How a save into a slot is described on the status line. */
export function describeReplaySlotSave(slot: number, outcome: ReplaySlotSaveOutcome, auto: boolean): string {
  const name = `replay slot ${slot + 1}`;
  if (outcome.saved) {
    const evicted = outcome.evicted.length;
    const room =
      evicted === 0 ? '' : ` (removed ${evicted} lower-scoring replay${evicted === 1 ? '' : 's'} to make room)`;
    return `${auto ? 'Auto-saved' : 'Saved'} the replay to ${name}${room}`;
  }
  return outcome.reason === 'budget'
    ? `Not saved to ${name}: it would score lowest of the replays kept, and they are at the size limit`
    : `Not saved to ${name}: the browser's storage is full or unavailable`;
}

/**
 * A result screen's replay slots: the slots of its chart or course, and the slots this result saved into (beatoraja's
 * `ReplayStatus.SAVED`). Each slot takes one save per result. A result that cannot be saved (a replay, AUTO, a practice
 * play, a play whose record does not count) still shows which slots hold a replay.
 */
export class ResultReplaySlots {
  public readonly target: ReplaySlotTarget | undefined;
  private readonly store: ReplaySlotStore;
  private readonly source: ResultReplaySave | undefined;
  private readonly report: (text: string) => void;
  private readonly saved = new Set<number>();
  private readonly saving = new Set<number>();
  private readonly listeners = new Set<() => void>();

  public constructor(options: {
    store: ReplaySlotStore;
    target: ReplaySlotTarget | undefined;
    save: ResultReplaySave | undefined;
    report: (text: string) => void;
  }) {
    this.store = options.store;
    this.target = options.target;
    this.source = options.target !== undefined ? options.save : undefined;
    this.report = options.report;
  }

  /** Calls `listener` whenever a slot of this result is saved; returns the unsubscribe. */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Whether the result can be saved into a slot. */
  public get saveable(): boolean {
    return this.source !== undefined;
  }

  /** Each slot's state: saved by this result, holding a replay, or empty. */
  public states(): ReplaySlotState[] {
    const exists = this.store.exists(this.target);
    return Array.from({ length: REPLAY_SLOT_COUNT }, (_, slot) =>
      this.saved.has(slot) ? 'saved' : exists[slot] === true ? 'exists' : 'none',
    );
  }

  /** The slots' records, for a card that names what each one holds. */
  public slots(): ReplaySlotList {
    return this.store.slots(this.target);
  }

  /** Saves into each slot whose auto-save rule the play meets (beatoraja applies them as its result opens). */
  public async autoSave(rules: readonly ReplayAutoSaveRule[]): Promise<void> {
    const source = this.source;
    if (source === undefined) return;
    for (const slot of resolveReplayAutoSaveSlots(rules, source.previous, source.score)) await this.save(slot, true);
  }

  /** Saves the result into `slot`, once per result; resolves `undefined` when nothing was saved. */
  public async save(slot: number, auto = false): Promise<ReplaySlotSaveOutcome | undefined> {
    const source = this.source;
    const target = this.target;
    if (source === undefined || target === undefined) {
      if (!auto) this.report('This play cannot be saved to a replay slot');
      return undefined;
    }
    if (this.saved.has(slot) || this.saving.has(slot)) return undefined;
    this.saving.add(slot);
    try {
      const outcome = await this.store.save(target, slot, source.payload, source.score, source.title);
      if (outcome.saved) {
        this.saved.add(slot);
        for (const listener of this.listeners) listener();
      }
      this.report(describeReplaySlotSave(slot, outcome, auto));
      return outcome;
    } finally {
      this.saving.delete(slot);
    }
  }
}

/** The replay slots of the library's bars, by the slot targets worked out once per bar. */
export class ReplaySlotService {
  public readonly store: ReplaySlotStore;
  private readonly placement: () => 'intended' | 'lr2';

  public constructor(options: { store: ReplaySlotStore; nonstopPlacement: () => 'intended' | 'lr2' }) {
    this.store = options.store;
    this.placement = options.nonstopPlacement;
  }

  /** The slot target of a chart or course bar (a NONSTOP course's by the placement it would be played with). */
  public targetOf(entry: Exclude<LibraryEntry, { kind: 'folder' }>): ReplaySlotTarget | undefined {
    return entry.kind === 'chart'
      ? libraryChartReplaySlotTarget(entry.chart)
      : libraryCourseReplaySlotTarget(entry.course, this.placement());
  }

  /** Which of a bar's slots hold a replay. */
  public exists(entry: Exclude<LibraryEntry, { kind: 'folder' }>): boolean[] {
    return this.store.exists(this.targetOf(entry));
  }
}

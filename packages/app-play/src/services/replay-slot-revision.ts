// The replay slots' storage revision: the shape of everything `be-music-replays` holds, kept apart from the IndexedDB
// version (which only tracks its stores).
//
// Revision 0 is unstable: its shape may change without a migration, and whatever no longer reads as a slot record is
// cleared when the database opens. From revision 1 on, a bump comes with a migration step from the revision before it,
// and the stored records are migrated step by step.

import { parseReplaySlotRecord, type ReplaySlotRecord } from './replay-slots.ts';

/** The revision this build writes. */
export const REPLAY_SLOT_STORAGE_REVISION = 0;

/**
 * Migrates one stored record from revision `n - 1` to `n`, keyed by `n`; `undefined` drops the record and its replay.
 * Every revision from 1 to {@link REPLAY_SLOT_STORAGE_REVISION} needs its step.
 */
export type ReplaySlotMigration = (record: unknown) => unknown;
export const REPLAY_SLOT_MIGRATIONS: Readonly<Record<number, ReplaySlotMigration>> = {};

/** What the stored slots need before this build reads them. */
export interface ReplaySlotRevisionPlan {
  /** Slot keys whose record and replay are removed. */
  readonly remove: readonly string[];
  /** Records rewritten in their migrated shape. */
  readonly put: readonly ReplaySlotRecord[];
  /** The revision to store, when it changes. */
  readonly revision?: number;
}

/**
 * Plans bringing the stored slots to `currentRevision`:
 *
 * - Revision 0 (and a revision newer than this build, or one with a missing step): remove every record that does not
 *   read as a slot record, with its replay.
 * - A lower revision from 1 on: run each step's migration in turn, then remove what still does not read.
 *
 * A replay without a record is removed either way.
 */
export function planReplaySlotRevision(input: {
  storedRevision: number | undefined;
  currentRevision?: number;
  records: readonly { key: string; value: unknown }[];
  dataKeys: readonly string[];
  migrations?: Readonly<Record<number, ReplaySlotMigration>>;
}): ReplaySlotRevisionPlan {
  const current = input.currentRevision ?? REPLAY_SLOT_STORAGE_REVISION;
  const migrations = input.migrations ?? REPLAY_SLOT_MIGRATIONS;
  const stored = input.storedRevision ?? 0;
  const steps: ReplaySlotMigration[] = [];
  if (current >= 1 && stored < current) {
    for (let revision = stored + 1; revision <= current; revision++) {
      const step = migrations[revision];
      if (step === undefined) {
        steps.length = 0;
        break;
      }
      steps.push(step);
    }
  }
  const remove: string[] = [];
  const put: ReplaySlotRecord[] = [];
  const kept = new Set<string>();
  for (const { key, value } of input.records) {
    let migrated: unknown = value;
    for (const step of steps) {
      if (migrated === undefined) break;
      migrated = step(migrated);
    }
    const record = migrated === undefined ? undefined : parseReplaySlotRecord(migrated);
    if (record === undefined || record.key !== key) {
      remove.push(key);
      continue;
    }
    kept.add(key);
    if (migrated !== value) put.push(record);
  }
  for (const key of input.dataKeys) if (!kept.has(key) && !remove.includes(key)) remove.push(key);
  return { remove, put, ...(input.storedRevision !== current ? { revision: current } : {}) };
}

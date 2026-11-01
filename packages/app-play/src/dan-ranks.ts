// The player's dan ranks: the highest dan cleared on a GRADE course, kept per judge ruleset and key mode (as LR2 keeps
// one per key mode, `grade_7` … `grade_9`) and persisted across reloads, beside the best records of
// `chart-best-records.ts`. How a course run certifies a rank is `@be-music/player-engine/records`.

import {
  formatDanRank,
  higherDanRank,
  isDanRank,
  resolveCourseRunDanRank,
  resolveDanCourseKeyMode,
  type DanRank,
} from '@be-music/player-engine/records';
import type { CourseKind } from '@be-music/player-engine/course';
import type { ClearLamp, RulesetId } from '@be-music/player-engine/ruleset';
import type { BeMusicDanRank } from '@be-music/player-skin-sdk';

const STORAGE_KEY = 'be-music.dan-ranks';
/**
 * The stored map's revision. `0` while the shape is still being defined: it may change incompatibly without the number
 * moving. Any other stamp is unreadable, and so is an absent store: both read as no rank yet.
 */
const STORAGE_VERSION = 0;

const JUDGE_RULESETS: readonly RulesetId[] = ['lr2', 'beatoraja', '____'];

/** The key a dan rank is stored under: the judge ruleset the course was cleared on, then its key mode (`lr2:7`). */
export function danRankKey(ruleset: RulesetId, keyMode: number): string {
  return `${ruleset}:${keyMode}`;
}

/** What a finished course run leaves for the dan ranks. */
export interface DanRankCourseRun {
  definition: { kind: CourseKind; name: string; keyMode?: number };
  /** The key mode of each stage's chart, `undefined` for a stage whose chart is not known. */
  stageKeyModes: readonly (number | undefined)[];
  /** The run's clear lamp. */
  lamp: ClearLamp;
}

/**
 * The dan rank a course run certifies and the key it is kept under, or `undefined` when it certifies none: a run that
 * keeps no best record (`ruleset` is `undefined` then: an auto-played run, one at another tempo, one judged under
 * different rulesets), one that is not a cleared GRADE course named after a dan (`resolveCourseRunDanRank`), or one
 * whose key mode is unknown (`resolveDanCourseKeyMode`).
 */
export function resolveDanRankUpdate(
  run: DanRankCourseRun,
  ruleset: RulesetId | undefined,
): { key: string; rank: DanRank } | undefined {
  if (ruleset === undefined) return undefined;
  const rank = resolveCourseRunDanRank({ kind: run.definition.kind, name: run.definition.name, lamp: run.lamp });
  if (rank === undefined) return undefined;
  const keyMode = resolveDanCourseKeyMode(run.definition.keyMode, run.stageKeyModes);
  return keyMode === undefined ? undefined : { key: danRankKey(ruleset, keyMode), rank };
}

/** Keeps the higher of the stored rank and `update`'s. Returns the rank as it was before. */
export function mergeDanRank(
  ranks: Map<string, DanRank>,
  update: { key: string; rank: DanRank },
): { previous: DanRank | undefined } {
  const previous = ranks.get(update.key);
  ranks.set(update.key, higherDanRank(previous, update.rank));
  return { previous };
}

/** The dan ranks of one judge ruleset as a skin gets them, by key mode (fewest keys first). */
export function listDanRanks(ranks: ReadonlyMap<string, DanRank>, ruleset: RulesetId): BeMusicDanRank[] {
  const list: BeMusicDanRank[] = [];
  const prefix = `${ruleset}:`;
  for (const [key, rank] of ranks) {
    if (!key.startsWith(prefix)) continue;
    const keyMode = Number(key.slice(prefix.length));
    list.push({ keyMode, rank, label: formatDanRank(rank) });
  }
  return list.sort((a, b) => a.keyMode - b.keyMode);
}

/**
 * Parses stored dan ranks, keyed by {@link danRankKey}. Entries with an unknown rank, judge ruleset or key mode are
 * dropped, so a hand-edited or stale store can't hand a skin junk; anything unreadable (or no store at all) yields no
 * ranks.
 */
export function parseDanRanks(raw: string | null | undefined): Map<string, DanRank> {
  const ranks = new Map<string, DanRank>();
  if (!raw) return ranks;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ranks;
  }
  if (typeof parsed !== 'object' || parsed === null) return ranks;
  const { version, ranks: stored } = parsed as { version?: unknown; ranks?: unknown };
  if (version !== STORAGE_VERSION || typeof stored !== 'object' || stored === null) return ranks;
  for (const [key, rank] of Object.entries(stored)) {
    const ruleset = JUDGE_RULESETS.find((id) => key.startsWith(`${id}:`));
    if (ruleset === undefined || !isDanRank(rank)) continue;
    const keyMode = Number(key.slice(ruleset.length + 1));
    if (!Number.isInteger(keyMode) || keyMode <= 0) continue;
    ranks.set(danRankKey(ruleset, keyMode), rank);
  }
  return ranks;
}

/** Serializes dan ranks as `{ version: 0, ranks: { [danRankKey]: DanRank } }`. */
export function serializeDanRanks(ranks: ReadonlyMap<string, DanRank>): string {
  return JSON.stringify({ version: STORAGE_VERSION, ranks: Object.fromEntries(ranks) });
}

export function readStoredDanRanks(): Map<string, DanRank> {
  try {
    return parseDanRanks(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return new Map();
  }
}

export function storeDanRanks(ranks: ReadonlyMap<string, DanRank>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeDanRanks(ranks));
  } catch {
    // Private windows / blocked or full storage: the ranks still hold for this session.
  }
}

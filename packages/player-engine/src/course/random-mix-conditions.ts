import type { CourseDefinition, NonstopConnection } from './definition.ts';
import { finishCourseDraft, LR2_COURSE_MAKER_MAX_STAGES } from './maker.ts';
import { LR2_RANDOM_MIX_NAME, resolveLR2RandomMixSettings, type LR2RandomMixSettings } from './random-mix.ts';

/*
 * The conditions the RANDOM MIX dialog sets before a draw, and the draw itself one stage at a time. LR2 draws a RANDOM
 * MIX by its `config.course` values alone (`random-mix.ts`); Be-Music asks first which key modes, which levels or
 * difficulties and how many stages, endless included, and keeps LR2's BPM limits, BPM range and favorite level.
 *
 * A stage is drawn by walking the pool in a random order and taking the first chart that fits, so a draw reads only as
 * many charts as it walks: a host can leave the costly facts (a chart's BPMs, its file hash) until a chart is walked.
 */

/** The `#DIFFICULTY` values the dialog offers: BEGINNER, NORMAL, HYPER, ANOTHER, INSANE. */
export const RANDOM_MIX_DIFFICULTIES: readonly number[] = [1, 2, 3, 4, 5];

/** The most stages a counted EXPERT RANDOM MIX has. */
export const RANDOM_MIX_MAX_COUNT = 99;

/**
 * The most stages a NONSTOP RANDOM MIX has: the five a course LR2 plays holds, so a NONSTOP draw, played as one stitched
 * chart, is always kept as its folder's newest course.
 */
export const RANDOM_MIX_NONSTOP_MAX_COUNT: number = LR2_COURSE_MAKER_MAX_STAGES;

/** The stage count of a RANDOM MIX: a number of stages, or `infinity` for one that goes on until the gauge empties. */
export type RandomMixCount = number | 'infinity';

/** What a RANDOM MIX draws from (the RANDOM MIX dialog). */
export interface RandomMixConditions {
  /** The key modes (`5`, `7`, `9`, `10`, `14`, ...) a draw may be in; each draw keeps stage 1's. */
  keyModes: number[];
  /** Whether the charts are narrowed by play level (`minLevel` / `maxLevel`) or by `#DIFFICULTY` (`difficulties`). */
  by: 'level' | 'difficulty';
  /** The lowest play level; 0 is no limit. */
  minLevel: number;
  /** The highest play level; 0 is no limit. */
  maxLevel: number;
  /** The `#DIFFICULTY` values allowed ({@link RANDOM_MIX_DIFFICULTIES}). */
  difficulties: number[];
  /**
   * Whether a chart that names no `#DIFFICULTY` is narrowed by the one estimated for it
   * ({@link RandomMixCandidate.estimatedDifficulty}); off, such a chart never fits a difficulty.
   */
  estimateDifficulty: boolean;
  /**
   * Whether a chart whose BPM changes can be drawn: stage 1 then need not keep one BPM, and the BPM limits and the BPM
   * range read a chart's max BPM only. Off, LR2's rules apply ({@link drawRandomMixStage}).
   */
  allowBPMChanges: boolean;
  count: RandomMixCount;
}

/** The conditions before the dialog was ever confirmed: 7 keys, any level, five stages (LR2's defaults). */
export const DEFAULT_RANDOM_MIX_CONDITIONS: Readonly<RandomMixConditions> = {
  keyModes: [7],
  by: 'level',
  minLevel: 0,
  maxLevel: 0,
  difficulties: [...RANDOM_MIX_DIFFICULTIES],
  estimateDifficulty: true,
  allowBPMChanges: true,
  count: LR2_COURSE_MAKER_MAX_STAGES,
};

/** An integer in `[min, max]`, or `fallback` for a value that is not a finite number. */
function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** The distinct positive integers of `value`, ascending; `undefined` when it is not an array. */
function integerSet(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const set = new Set<number>();
  for (const item of value) if (typeof item === 'number' && Number.isInteger(item) && item > 0) set.add(item);
  return [...set].sort((a, b) => a - b);
}

/**
 * Conditions read back from storage (or `fallback` for each value that is missing or malformed): levels clamped to
 * 0-99, difficulties kept to {@link RANDOM_MIX_DIFFICULTIES} and a count clamped to 1-{@link RANDOM_MIX_MAX_COUNT}. The
 * `loops` an earlier version kept is dropped: each RANDOM MIX is one draw.
 */
export function normalizeRandomMixConditions(
  value: unknown,
  fallback: Readonly<RandomMixConditions> = DEFAULT_RANDOM_MIX_CONDITIONS,
): RandomMixConditions {
  const stored = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const difficulties = integerSet(stored.difficulties)?.filter((difficulty) =>
    RANDOM_MIX_DIFFICULTIES.includes(difficulty),
  );
  return {
    keyModes: integerSet(stored.keyModes) ?? [...fallback.keyModes],
    by: stored.by === 'difficulty' || stored.by === 'level' ? stored.by : fallback.by,
    minLevel: clampInteger(stored.minLevel, 0, 99, fallback.minLevel),
    maxLevel: clampInteger(stored.maxLevel, 0, 99, fallback.maxLevel),
    difficulties: difficulties ?? [...fallback.difficulties],
    estimateDifficulty:
      typeof stored.estimateDifficulty === 'boolean' ? stored.estimateDifficulty : fallback.estimateDifficulty,
    allowBPMChanges: typeof stored.allowBPMChanges === 'boolean' ? stored.allowBPMChanges : fallback.allowBPMChanges,
    count:
      stored.count === 'infinity'
        ? 'infinity'
        : clampInteger(stored.count, 1, RANDOM_MIX_MAX_COUNT, fallback.count === 'infinity' ? 1 : fallback.count),
  };
}

/**
 * The stage count a draw of `kind` takes: a NONSTOP RANDOM MIX, one stitched chart, has at most
 * {@link RANDOM_MIX_NONSTOP_MAX_COUNT} stages and no endless count.
 */
export function resolveRandomMixCount(kind: 'expert' | 'nonstop', count: RandomMixCount): RandomMixCount {
  if (kind === 'nonstop')
    return count === 'infinity' ? RANDOM_MIX_NONSTOP_MAX_COUNT : Math.min(count, RANDOM_MIX_NONSTOP_MAX_COUNT);
  return count;
}

/**
 * Whether a drawn course of `count` stages is kept as its folder's newest course: the player's courses are kept as LR2
 * course files, which hold the five stages LR2 plays, so a longer or endless draw is played and not kept.
 */
export function isRandomMixKept(count: RandomMixCount): boolean {
  return count !== 'infinity' && count <= LR2_COURSE_MAKER_MAX_STAGES;
}

/** One chart a RANDOM MIX can draw, by what the conditions read: its folder, key mode, play level and difficulty. */
export interface RandomMixCandidate {
  /** The chart's folder (LR2's `folder` column): no two stages of a draw come from the same one. */
  folder: string;
  keyMode: number;
  /** The play level, truncated to an integer (0 when the chart has none). */
  level: number;
  /** `#DIFFICULTY` (1-5), when the chart has one. */
  difficulty?: number;
  /**
   * The difficulty estimated for a chart that names none, from its names or note count (the library's
   * `resolveLibraryChartDifficulty`).
   */
  estimatedDifficulty?: number;
}

/**
 * Whether a chart fits the conditions (its key mode, then its level range or difficulty, a chart naming none read by its
 * estimated difficulty when `estimateDifficulty` is on).
 */
export function matchesRandomMixConditions(chart: RandomMixCandidate, conditions: RandomMixConditions): boolean {
  if (!conditions.keyModes.includes(chart.keyMode)) return false;
  if (conditions.by === 'difficulty') {
    const difficulty = chart.difficulty ?? (conditions.estimateDifficulty ? chart.estimatedDifficulty : undefined);
    return difficulty !== undefined && conditions.difficulties.includes(difficulty);
  }
  const [low, high] = resolveLevelRange(conditions);
  return low <= chart.level && chart.level <= high;
}

/** The level range of the conditions, swapped when the min is above the max, each 0 an open end. */
function resolveLevelRange(conditions: RandomMixConditions): [number, number] {
  let { minLevel, maxLevel } = conditions;
  if (minLevel > 0 && maxLevel > 0 && minLevel > maxLevel) [minLevel, maxLevel] = [maxLevel, minLevel];
  return [minLevel > 0 ? minLevel : -Infinity, maxLevel > 0 ? maxLevel : Infinity];
}

/** The charts that fit the conditions, in library order: the pool a draw walks. */
export function filterRandomMixCandidates<T extends RandomMixCandidate>(
  charts: readonly T[],
  conditions: RandomMixConditions,
): T[] {
  return charts.filter((chart) => matchesRandomMixConditions(chart, conditions));
}

/** The key modes of the charts, ascending: the ones the dialog offers. */
export function listRandomMixKeyModes(charts: readonly RandomMixCandidate[]): number[] {
  return [...new Set(charts.map((chart) => chart.keyMode))].sort((a, b) => a - b);
}

/** A chart's lowest and highest BPM, as LR2's song database keeps them (integers). */
export interface RandomMixBPMRange {
  min: number;
  max: number;
}

/** What one stage of a draw is drawn against. */
export interface RandomMixStageOptions<T extends RandomMixCandidate> {
  /**
   * Draw a chart whose BPM changes too ({@link RandomMixConditions.allowBPMChanges}): stage 1 need not keep one BPM, and
   * the BPM limits and range read the chart's max BPM. Default `false`, LR2's rules.
   */
  allowBPMChanges?: boolean;
  /** LR2's RANDOM MIX settings: the BPM limits, the BPM range and the favorite level apply (the levels do not). */
  settings: LR2RandomMixSettings;
  /** A chart's BPMs, asked only of the charts the draw walks (and only when a BPM setting needs them). */
  bpmOf: (chart: T) => RandomMixBPMRange;
  /** Stage 1 of the draw, for a later stage: the draw keeps its key mode and the BPM range around its max BPM. */
  first?: T;
  /** The folders earlier stages came from, which this stage skips. */
  usedFolders?: ReadonlySet<string>;
  /** Charts the host found it cannot play (a chart whose file cannot be hashed), which this stage skips. */
  excluded?: ReadonlySet<T>;
}

/**
 * The indices `[0, length)` in a random order, one at a time: a Fisher-Yates shuffle that swaps lazily, so walking the
 * first few costs as few `random` calls and no array of `length`.
 */
function* randomOrder(length: number, random: () => number): Generator<number> {
  const swapped = new Map<number, number>();
  for (let index = 0; index < length; index += 1) {
    const value = Math.floor(random() * (length - index));
    const other = index + (Number.isFinite(value) ? Math.min(length - index - 1, Math.max(0, value)) : 0);
    const picked = swapped.get(other) ?? other;
    swapped.set(other, swapped.get(index) ?? index);
    swapped.delete(index);
    yield picked;
  }
}

/**
 * Draws one stage of a RANDOM MIX from `pool` (the charts that fit the conditions), as LR2's `WriteRandomCourse` draws
 * one row: the first chart, in a random order, that
 *
 * - for stage 1 lies within the BPM limits and, with a BPM range set, keeps one BPM;
 * - for a later stage is in stage 1's key mode and lies within the BPM range around stage 1's max BPM (intersected with
 *   the BPM limits; the limits alone without a range);
 * - comes from none of `usedFolders` and is not `excluded`.
 *
 * With a favorite level the drawn chart is replaced by the chart of its folder and key mode in `pool` nearest that
 * level (the first in `pool` order on a tie), its BPMs not checked again, as LR2's `GetRandomSongHash` does. Each draw
 * picks uniformly among the charts that fit, as LR2's one random order does; `random` (values in `[0, 1)`) is the only
 * source of chance, so a draw is reproducible. `undefined` when no chart fits.
 */
export function drawRandomMixStage<T extends RandomMixCandidate>(
  pool: readonly T[],
  options: RandomMixStageOptions<T>,
  random: () => number,
): T | undefined {
  const settings = resolveLR2RandomMixSettings(options.settings);
  const fits = createStageFilter(settings, options);
  for (const index of randomOrder(pool.length, random)) {
    const chart = pool[index]!;
    if (fits(chart)) return preferLevel(pool, chart, settings.preferredLevel, options.excluded);
  }
  return undefined;
}

/**
 * Whether any chart of `pool` can be stage 1 of a draw ({@link drawRandomMixStage} without `first`): with a BPM range
 * set, stage 1 must keep one BPM, and the BPM limits apply, so charts that fit the conditions may still give no draw.
 * It walks `pool` in order and stops at the first chart that can, reading BPMs only as far as it walks.
 */
export function hasRandomMixFirstStage<T extends RandomMixCandidate>(
  pool: readonly T[],
  options: Pick<RandomMixStageOptions<T>, 'settings' | 'bpmOf' | 'allowBPMChanges'>,
): boolean {
  const fits = createStageFilter(resolveLR2RandomMixSettings(options.settings), options);
  return pool.some(fits);
}

/** Whether a chart can be the next stage of a draw: the rules {@link drawRandomMixStage} lists, before `preferLevel`. */
function createStageFilter<T extends RandomMixCandidate>(
  settings: LR2RandomMixSettings,
  options: Omit<RandomMixStageOptions<T>, 'settings'>,
): (chart: T) => boolean {
  const { first, usedFolders, excluded } = options;
  const minBPM = settings.minBPM > 0 ? settings.minBPM : -Infinity;
  const maxBPM = settings.maxBPM > 0 ? settings.maxBPM : Infinity;
  let low = minBPM;
  let high = maxBPM;
  if (first !== undefined && settings.bpmRange > 0) {
    const firstMax = Math.trunc(options.bpmOf(first).max);
    low = Math.max(minBPM, firstMax - settings.bpmRange);
    high = Math.min(maxBPM, firstMax + settings.bpmRange);
  }
  const checksBPM =
    low > -Infinity ||
    high < Infinity ||
    (first === undefined && settings.bpmRange > 0 && options.allowBPMChanges !== true);
  return (chart) => {
    if (first !== undefined && chart.keyMode !== first.keyMode) return false;
    if (usedFolders?.has(chart.folder) === true || excluded?.has(chart) === true) return false;
    if (!checksBPM) return true;
    const bpm = options.bpmOf(chart);
    const max = Math.trunc(bpm.max);
    // A chart whose BPM changes is placed by its max BPM, as LR2 centres the BPM range on stage 1's max BPM.
    const min = options.allowBPMChanges === true ? max : Math.trunc(bpm.min);
    if (min < low || max > high) return false;
    return first !== undefined || settings.bpmRange <= 0 || min === max;
  };
}

/** `GetRandomSongHash`: the chart of `chart`'s folder and key mode in `pool` nearest `level` (0 keeps `chart`). */
function preferLevel<T extends RandomMixCandidate>(
  pool: readonly T[],
  chart: T,
  level: number,
  excluded: ReadonlySet<T> | undefined,
): T {
  if (level < 1) return chart;
  let best: T | undefined;
  for (const other of pool) {
    if (other.folder !== chart.folder || other.keyMode !== chart.keyMode || excluded?.has(other) === true) continue;
    if (best === undefined || Math.abs(other.level - level) < Math.abs(best.level - level)) best = other;
  }
  return best ?? chart;
}

/** A drawn stage as its course keys it: the chart MD5 (hex) and what the course file names it by. */
export interface RandomMixStage {
  md5: string;
  keyMode: number;
  title?: string;
  subtitle?: string;
  artist?: string;
}

/**
 * A RANDOM MIX course of the drawn stages: a course the player made, named {@link LR2_RANDOM_MIX_NAME}, in stage 1's key
 * mode, unranked (`release: false`); a NONSTOP one gets `defaultConnection` after every stage. `undefined` without a
 * stage.
 */
export function createRandomMixCourse(
  kind: 'expert' | 'nonstop',
  stages: readonly RandomMixStage[],
  options: { defaultConnection?: NonstopConnection } = {},
): CourseDefinition | undefined {
  if (stages.length === 0) return undefined;
  return finishCourseDraft(
    {
      kind,
      name: LR2_RANDOM_MIX_NAME,
      stages: stages.map((stage) => ({
        md5: stage.md5.toLowerCase(),
        keyMode: stage.keyMode,
        ...(stage.title !== undefined ? { title: stage.title } : {}),
        ...(stage.subtitle !== undefined ? { subtitle: stage.subtitle } : {}),
        ...(stage.artist !== undefined ? { artist: stage.artist } : {}),
      })),
    },
    options.defaultConnection !== undefined ? { defaultConnection: options.defaultConnection } : {},
  );
}

import type { CourseDefinition, NonstopConnection } from './definition.ts';
import { finishCourseDraft } from './maker.ts';

/*
 * LR2's RANDOM MIX bar: a course drawn from the song database by level, BPM and stage count (OpenLR2 `LR2f.cpp`
 * `CreateRandomCourse` L8709-L8775, `WriteRandomCourse` L18387-L18474, `GetRandomSongHash` L17666-L17681 @ 583a385;
 * LR2 beta3 `history.txt`, "ランダムコースオプションについて").
 */

/** The title LR2 gives a drawn RANDOM MIX course, and its bar's. */
export const LR2_RANDOM_MIX_NAME = 'RANDOM MIX';

/**
 * The RANDOM MIX settings (LR2's `config.course`, edited by select buttons 260-266). A level or BPM limit of 0 is no
 * limit.
 */
export interface LR2RandomMixSettings {
  /** `optimumlevel_7` (button 260): each drawn song is played on its chart nearest this level; 0 is off. */
  preferredLevel: number;
  /** `maxlevel` (button 261). */
  maxLevel: number;
  /** `minlevel` (button 262). */
  minLevel: number;
  /** `bpmrange` (button 263): stages 2+ stay within this many BPM of stage 1's max BPM; 0 is no limit. */
  bpmRange: number;
  /** `maxbpm` (button 264). */
  maxBPM: number;
  /** `minbpm` (button 265). */
  minBPM: number;
  /** `stage` (button 266): the number of stages, 1-5; 0 draws 2-5. */
  stageCount: number;
}

export type LR2RandomMixSetting = keyof LR2RandomMixSettings;

/** LR2's defaults when `config.xml` has no `<course>` values (OpenLR2 L16108-L16120). */
export const DEFAULT_LR2_RANDOM_MIX_SETTINGS: Readonly<LR2RandomMixSettings> = {
  preferredLevel: 0,
  maxLevel: 0,
  minLevel: 0,
  bpmRange: 10,
  maxBPM: 0,
  minBPM: 0,
  stageCount: 5,
};

/** Each setting's range and step, as LR2's buttons 260-266 step them (OpenLR2 L11155-L11222). */
export const LR2_RANDOM_MIX_SETTING_RANGES: Readonly<
  Record<LR2RandomMixSetting, { readonly max: number; readonly step: number }>
> = {
  preferredLevel: { max: 99, step: 1 },
  maxLevel: { max: 99, step: 1 },
  minLevel: { max: 99, step: 1 },
  bpmRange: { max: 99, step: 1 },
  maxBPM: { max: 990, step: 10 },
  minBPM: { max: 990, step: 10 },
  stageCount: { max: 5, step: 1 },
};

/** A setting snapped to its step and clamped to its range (a non-number reads as LR2's default). */
function clampSetting(key: LR2RandomMixSetting, value: unknown): number {
  const { max, step } = LR2_RANDOM_MIX_SETTING_RANGES[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LR2_RANDOM_MIX_SETTINGS[key];
  return Math.min(max, Math.max(0, Math.round(value / step) * step));
}

/** Settings read back from storage: each value snapped and clamped to its button's range, a missing one LR2's default. */
export function normalizeLR2RandomMixSettings(
  values: Partial<Record<LR2RandomMixSetting, unknown>>,
): LR2RandomMixSettings {
  const settings = { ...DEFAULT_LR2_RANDOM_MIX_SETTINGS };
  for (const key of Object.keys(settings) as LR2RandomMixSetting[]) settings[key] = clampSetting(key, values[key]);
  return settings;
}

/**
 * The settings with one value stepped by `delta` steps, wrapping around at both ends as LR2's `ButtonByInput` does
 * (OpenLR2 L20048-L20086): +1 on a button's right half, -1 on its left half.
 */
export function stepLR2RandomMixSetting(
  settings: LR2RandomMixSettings,
  key: LR2RandomMixSetting,
  delta: number,
): LR2RandomMixSettings {
  const { max, step } = LR2_RANDOM_MIX_SETTING_RANGES[key];
  const count = max / step + 1;
  const index = Math.round(clampSetting(key, settings[key]) / step);
  return { ...settings, [key]: ((((index + Math.trunc(delta)) % count) + count) % count) * step };
}

/**
 * The settings a draw uses: a min level above the max level, or a min BPM above the max BPM, swapped when both are set,
 * as `CreateRandomCourse` does before it draws (and writes back to the config).
 */
export function resolveLR2RandomMixSettings(settings: LR2RandomMixSettings): LR2RandomMixSettings {
  const resolved = normalizeLR2RandomMixSettings(settings);
  if (resolved.minLevel > 0 && resolved.maxLevel > 0 && resolved.minLevel > resolved.maxLevel) {
    [resolved.minLevel, resolved.maxLevel] = [resolved.maxLevel, resolved.minLevel];
  }
  if (resolved.minBPM > 0 && resolved.maxBPM > 0 && resolved.minBPM > resolved.maxBPM) {
    [resolved.minBPM, resolved.maxBPM] = [resolved.maxBPM, resolved.minBPM];
  }
  return resolved;
}

/**
 * One chart a RANDOM MIX can draw: the song database columns `WriteRandomCourse` filters on. LR2's columns are
 * integers, so a host truncates the level and the BPMs.
 */
export interface LR2RandomMixChart {
  /** The chart's MD5 (hex): the course keys its stages by it; a chart without a valid one is never drawn. */
  md5: string;
  /** The song folder: no two stages come from the same one. */
  folder: string;
  /** The key mode (LR2's `mode`: 5, 7, 9, 10, 14). */
  keyMode: number;
  level: number;
  minBPM: number;
  maxBPM: number;
  title?: string;
  subtitle?: string;
  artist?: string;
}

/** What a RANDOM MIX is drawn for: the course folder it is drawn in and the key mode of the select key filter. */
export interface LR2RandomMixDrawOptions {
  /** The course folder's kind: LR2 lists the bar in the EXPERT and NONSTOP folders, not GRADE. */
  kind: 'expert' | 'nonstop';
  /** The key mode to draw (`resolveLR2RandomMixKeyMode`). */
  keyMode: number;
  settings: LR2RandomMixSettings;
  /** The connection a NONSTOP draw gets after every stage (LR2's `config.course.defaultconnection`). Default `fade`. */
  defaultConnection?: NonstopConnection;
}

export type LR2RandomMixDrawResult<T> =
  | {
      ok: true;
      /** The drawn course, named {@link LR2_RANDOM_MIX_NAME}, shaped as a course the player made. */
      course: CourseDefinition;
      /** One per stage, in stage order. */
      charts: T[];
      /** The settings drawn with, min and max swapped where they were the wrong way round. */
      settings: LR2RandomMixSettings;
    }
  | { ok: false; reason: 'no-candidates' };

/** An index in `[0, length)` from a `[0, 1)` draw. */
function pick(random: () => number, length: number): number {
  const value = Math.floor(random() * length);
  return Number.isFinite(value) ? Math.min(length - 1, Math.max(0, value)) : 0;
}

/** The rows in a random order, standing for SQLite's `ORDER BY random()` (a Fisher-Yates shuffle). */
function shuffle<T>(rows: readonly T[], random: () => number): T[] {
  const shuffled = [...rows];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = pick(random, index + 1);
    [shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
  }
  return shuffled;
}

const HEX_32 = /^[0-9a-f]{32}$/iu;

/**
 * Draws a RANDOM MIX course, as LR2's `WriteRandomCourse` does:
 *
 * 1. The stage count is `settings.stageCount`, or 2-5 at random when it is 0.
 * 2. Stage 1 is drawn from the charts of `keyMode` within the level limits whose BPMs lie within the BPM limits (min BPM
 *    at least the lower, max BPM at most the upper); with a BPM range set it must also have a constant BPM.
 * 3. Stages 2+ are drawn, in one random order, from the charts within the level limits whose BPMs lie within the BPM
 *    range around stage 1's max BPM (intersected with the BPM limits; the limits alone without a range). A chart from
 *    a song folder an earlier stage came from is skipped, so the course can come out shorter than asked.
 * 4. With a preferred level, each drawn chart is replaced by the chart of its folder and key mode within the level limits
 *    nearest that level (the first in `charts` order on a tie); its BPMs are not checked again.
 *
 * Unknown in LR2 and read here: LR2 draws with SQLite `random()` and DxLib `GetRand`; `random` (values in `[0, 1)`)
 * stands in for both, so a draw is deterministic given it: first the stage count (when random), then stage 1's order,
 * then stages 2+'s. `charts` stands in for the database's row order. Stages 2+ are filtered by `keyMode` too, as LR2's
 * second query is (`mode=<key>`).
 *
 * The course is a course the player made, named {@link LR2_RANDOM_MIX_NAME}, in stage 1's key mode, unranked
 * (`release: false`, LR2's `ir = 0`); a NONSTOP one gets `defaultConnection` after every stage. Fails when no chart can
 * be stage 1.
 */
export function drawLR2RandomMix<T extends LR2RandomMixChart>(
  options: LR2RandomMixDrawOptions,
  charts: readonly T[],
  random: () => number,
): LR2RandomMixDrawResult<T> {
  const settings = resolveLR2RandomMixSettings(options.settings);
  const { keyMode } = options;
  const stageCount = settings.stageCount > 0 ? settings.stageCount : pick(random, 4) + 2;
  const usable = charts.filter((chart) => HEX_32.test(chart.md5) && chart.keyMode === keyMode);
  const minLevel = settings.minLevel > 0 ? settings.minLevel : -Infinity;
  const maxLevel = settings.maxLevel > 0 ? settings.maxLevel : Infinity;
  const minBPM = settings.minBPM > 0 ? settings.minBPM : -Infinity;
  const maxBPM = settings.maxBPM > 0 ? settings.maxBPM : Infinity;
  const inLevel = (chart: T): boolean => minLevel <= chart.level && chart.level <= maxLevel;
  const inBPM = (chart: T, low: number, high: number): boolean => low <= chart.minBPM && chart.maxBPM <= high;

  // `GetRandomSongHash`: the chart of the folder nearest the preferred level.
  const prefer = (chart: T): T => {
    if (settings.preferredLevel < 1) return chart;
    let best: T | undefined;
    for (const other of usable) {
      if (other.folder !== chart.folder || !inLevel(other)) continue;
      const distance = Math.abs(other.level - settings.preferredLevel);
      if (best === undefined || distance < Math.abs(best.level - settings.preferredLevel)) best = other;
    }
    return best ?? chart;
  };

  const firstRow = shuffle(
    usable.filter(
      (chart) =>
        inLevel(chart) && inBPM(chart, minBPM, maxBPM) && (settings.bpmRange <= 0 || chart.minBPM === chart.maxBPM),
    ),
    random,
  )[0];
  if (firstRow === undefined) return { ok: false, reason: 'no-candidates' };
  const drawn = [prefer(firstRow)];
  const folders = new Set([firstRow.folder]);
  const low = settings.bpmRange > 0 ? Math.max(minBPM, firstRow.maxBPM - settings.bpmRange) : minBPM;
  const high = settings.bpmRange > 0 ? Math.min(maxBPM, firstRow.maxBPM + settings.bpmRange) : maxBPM;
  for (const row of shuffle(
    usable.filter((chart) => inLevel(chart) && inBPM(chart, low, high)),
    random,
  )) {
    if (drawn.length >= stageCount) break;
    if (folders.has(row.folder)) continue;
    folders.add(row.folder);
    drawn.push(prefer(row));
  }

  const course = finishCourseDraft(
    {
      kind: options.kind,
      name: LR2_RANDOM_MIX_NAME,
      stages: drawn.map((chart) => ({
        md5: chart.md5.toLowerCase(),
        keyMode: chart.keyMode,
        ...(chart.title !== undefined ? { title: chart.title } : {}),
        ...(chart.subtitle !== undefined ? { subtitle: chart.subtitle } : {}),
        ...(chart.artist !== undefined ? { artist: chart.artist } : {}),
      })),
    },
    options.defaultConnection !== undefined ? { defaultConnection: options.defaultConnection } : {},
  )!;
  return { ok: true, course, charts: drawn, settings };
}

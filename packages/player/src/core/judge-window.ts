import type { BeMusicJson } from '@be-music/json';

/**
 * LR2 judge windows.
 *
 * Source of truth: LR2 measurements collected on hitkey's diary (2015-01-19 "Memo: LR2 timegates",
 * https://hitkey.nekokan.dyndns.info/diary1501.php#D150119) and the machine-readable LR2-compat tables in lr2oraja
 * (`JudgeProperty.java`, `LR2_SCALING`):
 *
 * | #RANK         | PGREAT | GREAT | GOOD  | BAD   |
 * | ------------- | ------ | ----- | ----- | ----- |
 * | 0 VERY HARD   | ±8ms   | ±24ms | ±40ms | ±200ms|
 * | 1 HARD        | ±15ms  | ±30ms | ±60ms | ±200ms|
 * | 2 NORMAL      | ±18ms  | ±40ms | ±100ms| ±200ms|
 * | 3 EASY        | ±21ms  | ±60ms | ±120ms| ±200ms|
 * | 4 VERY EASY   | = NORMAL (LR2 treats #RANK 4 as NORMAL — lr2oraja README) |
 *
 * The BAD window is FIXED at ±200ms for every rank; only PGREAT / GREAT / GOOD scale. Scratch shares the key
 * windows (no widened scratch gate in LR2).
 *
 * Percent axis: ranks sit on a "judgerank percent" axis (VERY HARD = 25, HARD = 50, NORMAL = 75, EASY = 100) and
 * fractional percents (from `#DEFEXRANK` / `#EXRANKxx` / bmson `judge_rank`) interpolate piecewise-linearly between
 * the measured anchors — the same model lr2oraja uses (`JudgeWindowRule.LR2`). Values beyond EASY extrapolate along
 * the last segment and every scaled window is clamped to the fixed BAD width.
 */
const LR2_BAD_WINDOW_MS = 200;
const LR2_JUDGE_RANK_ANCHOR_PERCENTS = [0, 25, 50, 75, 100] as const;
const LR2_PGREAT_ANCHORS_MS = [0, 8, 15, 18, 21] as const;
const LR2_GREAT_ANCHORS_MS = [0, 24, 30, 40, 60] as const;
const LR2_GOOD_ANCHORS_MS = [0, 40, 60, 100, 120] as const;
/** `#RANK 0..4` → judgerank percent. `#RANK 4` (VERY EASY) maps onto NORMAL, mirroring LR2. */
const LR2_BMS_RANK_JUDGERANK_PERCENTS = [25, 50, 75, 100, 75] as const;
const LR2_NORMAL_JUDGERANK_PERCENT = LR2_BMS_RANK_JUDGERANK_PERCENTS[2];
/** bmson `judge_rank` default per the 1.0.0 spec (100 = the player's default width, i.e. NORMAL here). */
const BMSON_DEFAULT_JUDGERANK = 100;

export interface JudgeWindowsMs {
  pgreat: number;
  great: number;
  good: number;
  bad: number;
}

/**
 * Converts a `#DEFEXRANK` / `#EXRANKxx` / bmson `judge_rank` value to the internal judgerank percent.
 *
 * All three share the same unit: a percentage with "100 = NORMAL" (hitkey command memo for `#DEFEXRANK`: "The value
 * 100 corresponds to #RANK 2"; bmson 1.0.0: 100 = the player's default). NORMAL sits at
 * `LR2_NORMAL_JUDGERANK_PERCENT` (= 75) on the internal axis, so the conversion is `value × 75 / 100`. Every
 * consumer that turns such a value into judge windows must route through this function — it is the single place the
 * unit is defined.
 */
export function bmsExRankValueToJudgeRankPercent(value: number): number {
  return (value * LR2_NORMAL_JUDGERANK_PERCENT) / 100;
}

function resolveBmsJudgeRankPercent(json: BeMusicJson): number {
  const defExRank = json.bms.defExRank;
  if (typeof defExRank === 'number' && Number.isFinite(defExRank) && defExRank > 0) {
    return bmsExRankValueToJudgeRankPercent(defExRank);
  }

  const rankValue = Number.isFinite(json.metadata.rank) ? Math.trunc(json.metadata.rank!) : Number.NaN;
  if (Number.isFinite(rankValue) && rankValue >= 0 && rankValue < LR2_BMS_RANK_JUDGERANK_PERCENTS.length) {
    return LR2_BMS_RANK_JUDGERANK_PERCENTS[rankValue as 0 | 1 | 2 | 3 | 4];
  }

  return LR2_NORMAL_JUDGERANK_PERCENT;
}

function resolveBmsonJudgeRankPercent(json: BeMusicJson): number {
  const judgeRank = json.bmson.info.judgeRank;
  if (Number.isFinite(judgeRank) && (judgeRank ?? 0) > 0) {
    return bmsExRankValueToJudgeRankPercent(judgeRank!);
  }
  const metadataRank = json.metadata.rank;
  if (Number.isFinite(metadataRank) && (metadataRank ?? 0) > 0) {
    return bmsExRankValueToJudgeRankPercent(metadataRank!);
  }
  return bmsExRankValueToJudgeRankPercent(BMSON_DEFAULT_JUDGERANK);
}

export function resolveBmsJudgeWindowsMsForPercent(
  judgeRankPercent: number,
  debugBadWindowMs?: number,
): JudgeWindowsMs {
  return scaleJudgeWindowsMs(judgeRankPercent, debugBadWindowMs);
}

/**
 * Resolves judge windows for a dynamic `#EXRANKxx` value applied via channel `A0` mid-chart.
 *
 * `#EXRANKxx` shares `#DEFEXRANK`'s unit (`RANK 2 = 100`, hitkey command memo), so the value goes through
 * {@link bmsExRankValueToJudgeRankPercent} before scaling — `#EXRANK 100` lands on exactly the same windows as
 * `#DEFEXRANK 100` (NORMAL).
 */
export function resolveBmsJudgeWindowsMsForExRankValue(exRankValue: number, debugBadWindowMs?: number): JudgeWindowsMs {
  return resolveBmsJudgeWindowsMsForPercent(bmsExRankValueToJudgeRankPercent(exRankValue), debugBadWindowMs);
}

export function resolveJudgeWindowsMs(json: BeMusicJson, debugBadWindowMs?: number): JudgeWindowsMs {
  const judgeRank = json.sourceFormat === 'bmson' ? resolveBmsonJudgeRankPercent(json) : resolveBmsJudgeRankPercent(json);
  return scaleJudgeWindowsMs(judgeRank, debugBadWindowMs);
}

function scaleJudgeWindowsMs(judgeRankPercent: number, debugBadWindowMs?: number): JudgeWindowsMs {
  const bad =
    typeof debugBadWindowMs === 'number' && Number.isFinite(debugBadWindowMs) && debugBadWindowMs > 0
      ? debugBadWindowMs
      : LR2_BAD_WINDOW_MS;
  const percent = Number.isFinite(judgeRankPercent) ? Math.max(0, judgeRankPercent) : LR2_NORMAL_JUDGERANK_PERCENT;
  return {
    pgreat: clampWindow(interpolateAnchors(LR2_PGREAT_ANCHORS_MS, percent), bad),
    great: clampWindow(interpolateAnchors(LR2_GREAT_ANCHORS_MS, percent), bad),
    good: clampWindow(interpolateAnchors(LR2_GOOD_ANCHORS_MS, percent), bad),
    bad,
  };
}

/**
 * Piecewise-linear interpolation of an LR2 window over the judgerank percent anchors; percents beyond the EASY
 * anchor (100) extrapolate along the final segment, matching lr2oraja's `JudgeWindowRule.LR2`.
 */
function interpolateAnchors(anchors: readonly number[], percent: number): number {
  const points = LR2_JUDGE_RANK_ANCHOR_PERCENTS;
  for (let index = 1; index < points.length; index += 1) {
    if (percent <= points[index]! || index === points.length - 1) {
      const x0 = points[index - 1]!;
      const x1 = points[index]!;
      const y0 = anchors[index - 1]!;
      const y1 = anchors[index]!;
      return y0 + ((percent - x0) * (y1 - y0)) / (x1 - x0);
    }
  }
  return anchors.at(-1)!;
}

function clampWindow(value: number, badWindowMs: number): number {
  // LR2 never lets a scaled window exceed the fixed BAD gate (ralba: "#DEFEXRANK でどれだけ拡げても BAD の判定幅を
  // 超えない"), and a negative width is meaningless.
  return Math.min(Math.max(0, value), badWindowMs);
}

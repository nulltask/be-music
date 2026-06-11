import type { BeMusicJson } from '@be-music/json';

const IIDX_PGREAT_WINDOW_MS = 16.67;
const IIDX_GREAT_WINDOW_MS = 33.33;
const IIDX_GOOD_WINDOW_MS = 116.67;
const IIDX_BAD_WINDOW_MS = 250;
const BEATORAJA_BMS_JUDGERANK_MULTIPLIERS = [25, 50, 75, 100, 125] as const;
const BEATORAJA_BMS_DEFAULT_JUDGERANK = BEATORAJA_BMS_JUDGERANK_MULTIPLIERS[2];
const BEATORAJA_BMSON_DEFAULT_JUDGERANK = 100;

export interface JudgeWindowsMs {
  pgreat: number;
  great: number;
  good: number;
  bad: number;
}

/**
 * Converts a `#DEFEXRANK` / `#EXRANKxx` value to the internal judge-rank percent.
 *
 * Both directives share the same unit per the BMS de-facto spec (hitkey command memo): the value is a percentage
 * multiplier with `RANK 2 (NORMAL) = 100` as the baseline. Internally NORMAL sits at
 * `BEATORAJA_BMS_DEFAULT_JUDGERANK` (= 75), so the conversion is `value × 75 / 100`. Every consumer that turns an
 * EXRANK-family value into judge windows must route through this function — it is the single place the unit is
 * defined.
 */
export function bmsExRankValueToJudgeRankPercent(value: number): number {
  return (value * BEATORAJA_BMS_DEFAULT_JUDGERANK) / 100;
}

function resolveBmsJudgeRankPercent(json: BeMusicJson): number {
  const defExRank = json.bms.defExRank;
  if (typeof defExRank === 'number' && Number.isFinite(defExRank) && defExRank > 0) {
    return bmsExRankValueToJudgeRankPercent(defExRank);
  }

  const rankValue = Number.isFinite(json.metadata.rank) ? Math.trunc(json.metadata.rank!) : Number.NaN;
  if (Number.isFinite(rankValue) && rankValue >= 0 && rankValue < BEATORAJA_BMS_JUDGERANK_MULTIPLIERS.length) {
    return BEATORAJA_BMS_JUDGERANK_MULTIPLIERS[rankValue as 0 | 1 | 2 | 3 | 4];
  }

  return BEATORAJA_BMS_DEFAULT_JUDGERANK;
}

function resolveBmsonJudgeRankPercent(json: BeMusicJson): number {
  const judgeRank = json.bmson.info.judgeRank;
  if (Number.isFinite(judgeRank) && (judgeRank ?? 0) > 0) {
    return judgeRank!;
  }
  const metadataRank = json.metadata.rank;
  if (Number.isFinite(metadataRank) && (metadataRank ?? 0) > 0) {
    return metadataRank!;
  }
  return BEATORAJA_BMSON_DEFAULT_JUDGERANK;
}

export function resolveBmsJudgeWindowsMsForPercent(
  judgeRankPercent: number,
  debugBadWindowMs?: number,
): JudgeWindowsMs {
  return scaleJudgeWindowsMs(judgeRankPercent, BEATORAJA_BMS_DEFAULT_JUDGERANK, debugBadWindowMs);
}

/**
 * Resolves judge windows for a dynamic `#EXRANKxx` value applied via channel `A0` mid-chart.
 *
 * KNOWN DEVIATION (spec audit A-2): the raw `#EXRANKxx` value is currently fed straight into the percent-based
 * scaler, skipping {@link bmsExRankValueToJudgeRankPercent}. The static `#DEFEXRANK` path applies that conversion, so
 * `#EXRANK 100` today yields windows 100/75 ≈ 1.33× wider than `#DEFEXRANK 100`. Spec-wise both directives share the
 * `RANK 2 = 100` unit, so the intended body is
 * `resolveBmsJudgeWindowsMsForPercent(bmsExRankValueToJudgeRankPercent(exRankValue), debugBadWindowMs)` — a
 * single-line fix here repairs every runtime at once.
 */
export function resolveBmsJudgeWindowsMsForExRankValue(exRankValue: number, debugBadWindowMs?: number): JudgeWindowsMs {
  return resolveBmsJudgeWindowsMsForPercent(exRankValue, debugBadWindowMs);
}

export function resolveJudgeWindowsMs(json: BeMusicJson, debugBadWindowMs?: number): JudgeWindowsMs {
  const bmsonStyle = json.sourceFormat === 'bmson';
  const baseJudgerank = bmsonStyle ? BEATORAJA_BMSON_DEFAULT_JUDGERANK : BEATORAJA_BMS_DEFAULT_JUDGERANK;
  const judgeRank = bmsonStyle ? resolveBmsonJudgeRankPercent(json) : resolveBmsJudgeRankPercent(json);
  return scaleJudgeWindowsMs(judgeRank, baseJudgerank, debugBadWindowMs);
}

function scaleJudgeWindowsMs(judgeRank: number, baseJudgerank: number, debugBadWindowMs?: number): JudgeWindowsMs {
  const scale = judgeRank / baseJudgerank;
  const pgreat = IIDX_PGREAT_WINDOW_MS * scale;
  const great = IIDX_GREAT_WINDOW_MS * scale;
  const good = IIDX_GOOD_WINDOW_MS * scale;
  const badFromRank = IIDX_BAD_WINDOW_MS * scale;
  const bad =
    typeof debugBadWindowMs === 'number' && Number.isFinite(debugBadWindowMs) && debugBadWindowMs > 0
      ? debugBadWindowMs
      : badFromRank;
  return {
    pgreat,
    great,
    good,
    bad,
  };
}

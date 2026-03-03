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

function resolveBmsJudgeRankPercent(json: BeMusicJson): number {
  const defExRank = json.bms.defExRank;
  if (typeof defExRank === 'number' && Number.isFinite(defExRank) && defExRank > 0) {
    return (defExRank * BEATORAJA_BMS_DEFAULT_JUDGERANK) / 100;
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

export function resolveJudgeWindowsMs(json: BeMusicJson, debugBadWindowMs?: number): JudgeWindowsMs {
  const bmsonStyle = json.sourceFormat === 'bmson';
  const baseJudgerank = bmsonStyle ? BEATORAJA_BMSON_DEFAULT_JUDGERANK : BEATORAJA_BMS_DEFAULT_JUDGERANK;
  const judgeRank = bmsonStyle ? resolveBmsonJudgeRankPercent(json) : resolveBmsJudgeRankPercent(json);
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

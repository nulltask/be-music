import type { BeMusicClearLamp } from '@be-music/skin-sdk';
import type { ScoreSummary } from '@be-music/player/core/scoring';

/**
 * Clear lamp of a gauge, by the gauge ids the rulesets use (`GROOVE` / `EASY` / `HARD` / `DEATH` under LR2,
 * `ASSIST-EASY` / `EASY` / `NORMAL` / `HARD` / `EX-HARD` / `HAZARD` under beatoraja, `ASSISTED-EASY` … under IIDX).
 * DEATH and HAZARD clear on the strictest lamp below the full-combo ones.
 */
const GAUGE_LAMPS: Readonly<Record<string, BeMusicClearLamp>> = {
  'ASSIST-EASY': 'ASSIST_EASY',
  'ASSISTED-EASY': 'ASSIST_EASY',
  EASY: 'EASY',
  GROOVE: 'NORMAL',
  NORMAL: 'NORMAL',
  HARD: 'HARD',
  'EX-HARD': 'EX_HARD',
  DEATH: 'EX_HARD',
  HAZARD: 'EX_HARD',
};

/**
 * Resolves the clear lamp of a finished play. A failed gauge is `FAILED`; a clear where every note was judged GOOD or
 * better is `FULL_COMBO`, `PERFECT` when GREAT or better, and `MAX` when every one was a PERFECT; any other clear takes
 * the lamp of its gauge (`NORMAL` for gauges the table doesn't know). Empty POORs never touch a note, so they don't
 * cost a full combo.
 */
export function resolveClearLamp(play: {
  cleared: boolean;
  score: Pick<ScoreSummary, 'total' | 'perfect' | 'great' | 'good'>;
  gaugeType?: string;
}): BeMusicClearLamp {
  if (!play.cleared) return 'FAILED';
  const { total, perfect, great, good } = play.score;
  if (total > 0) {
    if (perfect >= total) return 'MAX';
    if (perfect + great >= total) return 'PERFECT';
    if (perfect + great + good >= total) return 'FULL_COMBO';
  }
  return (play.gaugeType !== undefined ? GAUGE_LAMPS[play.gaugeType.toUpperCase()] : undefined) ?? 'NORMAL';
}

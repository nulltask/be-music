import { resolveClearLamp } from '@be-music/player/ruleset';
import type { BeMusicResultData } from './result-data.ts';
import { formatPlayVariantLabel } from './chart-stats.ts';

/**
 * The play's clear lamp as the result track column labels it: `PERFECT` (every note a PGREAT), `FULL COMBO` (no BAD /
 * POOR), `CLEAR`, or `FAILED`. Empty POORs never break a combo, so they don't cost a full combo either.
 */
export type ResultLamp = 'PERFECT' | 'FULL COMBO' | 'CLEAR' | 'FAILED';

/**
 * The result track's label for the play's clear lamp, by the one clear-lamp rule (`resolveClearLamp` of
 * `@be-music/player/ruleset`) on beatoraja's full set of lamps: MAX reads `PERFECT`, a PERFECT or FULL COMBO lamp
 * `FULL COMBO`, and any other clear `CLEAR`.
 */
export function resolveResultLamp(result: Pick<BeMusicResultData, 'score' | 'cleared'>): ResultLamp {
  const lamp = resolveClearLamp({ cleared: result.cleared, score: result.score });
  if (lamp === 'FAILED') return 'FAILED';
  if (lamp === 'MAX') return 'PERFECT';
  return lamp === 'PERFECT' || lamp === 'FULL_COMBO' ? 'FULL COMBO' : 'CLEAR';
}

/** The headline a result screen leads with. */
export type ResultVerdict = 'STAGE CLEAR' | 'FAILED' | 'COURSE CLEAR' | 'COURSE FAILED';

/**
 * The result's headline: `STAGE CLEAR` / `FAILED` for one play, `COURSE CLEAR` / `COURSE FAILED` for the result of a
 * whole EXPERT / GRADE course run (`run: 'course'`). A course stage and a NONSTOP run read as one play.
 */
export function resolveResultVerdict(result: Pick<BeMusicResultData, 'cleared' | 'run'>): ResultVerdict {
  if (result.run === 'course') return result.cleared ? 'COURSE CLEAR' : 'COURSE FAILED';
  return result.cleared ? 'STAGE CLEAR' : 'FAILED';
}

/** One label / value line of the track column. */
export interface ResultTrackRow {
  label: string;
  value: string;
}

/**
 * The chart facts the 16:9 result screens list beside the score grid: play mode, level, tempo, and the combo breaks
 * (BAD + POOR) of the run.
 */
export function resolveResultTrackRows(result: Pick<BeMusicResultData, 'score' | 'chart'>): ResultTrackRow[] {
  const { chart: chartEntry, score } = result;
  return [
    { label: 'MODE', value: formatPlayVariantLabel(chartEntry) },
    {
      label: 'LEVEL',
      value:
        chartEntry.playLevel !== undefined && String(chartEntry.playLevel) !== '' ? String(chartEntry.playLevel) : '-',
    },
    {
      label: 'BPM',
      value: chartEntry.bpm !== undefined && Number.isFinite(chartEntry.bpm) ? String(Math.round(chartEntry.bpm)) : '-',
    },
    { label: 'COMBO BREAK', value: String(Math.max(0, score.bad + score.poor)) },
  ];
}

import type { BeMusicResultData } from './result-data.ts';
import { formatPlayVariantLabel } from './song-stats.ts';

/**
 * The play's clear lamp as the result track column labels it: `PERFECT` (every note a PGREAT), `FULL COMBO` (no BAD /
 * POOR), `CLEAR`, or `FAILED`. Empty POORs never break a combo, so they don't cost a full combo either.
 */
export type ResultLamp = 'PERFECT' | 'FULL COMBO' | 'CLEAR' | 'FAILED';

export function resolveResultLamp(result: Pick<BeMusicResultData, 'score' | 'cleared'>): ResultLamp {
  const { score } = result;
  if (!result.cleared) return 'FAILED';
  if (score.total <= 0) return 'CLEAR';
  if (score.bad + score.poor > 0) return 'CLEAR';
  return score.perfect >= score.total ? 'PERFECT' : 'FULL COMBO';
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
export function resolveResultTrackRows(result: Pick<BeMusicResultData, 'score' | 'song'>): ResultTrackRow[] {
  const { song, score } = result;
  return [
    { label: 'MODE', value: formatPlayVariantLabel(song) },
    {
      label: 'LEVEL',
      value: song.playLevel !== undefined && String(song.playLevel) !== '' ? String(song.playLevel) : '-',
    },
    { label: 'BPM', value: song.bpm !== undefined && Number.isFinite(song.bpm) ? String(Math.round(song.bpm)) : '-' },
    { label: 'COMBO BREAK', value: String(Math.max(0, score.bad + score.poor)) },
  ];
}

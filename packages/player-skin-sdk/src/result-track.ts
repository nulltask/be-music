import { classifyReplayAssists, resolveAssistClass } from '@be-music/player-engine/records';
import { resolveClearLamp } from '@be-music/player-engine/ruleset';
import { isAutoPlayResult } from '@be-music/player-scene-model';
import type { BeMusicResultData } from './result-data.ts';
import { formatPlayVariantLabel } from './chart-stats.ts';

/**
 * The play's clear lamp as the result track column labels it: `PERFECT` (every note a PGREAT), `FULL COMBO` (no BAD /
 * POOR), `CLEAR`, or `FAILED`. Empty POORs never break a combo, so they don't cost a full combo either.
 */
export type ResultLamp = 'PERFECT' | 'FULL COMBO' | 'CLEAR' | 'FAILED';

/**
 * The result track's label for the play's clear lamp, by the one clear-lamp rule (`resolveClearLamp` of
 * `@be-music/player-engine/ruleset`) on beatoraja's full set of lamps: MAX reads `PERFECT`, a PERFECT or FULL COMBO lamp
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

/**
 * How a result was played, when not by the player's hands alone: `AUTO PLAY` for a full AUTO play, `ASSIST` for a play
 * with assisted options (AUTO SCRATCH, a widened judge, …).
 */
export type ResultPlayTag = 'AUTO PLAY' | 'ASSIST';

const ASSISTED_REPLAYS = new WeakMap<object, boolean>();

/**
 * The tag a result screen shows beside its verdict, so an AUTO or assisted play's result never reads as a plain one: `AUTO
 * PLAY` for a full AUTO play (`isAutoPlayResult` of `@be-music/player-scene-model`, as LR2 keeps AUTOPLAY on through the
 * result), else `ASSIST` when the replay the play recorded used an assisted option by the assist policy the clear lamp and
 * the Leaderboard follow (`classifyReplayAssists`, #602), else none. A play without a recorded replay (a replay played
 * back, a course run) reads only its AUTO flag.
 */
export function resolveResultPlayTag(
  result: Pick<BeMusicResultData, 'autoPlay' | 'replay'>,
): ResultPlayTag | undefined {
  if (isAutoPlayResult(result)) return 'AUTO PLAY';
  const { replay } = result;
  if (replay === undefined) return undefined;
  let assisted = ASSISTED_REPLAYS.get(replay);
  if (assisted === undefined) {
    assisted = resolveAssistClass(classifyReplayAssists(replay)) !== 'none';
    ASSISTED_REPLAYS.set(replay, assisted);
  }
  return assisted ? 'ASSIST' : undefined;
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

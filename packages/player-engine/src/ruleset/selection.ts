import type { BeatorajaJudgeAlgorithm, JudgeWindowSetUs } from './definitions.ts';
import type { RulesetJudgeIndex } from './judge.ts';

/**
 * One note a press could resolve against. `dmUs` follows the window convention
 * (`dmUs = noteTimeUs - inputTimeUs`, positive = the press is EARLY).
 */
export interface JudgeSelectionCandidate {
  noteTimeUs: number;
  dmUs: number;
  judge: RulesetJudgeIndex;
  /** The window set this note judges on — its own lane kind, not the pressing lane's. */
  windows: JudgeWindowSetUs;
}

/**
 * Should `candidate` displace `best` as the note this press resolves against?
 *
 * beatoraja `JudgeAlgorithm` (`JudgeManager.java`), with the caller supplying candidates in ascending note order:
 *
 * - `lowest` — never displace. The earliest note in reach wins, so a press always clears the oldest pending note
 *   even when a later one is closer in time. LR2 and IIDX both work this way.
 * - `duration` — the note closest in absolute time wins.
 * - `combo` (beatoraja's default) / `score` — displace only once `best` has fallen out of the late side of its own
 *   GOOD (`combo`) or GREAT (`score`) window while the candidate is still inside the early side of its. This keeps
 *   a combo alive by preferring the note that can still be judged well.
 */
export function preferJudgeCandidate(
  algorithm: BeatorajaJudgeAlgorithm,
  best: JudgeSelectionCandidate,
  candidate: JudgeSelectionCandidate,
  inputTimeUs: number,
): boolean {
  if (algorithm === 'lowest') {
    return false;
  }
  if (algorithm === 'duration') {
    return Math.abs(candidate.dmUs) < Math.abs(best.dmUs);
  }
  const judgeIndex = algorithm === 'combo' ? 2 : 1;
  return (
    best.noteTimeUs < inputTimeUs + best.windows.judges[judgeIndex]![0] &&
    candidate.noteTimeUs <= inputTimeUs + candidate.windows.judges[judgeIndex]![1]
  );
}

/**
 * Pick the note a press resolves against, from candidates given in ascending note order. Pure reduction over
 * {@link preferJudgeCandidate} — callers that also track unscoreable candidates (empty POOR) rank those first.
 */
export function selectJudgeCandidate<T extends JudgeSelectionCandidate>(
  candidates: readonly T[],
  algorithm: BeatorajaJudgeAlgorithm,
  inputTimeUs: number,
): T | undefined {
  let best: T | undefined;
  for (const candidate of candidates) {
    if (best === undefined || preferJudgeCandidate(algorithm, best, candidate, inputTimeUs)) {
      best = candidate;
    }
  }
  return best;
}

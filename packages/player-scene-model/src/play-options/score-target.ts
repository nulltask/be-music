/**
 * The score graph's fixed targets, as beatoraja 0.8.9's `TargetProperty` defines them: a rank border, MAX, or the next
 * rank above the best record. A target is an EX score for the chart's note count; the pacemaker paces towards it.
 */

/** The rank borders in twenty-sevenths of the maximum EX score, as beatoraja's `StaticTargetProperty` lists them. */
const RANK_TARGETS = {
  'RATE_A-': { label: 'RANK A-', steps: 17 },
  RATE_A: { label: 'RANK A', steps: 18 },
  'RATE_A+': { label: 'RANK A+', steps: 19 },
  'RATE_AA-': { label: 'RANK AA-', steps: 20 },
  RATE_AA: { label: 'RANK AA', steps: 21 },
  'RATE_AA+': { label: 'RANK AA+', steps: 22 },
  'RATE_AAA-': { label: 'RANK AAA-', steps: 23 },
  RATE_AAA: { label: 'RANK AAA', steps: 24 },
  'RATE_AAA+': { label: 'RANK AAA+', steps: 25 },
  'RATE_MAX-': { label: 'RANK MAX-', steps: 26 },
} as const;

/** The targets offered, in beatoraja's default `targetlist` order, with NEXT RANK last. */
export const SCORE_TARGET_IDS = [
  'RATE_A-',
  'RATE_A',
  'RATE_A+',
  'RATE_AA-',
  'RATE_AA',
  'RATE_AA+',
  'RATE_AAA-',
  'RATE_AAA',
  'RATE_AAA+',
  'RATE_MAX-',
  'MAX',
  'RANK_NEXT',
] as const;

export type ScoreTargetId = (typeof SCORE_TARGET_IDS)[number];

/** A resolved target: its name on the graph and its EX score. */
export interface ScoreTarget {
  readonly label: string;
  readonly exScore: number;
}

/**
 * The EX score of a rank border: beatoraja computes `ceil(notes × 2 × rate / 100)` with the rate `100 × steps / 27` in
 * single precision, so the same rounding is kept (a border that falls on a whole score can round up by one).
 */
function rankBorder(maxEXScore: number, steps: number): number {
  const rate = Math.fround(Math.fround(100 * steps) / 27);
  return Math.ceil(Math.fround(Math.fround(maxEXScore * rate) / 100));
}

/**
 * The target `id` names for a chart of `totalNotes` notes, or `undefined` without notes. NEXT RANK is the first border
 * from 15/27 up that the best EX score has not reached (`ceil(max × i / 27)`), or MAX past the last.
 */
export function resolveScoreTarget(
  id: ScoreTargetId,
  chart: { readonly totalNotes: number; readonly bestEXScore?: number },
): ScoreTarget | undefined {
  if (!Number.isFinite(chart.totalNotes) || chart.totalNotes <= 0) return undefined;
  const max = Math.trunc(chart.totalNotes) * 2;
  if (id === 'MAX') return { label: 'MAX', exScore: max };
  if (id === 'RANK_NEXT') {
    const best = chart.bestEXScore ?? 0;
    for (let steps = 15; steps < 27; steps += 1) {
      const border = Math.ceil(Math.fround((max * steps) / Math.fround(27)));
      if (best < border) return { label: 'NEXT RANK', exScore: border };
    }
    return { label: 'NEXT RANK', exScore: max };
  }
  const rank = RANK_TARGETS[id];
  return { label: rank.label, exScore: Math.min(max, rankBorder(max, rank.steps)) };
}

/**
 * The score graph's targets, as beatoraja 0.8.9's `TargetProperty` defines them: a rank border, MAX, the next rank
 * above the best record, a score rate, or a place on the chart's ranking. A target is an EX score for the chart's note
 * count; the pacemaker paces towards it.
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

/**
 * The targets offered, in beatoraja's default `targetlist` order: the rank borders, MAX, NEXT RANK and the ranking
 * targets (`IR_*`). `SCORE_RATE` comes last: beatoraja's `RATE_<n>`, with the rate held by `scoreTargetRate`.
 * beatoraja's `RIVAL_*` targets are not offered: the Leaderboard has no rivals.
 */
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
  'IR_NEXT_1',
  'IR_NEXT_2',
  'IR_NEXT_3',
  'IR_NEXT_4',
  'IR_NEXT_5',
  'IR_NEXT_10',
  'IR_RANK_1',
  'IR_RANK_5',
  'IR_RANK_10',
  'IR_RANK_20',
  'IR_RANK_30',
  'IR_RANK_40',
  'IR_RANK_50',
  'IR_RANKRATE_5',
  'IR_RANKRATE_10',
  'IR_RANKRATE_15',
  'IR_RANKRATE_20',
  'IR_RANKRATE_25',
  'IR_RANKRATE_30',
  'IR_RANKRATE_35',
  'IR_RANKRATE_40',
  'IR_RANKRATE_45',
  'IR_RANKRATE_50',
  'SCORE_RATE',
] as const;

/** The score rate `SCORE_RATE` targets until the player sets one, in percent. */
export const DEFAULT_SCORE_TARGET_RATE = 90;

/** A score rate in percent: 0 to 100 on the 0.1 grid; the default for a value that is not finite. */
export function clampScoreTargetRate(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SCORE_TARGET_RATE;
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

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
  return rateBorder(maxEXScore, Math.fround(Math.fround(100 * steps) / 27));
}

/** `ceil(notes × 2 × rate / 100)` in single precision, as beatoraja's `StaticTargetProperty` computes a rate's score. */
function rateBorder(maxEXScore: number, rate: number): number {
  return Math.ceil(Math.fround(Math.fround(maxEXScore * Math.fround(rate)) / 100));
}

/** A ranking target: the place `value` ranks above the player, the rank `value`, or the top `value` percent. */
export interface RankingScoreTarget {
  readonly kind: 'NEXT' | 'RANK' | 'RANKRATE';
  readonly value: number;
  /** The target's name, as beatoraja's `InternetRankingTargetProperty` words it. */
  readonly label: string;
}

/** The ranking target `id` names, or `undefined` for any other target. */
export function parseRankingScoreTarget(id: ScoreTargetId): RankingScoreTarget | undefined {
  const match = /^IR_(NEXT|RANK|RANKRATE)_(\d+)$/.exec(id);
  if (match === null) return undefined;
  const kind = match[1] as RankingScoreTarget['kind'];
  const value = Number(match[2]);
  const label =
    kind === 'NEXT' ? `IR NEXT ${value}RANK` : kind === 'RANK' ? `IR RANK ${value}` : `IR RANK TOP ${value}%`;
  return { kind, value, label };
}

/**
 * Where a ranking target's score is on a ranking of `players` entries sorted by EX score, best first, as beatoraja's
 * `getTargetRank` picks it; `undefined` on an empty ranking. `ownIndex` is the first entry whose EX score is the
 * player's best or lower, or `undefined` when every entry is above it. NEXT is `value` places above that entry, and
 * the top when no entry is at or below the best (beatoraja returns the first place there too).
 */
export function resolveRankingTargetIndex(
  target: Pick<RankingScoreTarget, 'kind' | 'value'>,
  players: number,
  ownIndex: number | undefined,
): number | undefined {
  if (!Number.isFinite(players) || players <= 0) return undefined;
  const count = Math.trunc(players);
  if (target.kind === 'RANK') return Math.min(count, target.value) - 1;
  if (target.kind === 'RANKRATE') return Math.min(count - 1, Math.trunc((count * target.value) / 100));
  return ownIndex === undefined ? 0 : Math.max(Math.min(ownIndex, count - 1) - target.value, 0);
}

/**
 * The target `id` names for a chart of `totalNotes` notes, or `undefined` without notes. NEXT RANK is the first border
 * from 15/27 up that the best EX score has not reached (`ceil(max × i / 27)`), or MAX past the last. SCORE RATE is
 * `rate` percent of the maximum (`DEFAULT_SCORE_TARGET_RATE` without one). A ranking target takes `rankingEXScore`,
 * the score at its place on the chart's ranking, and is `undefined` until the ranking gives one.
 */
export function resolveScoreTarget(
  id: ScoreTargetId,
  chart: {
    readonly totalNotes: number;
    readonly bestEXScore?: number;
    readonly rate?: number;
    readonly rankingEXScore?: number;
  },
): ScoreTarget | undefined {
  if (!Number.isFinite(chart.totalNotes) || chart.totalNotes <= 0) return undefined;
  const max = Math.trunc(chart.totalNotes) * 2;
  if (id === 'MAX') return { label: 'MAX', exScore: max };
  if (id === 'SCORE_RATE') {
    const rate = clampScoreTargetRate(chart.rate ?? DEFAULT_SCORE_TARGET_RATE);
    return { label: `SCORE RATE ${rate}%`, exScore: Math.min(max, rateBorder(max, rate)) };
  }
  const ranking = parseRankingScoreTarget(id);
  if (ranking !== undefined) {
    if (chart.rankingEXScore === undefined || !Number.isFinite(chart.rankingEXScore)) return undefined;
    return { label: ranking.label, exScore: Math.max(0, Math.min(max, Math.trunc(chart.rankingEXScore))) };
  }
  if (id === 'RANK_NEXT') {
    const best = chart.bestEXScore ?? 0;
    for (let steps = 15; steps < 27; steps += 1) {
      const border = Math.ceil(Math.fround((max * steps) / Math.fround(27)));
      if (best < border) return { label: 'NEXT RANK', exScore: border };
    }
    return { label: 'NEXT RANK', exScore: max };
  }
  const rank = RANK_TARGETS[id as keyof typeof RANK_TARGETS];
  return { label: rank.label, exScore: Math.min(max, rankBorder(max, rank.steps)) };
}

import type { NonstopPlanOptions, NonstopStagePlacement } from './plan.ts';

/** A tempo the BPM readouts show from `seconds` on. */
export interface NonstopTempoPoint {
  seconds: number;
  bpm: number;
}

/** What the readouts need from one stage chart. */
export interface NonstopStageReadoutInput {
  /**
   * The stage's tempo points in its own seconds, in order: the BPM it starts at (at 0) first, then each BPM change, as
   * its readout shows it (`|BPM|`; LR2 reads a negative `#BPMxx` as `|trunc(BPM)|`).
   */
  tempo: readonly NonstopTempoPoint[];
  /** The header `#BPM`, when the chart has one. */
  headerBPM?: number;
  /** The header `#RANK`, when the chart has one. */
  rank?: number;
  /** Source units for a mixed-format NONSTOP stage; omitted by the legacy BMS stitch path. */
  sourceFormat?: 'bms' | 'bmson';
  bmsonJudgeRank?: number;
  exRank?: number;
  /** Stitched seconds of the stage's first and last judged note heads, when it has any. */
  noteHeads?: { first: number; last: number };
}

/**
 * How a later stage's `#RANK` sets the judge windows: `'chart'` as a chart opening with that `#RANK` does, or
 * `'lr2-nonstop'` by the table LR2's NONSTOP rank object reads (`LR2body.exe` 0x42be2f). Mixed bmson output also
 * carries raw `judge_rank` (`'bmson'`) or BMS `#DEFEXRANK` (`'bms-exrank'`) values.
 */
export type NonstopStageRankTable = 'chart' | 'lr2-nonstop' | 'bmson' | 'bms-exrank';

/** A later stage's `#RANK` taking over the judge windows from stitched `seconds` on. */
export interface NonstopStageRank {
  seconds: number;
  rank: number;
  table: NonstopStageRankTable;
}

/** `#RANK` when a chart has none, as LR2 and the engine read it (NORMAL). */
const DEFAULT_RANK = 2;

function stageWindow(placements: readonly NonstopStagePlacement[], index: number): { start: number; end: number } {
  return {
    start: index === 0 ? Number.NEGATIVE_INFINITY : placements[index - 1]!.boundarySeconds,
    end: index === placements.length - 1 ? Number.POSITIVE_INFINITY : placements[index]!.boundarySeconds,
  };
}

/**
 * The BPM readout timeline of a stitched NONSTOP chart, which itself runs at a constant 150 BPM: each stage's own BPM,
 * scaled by its FIT rate, as LR2 shows it (`LR2body.exe` 0x4b0690 inserts each later stage's `#BPM` as a BPM object at
 * its start, `val × freqSpeedMultiplier`, OpenLR2 `LR2f.cpp` L26257-L26273; the play loop's BPM object sets the readout,
 * L12717-L12724).
 *
 * - `'intended'` (default): each stage's BPM over its own window, from the previous boundary to its own.
 * - `'lr2'`: as LR2's event order gives it. A later stage's `#BPM` takes over at the stage's own time zero, which its cut
 *   moves before the previous boundary; a stage without `#BPM` keeps the previous BPM. A stage's BPM changes from its
 *   last-measure line on are dropped, except the last stage's (L26970-L26976).
 */
export function resolveNonstopTempo(
  stages: readonly NonstopStageReadoutInput[],
  placements: readonly NonstopStagePlacement[],
  options: NonstopPlanOptions = {},
): NonstopTempoPoint[] {
  const lr2 = options.placement === 'lr2';
  const points: NonstopTempoPoint[] = [];
  stages.forEach((stage, index) => {
    const placement = placements[index];
    if (placement === undefined) return;
    const stitched = stage.tempo.map((point) => ({
      seconds: placement.offsetSeconds + point.seconds / placement.rate,
      bpm: point.bpm * placement.rate,
    }));
    const window = stageWindow(placements, index);
    if (lr2) {
      const own = index > 0 && stage.headerBPM === undefined ? stitched.slice(1) : stitched;
      points.push(...own.filter((point) => point.seconds < window.end));
      return;
    }
    // The BPM the stage is at when its window opens, then its changes inside the window.
    const atStart = stitched.filter((point) => point.seconds <= window.start).at(-1);
    if (atStart !== undefined) points.push({ seconds: window.start, bpm: atStart.bpm });
    points.push(...stitched.filter((point) => point.seconds > window.start && point.seconds < window.end));
  });
  // Stable: on a tie the later stage's tempo comes last and shows.
  return points.sort((left, right) => left.seconds - right.seconds);
}

/** The BPM a NONSTOP readout shows at stitched `seconds` ({@link resolveNonstopTempo}); the first one before it. */
export function nonstopBPMAt(tempo: readonly NonstopTempoPoint[], seconds: number): number | undefined {
  let low = 0;
  let high = tempo.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (tempo[middle]!.seconds <= seconds) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return tempo[Math.max(0, found)]?.bpm;
}

/**
 * The judge rank changes of a stitched NONSTOP chart: the stitched chart opens with the first stage's `#RANK`, and LR2
 * switches to each later stage's `#RANK` during the play. Its loader inserts the `#RANK` of a later stage as an object
 * (op 1001) at the stage's start (OpenLR2 `LR2f.cpp` L26301-L26313), which the stage's cut then moves earlier with the
 * rest of the stage, and the play loop sets the judge windows when it reaches it (L12831-L12877, `LR2body.exe`
 * 0x42be2f, for both players).
 *
 * - `'lr2'`: as LR2 does it, including what looks like a bug: the change comes at the stage's own time zero, which can
 *   be well before the previous stage's last notes; a stage without `#RANK` keeps the rank in force; and the windows
 *   come from a table of their own, which differs from the one a chart opens with for VERY HARD (PGREAT ±12 / GREAT ±24 /
 *   GOOD ±60 ms instead of ±8 / ±24 / ±40) and HARD (±15 / ±30 / ±80 instead of ±15 / ±30 / ±60).
 * - `'intended'` (default): each stage is judged with its own `#RANK`, with the windows a chart opening with that
 *   `#RANK` gets, and a stage without `#RANK` is NORMAL, as it would be alone. The change comes halfway between the
 *   previous stage's last note and the stage's first one, so the previous stage's last notes keep their rank even when
 *   they lie past the boundary or are hit late; without notes on either side, at the boundary.
 */
export function resolveNonstopStageRanks(
  stages: readonly Pick<
    NonstopStageReadoutInput,
    'rank' | 'noteHeads' | 'sourceFormat' | 'bmsonJudgeRank' | 'exRank'
  >[],
  placements: readonly NonstopStagePlacement[],
  options: NonstopPlanOptions = {},
): NonstopStageRank[] {
  const lr2 = options.placement === 'lr2';
  const ranks: NonstopStageRank[] = [];
  for (let index = 1; index < stages.length && index < placements.length; index += 1) {
    const declared = stages[index]!.rank;
    const rank = declared !== undefined && Number.isFinite(declared) ? Math.trunc(declared) : undefined;
    if (lr2) {
      if (rank !== undefined) {
        ranks.push({ seconds: placements[index]!.offsetSeconds, rank, table: 'lr2-nonstop' });
      }
      continue;
    }
    const previousLast = stages[index - 1]!.noteHeads?.last;
    const first = stages[index]!.noteHeads?.first;
    const seconds =
      previousLast !== undefined && first !== undefined
        ? (previousLast + first) / 2
        : stageWindow(placements, index).start;
    const stage = stages[index]!;
    if (stage.sourceFormat === 'bmson') {
      ranks.push({
        seconds,
        rank: stage.bmsonJudgeRank !== undefined && stage.bmsonJudgeRank > 0 ? stage.bmsonJudgeRank : 100,
        table: 'bmson',
      });
    } else if (stage.exRank !== undefined) {
      ranks.push({ seconds, rank: stage.exRank, table: 'bms-exrank' });
    } else ranks.push({ seconds, rank: rank ?? DEFAULT_RANK, table: 'chart' });
  }
  return ranks.sort((left, right) => left.seconds - right.seconds);
}

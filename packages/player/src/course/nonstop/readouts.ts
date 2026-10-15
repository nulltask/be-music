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
  headerBpm?: number;
}

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
      const own = index > 0 && stage.headerBpm === undefined ? stitched.slice(1) : stitched;
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
export function nonstopBpmAt(tempo: readonly NonstopTempoPoint[], seconds: number): number | undefined {
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

import type { BeMusicSide } from '../../../skin/be-music/types.ts';

/** One run of edge-to-edge lanes a measure line crosses, labelled with its play side. */
export interface SideLaneRun {
  side: BeMusicSide;
  x: number;
  w: number;
}

/**
 * Groups lanes (by channel) that touch into runs, left to right, the way `resolveLaneRuns` does — one run in single
 * play and in 9-key, one per side in double play — and labels each run with the side of its leftmost lane (`2x`
 * channels are 2P, everything else 1P). A measure line drawn once per run never crosses the gap between the sides.
 */
export function resolveSideLaneRuns(lanes: Iterable<readonly [string, { x: number; w: number }]>): SideLaneRun[] {
  const sorted = [...lanes].sort((a, b) => a[1].x - b[1].x);
  const runs: SideLaneRun[] = [];
  for (const [channel, lane] of sorted) {
    const last = runs[runs.length - 1];
    if (last && lane.x <= last.x + last.w + 0.5) {
      last.w = Math.max(last.w, lane.x + lane.w - last.x);
    } else {
      runs.push({ side: channel.startsWith('2') ? '2P' : '1P', x: lane.x, w: lane.w });
    }
  }
  return runs;
}

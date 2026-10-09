import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { PLAYFIELD } from '../scene/gameplay-constants.ts';
import { resolveLr2LaneIndex, resolveSkinlessLaneLayout } from '../scene/gameplay-lanes.ts';
import { resolveBeMusicLaneKind } from '../skin/be-music/registry.ts';
import type { BeMusicGameplayLayout, BeMusicStage } from '../skin/be-music/types.ts';

/** What {@link resolveGameplayLayout} needs to know about the chart: its lane channels and play variant. */
export interface GameplayLayoutInput {
  laneChannels?: readonly string[];
  laneCount?: number;
  playVariant?: ChartPlayVariant;
}

/**
 * The gameplay layout the host hands to a skin's chrome every frame (`context.layout`), built from the chart's lanes and
 * the skin's stage. Hosts call it; skins normally just read `context.layout`, but can call it to build a layout for a
 * preview or a test frame.
 */
export function resolveGameplayLayout(input: GameplayLayoutInput, stage: BeMusicStage): BeMusicGameplayLayout {
  const channels = input.laneChannels;
  const variant = input.playVariant;
  const { lanes, left, right } = resolveSkinlessLaneLayout(channels, input.laneCount ?? channels?.length, variant);
  const sides: BeMusicGameplayLayout['playfield']['sides'] = {};
  const layoutLanes = lanes.map((lane, index) => {
    const bounds = sides[lane.side];
    sides[lane.side] = bounds
      ? { left: Math.min(bounds.left, lane.x), right: Math.max(bounds.right, lane.x + lane.w) }
      : { left: lane.x, right: lane.x + lane.w };
    const channel = lane.channel;
    return {
      channel,
      kind: channel
        ? resolveBeMusicLaneKind(channel, resolveLr2LaneIndex(channel, variant), variant)
        : index === 0
          ? ('scratch' as const)
          : ('white' as const),
      side: lane.side,
      x: lane.x,
      w: lane.w,
    };
  });
  const bga = stage.resolveBgaRect(right);
  return {
    stage: { width: stage.width, height: stage.height },
    lanes: layoutLanes,
    playfield: {
      left,
      right,
      centerX: (left + right) / 2,
      top: PLAYFIELD.y,
      judgementY: PLAYFIELD.judgementY,
      sides,
    },
    bga: bga.w > 0 && bga.h > 0 ? { ...bga } : undefined,
  };
}

/** A run of lanes that sit edge to edge (one play side in double play). */
export interface LaneRun {
  left: number;
  right: number;
}

/**
 * Groups lanes that touch into runs, left to right — one run in single play, one per side in IIDX double play, where
 * the 1P and 2P banks stand apart. Draw anything that spans the lanes (the judgement line, a frame) once per run so
 * it never crosses the gap between the sides.
 */
export function resolveLaneRuns(lanes: ReadonlyArray<{ x: number; w: number }>): LaneRun[] {
  const sorted = [...lanes].sort((a, b) => a.x - b.x);
  const runs: LaneRun[] = [];
  for (const lane of sorted) {
    const last = runs[runs.length - 1];
    if (last && lane.x <= last.right + 0.5) {
      last.right = Math.max(last.right, lane.x + lane.w);
    } else {
      runs.push({ left: lane.x, right: lane.x + lane.w });
    }
  }
  return runs;
}

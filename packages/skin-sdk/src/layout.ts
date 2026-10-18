import type { ChartPlayVariant } from '@be-music/chart';
import { resolveLr2LaneIndex } from '@be-music/player/lanes';
import { resolveBeMusicLaneKind } from './lane-geometry.ts';
import { resolveGameplayLaneGeometry } from './touch-layout.ts';
import type { BeMusicGameplayLayout, BeMusicStage, GameplayLayoutMode } from './types.ts';

/** What {@link resolveGameplayLayout} needs to know about the chart: its lane channels and play variant. */
export interface GameplayLayoutInput {
  laneChannels?: readonly string[];
  laneCount?: number;
  playVariant?: ChartPlayVariant;
  /**
   * `'touch'` asks for the touch layout (see {@link resolveGameplayLaneGeometry}); play modes it does not cover keep the
   * standard one. Defaults to `'standard'`.
   */
  layoutMode?: GameplayLayoutMode;
}

/**
 * The gameplay layout the host hands to a skin's chrome every frame (`context.layout`), built from the chart's lanes and
 * the skin's stage — a portrait stage (taller than wide) gets the portrait playfield. Hosts call it; skins normally just read `context.layout`, but can call it to build a layout for a
 * preview or a test frame.
 */
export function resolveGameplayLayout(input: GameplayLayoutInput, stage: BeMusicStage): BeMusicGameplayLayout {
  const channels = input.laneChannels;
  const variant = input.playVariant;
  const { mode, orientation, lanes, left, right, top, judgementY } = resolveGameplayLaneGeometry(
    channels,
    input.laneCount ?? channels?.length,
    variant,
    input.layoutMode,
    stage,
  );
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
  // The landscape touch layout gives the BGA's room to the lanes; a portrait stage keeps it above them.
  const bga = mode === 'touch' && orientation === 'landscape' ? undefined : stage.resolveBgaRect(right);
  return {
    mode,
    orientation,
    stage: { width: stage.width, height: stage.height },
    lanes: layoutLanes,
    playfield: {
      left,
      right,
      centerX: (left + right) / 2,
      top,
      judgementY,
      sides,
    },
    bga: bga && bga.w > 0 && bga.h > 0 ? { ...bga } : undefined,
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

/** The lane covers of the shared playfield: each side's SUDDEN / HIDDEN masks over its lanes. */

import { isChannelOnSide } from '../../../chart/lane-sides.ts';
import type { PlayfieldContext } from './context.ts';

/**
 * Draws the LR2 HIDDEN / SUDDEN / HID+SUD masks over the playfield: each side's {@link resolveLaneCovers} cover (the
 * `shutter` fraction at the top, the bottom or both ends, nothing while LANE COVER is off, or what a replay shows),
 * over the union of that side's lanes' top/bottom from `laneX`, so the mask exactly covers the lane area however the
 * theme laid the lanes out (single-side, DP, etc.).
 */
export function renderShutter(ctx: PlayfieldContext): void {
  ctx.shutterLayer.clear();
  // A be-music skin that draws its own covers reads them from `runtime.laneCovers` instead.
  if (ctx.skinBinding?.drawsLaneCover) return;
  if (ctx.laneX.size === 0) return;
  for (const cover of ctx.resolveLaneCovers()) {
    paintSideShutter(ctx, collectSideBounds(ctx, cover.side), cover.sudden, cover.hidden);
  }
}

function collectSideBounds(
  ctx: PlayfieldContext,
  side: '1P' | '2P',
):
  | {
      left: number;
      right: number;
      top: number;
      bottom: number;
    }
  | undefined {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const [channel, lane] of ctx.laneX) {
    const onSide = isChannelOnSide(channel, side);
    if (!onSide) continue;
    any = true;
    left = Math.min(left, lane.x);
    right = Math.max(right, lane.x + lane.w);
    top = Math.min(top, lane.top);
    bottom = Math.max(bottom, lane.bottom);
  }
  if (!any) return undefined;
  if (!Number.isFinite(left) || !Number.isFinite(right) || bottom - top <= 0) return undefined;
  return { left, right, top, bottom };
}

function paintSideShutter(
  ctx: PlayfieldContext,
  bounds: { left: number; right: number; top: number; bottom: number } | undefined,
  sudden: number,
  hidden: number,
): void {
  if (!bounds) return;
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  if (sudden > 0) {
    // SUDDEN — opaque rect at the TOP of the playfield. Notes emerge below it.
    ctx.shutterLayer.rect(bounds.left, bounds.top, width, height * sudden).fill({ color: 0x000000, alpha: 0.92 });
  }
  if (hidden > 0) {
    // HIDDEN — opaque rect at the BOTTOM of the playfield, just above the judge line (lanes' `bottom` is the judge
    // line bottom edge — the mask itself ends there).
    ctx.shutterLayer
      .rect(bounds.left, bounds.bottom - height * hidden, width, height * hidden)
      .fill({ color: 0x000000, alpha: 0.92 });
  }
}

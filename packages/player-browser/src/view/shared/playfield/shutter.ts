/** The lane covers of the shared playfield: each side's SUDDEN / HIDDEN masks over its lanes. */

import { isChannelOnSide } from '../../../chart/lane-sides.ts';
import type { BeMusicLaneCoverStyle } from '@be-music/player-skin-sdk';
import { resolveCoverStripes, type CoverRect } from './cover-pattern.ts';
import type { PlayfieldContext } from './context.ts';

/**
 * Draws the LR2 HIDDEN / SUDDEN / HID+SUD masks over the playfield, opaque and striped in the skin's
 * {@link BeMusicLaneCoverStyle}: each side's {@link resolveLaneCovers} cover (the
 * `shutter` fraction at the top, the bottom or both ends, nothing while LANE COVER is off, or what a replay shows),
 * over the union of that side's lanes' top/bottom from `laneX`, so the mask exactly covers the lane area however the
 * theme laid the lanes out (single-side, DP, etc.).
 */
export function renderShutter(ctx: PlayfieldContext): void {
  ctx.shutterLayer.clear();
  // A Be-Music Skin that draws its own covers reads them from `runtime.laneCovers` instead.
  if (ctx.skinBinding?.drawsLaneCover) return;
  if (ctx.play.laneX.size === 0) return;
  for (const cover of ctx.play.resolveLaneCovers()) {
    paintSideShutter(
      ctx,
      collectSideBounds(ctx, cover.side),
      cover.sudden,
      cover.hidden,
      ctx.drawsLift ? cover.lift : 0,
    );
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
  for (const [channel, lane] of ctx.play.laneX) {
    const onSide = isChannelOnSide(channel, side);
    if (!onSide) continue;
    any = true;
    left = Math.min(left, lane.x);
    right = Math.max(right, lane.x + lane.w);
    top = Math.min(top, lane.top);
    bottom = Math.max(bottom, lane.baseBottom ?? lane.bottom);
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
  lift: number,
): void {
  if (!bounds) return;
  const style = ctx.skinBinding?.laneCoverStyle ?? DEFAULT_LANE_COVER_STYLE;
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  // SUDDEN+ at the top of the lanes, its inner edge at its bottom; notes emerge below it.
  if (sudden > 0) paintCover(ctx, style, { x: bounds.left, y: bounds.top, w: width, h: height * sudden }, 'bottom');
  // LIFT at the bottom, its inner edge at its top: the raised judgement line.
  if (lift > 0)
    paintCover(ctx, style, { x: bounds.left, y: bounds.bottom - height * lift, w: width, h: height * lift }, 'top');
  // HIDDEN+ just above the LIFT (or the judgement line), its inner edge at its top.
  if (hidden > 0) {
    paintCover(
      ctx,
      style,
      { x: bounds.left, y: bounds.bottom - height * (lift + hidden), w: width, h: height * hidden },
      'top',
    );
  }
}

/** The covers of a skin that gives no {@link BeMusicLaneCoverStyle}: black with faint grey stripes. */
export const DEFAULT_LANE_COVER_STYLE: BeMusicLaneCoverStyle = {
  color: 0x000000,
  stripeColor: 0xffffff,
  stripeAlpha: 0.05,
};

/** One opaque cover over `rect`, striped from its `inner` edge (the one facing the notes). */
function paintCover(
  ctx: PlayfieldContext,
  style: BeMusicLaneCoverStyle,
  rect: CoverRect,
  inner: 'top' | 'bottom',
): void {
  const layer = ctx.shutterLayer;
  layer.rect(rect.x, rect.y, rect.w, rect.h).fill({ color: style.color, alpha: 1 });
  if (style.stripeAlpha > 0) {
    const anchorY = inner === 'top' ? rect.y : rect.y + rect.h;
    for (const stripe of resolveCoverStripes(rect, anchorY)) layer.poly(stripe);
    layer.fill({ color: style.stripeColor, alpha: style.stripeAlpha });
  }
  if (style.edgeColor !== undefined && rect.h >= 1) {
    const edgeY = inner === 'top' ? rect.y : rect.y + rect.h - 1;
    layer.rect(rect.x, edgeY, rect.w, 1).fill({ color: style.edgeColor, alpha: style.edgeAlpha ?? 1 });
  }
}

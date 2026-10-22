import { paintPlayfieldParts, resolvePlayfieldParts } from '@be-music/player-ui';
import type { BeMusicGameplayFrame, BeMusicSurface } from '@be-music/player-skin-sdk';

/**
 * The playfield on one stage-sized Canvas, for hosts without DOM gameplay screens. Hosts that mount the native screen
 * draw the same parts on `be-music-playfield`'s own canvases instead.
 */
export function drawPlayfield(
  { context: ctx, width, height }: BeMusicSurface<'2d'>,
  frame: BeMusicGameplayFrame,
): void {
  ctx.fillStyle = '#10151f';
  ctx.fillRect(0, 0, width, height);
  const bga = frame.layout.bga;
  if (bga && frame.runtime.hasBGA) ctx.clearRect(bga.x, bga.y, bga.w, bga.h);
  paintPlayfieldParts(ctx, resolvePlayfieldParts(frame));
}

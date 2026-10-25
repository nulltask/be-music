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
  ctx.fillStyle = '#171717';
  ctx.fillRect(0, 0, width, height);
  paintPlayfieldParts(ctx, resolvePlayfieldParts(frame));
}

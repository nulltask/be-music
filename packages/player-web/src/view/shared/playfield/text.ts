/** The text pass of the shared playfield: the view's late text layer and the pause overlay. */

import type { PlayfieldContext } from './context.ts';

export function renderText(ctx: PlayfieldContext, width: number, height: number, seconds: number): void {
  ctx.textLayerPool.begin();
  ctx.chrome.drawText?.(seconds);
  ctx.textLayerPool.end();
  ctx.overlay.visible = ctx.play.paused;
  ctx.overlay.text = 'Paused';
  ctx.overlay.anchor.set(0.5);
  ctx.overlay.position.set(width / 2, height / 2);
}

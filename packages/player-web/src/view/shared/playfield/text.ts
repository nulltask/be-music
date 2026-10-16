/** The text pass of the shared playfield: the theme's late text layer and the pause overlay. */

import type { PlayfieldContext } from './context.ts';

export function renderText(this: PlayfieldContext, width: number, height: number, seconds: number): void {
  this.textLayerPool.begin();
  this.theme.renderThemeText(seconds);
  this.textLayerPool.end();
  this.overlay.visible = this.paused;
  this.overlay.text = 'Paused';
  this.overlay.anchor.set(0.5);
  this.overlay.position.set(width / 2, height / 2);
}

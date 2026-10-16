/** The mines of the shared playfield: one mine with the skin's cell, the be-music skin, or a caution-striped bar. */

import { resolveBeMusicLaneKind } from '../../../skin/be-music/registry.ts';
import { drawCautionMine } from '../../../skins/pixi-kit/mine.ts';
import type { PlayfieldLaneRect } from '../../types.ts';
import type { PlayfieldContext } from './context.ts';

/**
 * Renders one landmine sprite. Tries the skin's mine cell first (e.g. the LR2 skin's `#SRC_NOTE` `mine` slot,
 * animated per its `divX/divY/cycle`), then hands it to a be-music skin that draws mines itself; otherwise falls back
 * to the caution-striped bar ({@link drawCautionMine}) so the hazard still reads distinctly from playable notes.
 */
export function renderMineNote(
  ctx: PlayfieldContext,
  laneIndex: number,
  channel: string,
  lane: PlayfieldLaneRect,
  y: number,
): void {
  const cell = ctx.playfieldSkin.noteCell('mine', channel);
  if (cell?.texture) {
    const sprite = ctx.noteLayerPool.acquireSprite();
    sprite.texture = cell.texture;
    sprite.label = `mine[lane=${laneIndex},ch=${channel}]`;
    sprite.x = lane.x + (lane.w - cell.width) / 2;
    sprite.y = y - cell.height;
    sprite.width = cell.width;
    sprite.height = cell.height;
    return;
  }
  const binding = ctx.skinBinding;
  if (binding?.drawsMines) {
    binding.addMine({
      kind: resolveBeMusicLaneKind(channel, laneIndex, ctx.play.chartPlayVariant),
      x: lane.x,
      w: lane.w,
      y,
    });
    return;
  }
  const graphic = ctx.noteLayerPool.acquireGraphics();
  graphic.label = `mine-fallback[lane=${laneIndex},ch=${channel}]`;
  drawCautionMine(graphic, lane.x, lane.w, y);
}

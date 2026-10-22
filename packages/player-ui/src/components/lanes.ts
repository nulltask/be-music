import { BeMusicPlayfieldCanvasElement } from '../playfield/canvas-element.ts';
import { paintLanes, type BeMusicPlayfieldPaintContext } from '../playfield/paint.ts';
import type { BeMusicLanesData } from '../models.ts';

/** Lane backgrounds, key beams and held long-note markers on a canvas over the lanes. */
export class BeMusicLanesElement extends BeMusicPlayfieldCanvasElement<BeMusicLanesData> {
  protected override paint(context: BeMusicPlayfieldPaintContext, data: BeMusicLanesData): void {
    paintLanes(context, data);
  }
}

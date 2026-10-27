import { BeMusicPlayfieldCanvasElement } from '../playfield/canvas-element.ts';
import { paintLaneCovers, type BeMusicPlayfieldPaintContext } from '../playfield/paint.ts';
import type { BeMusicLaneCoversData } from '../models.ts';

/** SUDDEN+ and HIDDEN+ covers on a canvas over the lanes. */
export class BeMusicLaneCoversElement extends BeMusicPlayfieldCanvasElement<BeMusicLaneCoversData> {
  protected override paint(context: BeMusicPlayfieldPaintContext, data: BeMusicLaneCoversData): void {
    paintLaneCovers(context, data);
  }
}

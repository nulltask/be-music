import { BeMusicPlayfieldCanvasElement } from '../playfield/canvas-element.ts';
import { paintBGA, type BeMusicPlayfieldPaintContext } from '../playfield/paint.ts';
import type { BeMusicBGAData } from '../models.ts';

/** The BGA on a canvas over the BGA rect. */
export class BeMusicBGAElement extends BeMusicPlayfieldCanvasElement<BeMusicBGAData> {
  protected override paint(context: BeMusicPlayfieldPaintContext, data: BeMusicBGAData): void {
    if (this.rect) paintBGA(context, data, this.rect);
  }
}

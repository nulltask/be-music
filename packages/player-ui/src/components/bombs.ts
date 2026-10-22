import { BeMusicPlayfieldCanvasElement } from '../playfield/canvas-element.ts';
import { paintBombs, type BeMusicPlayfieldPaintContext } from '../playfield/paint.ts';
import type { BeMusicBombsData } from '../models.ts';

/** Hit effects on a canvas around the judge line. */
export class BeMusicBombsElement extends BeMusicPlayfieldCanvasElement<BeMusicBombsData> {
  protected override paint(context: BeMusicPlayfieldPaintContext, data: BeMusicBombsData): void {
    paintBombs(context, data);
  }
}

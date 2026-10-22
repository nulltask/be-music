import { BeMusicPlayfieldCanvasElement } from '../playfield/canvas-element.ts';
import { paintNotes, type BeMusicPlayfieldPaintContext } from '../playfield/paint.ts';
import type { BeMusicNotesData } from '../models.ts';

/** Tap notes, long notes, mines and measure lines on a canvas from the lanes' top to the stage's bottom edge. */
export class BeMusicNotesElement extends BeMusicPlayfieldCanvasElement<BeMusicNotesData> {
  protected override paint(context: BeMusicPlayfieldPaintContext, data: BeMusicNotesData): void {
    paintNotes(context, data);
  }
}

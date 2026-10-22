import { BeMusicPlayfieldCanvasElement } from '../playfield/canvas-element.ts';
import { paintJudgmentDisplay, type BeMusicPlayfieldPaintContext } from '../playfield/paint.ts';
import type { BeMusicJudgmentDisplayData } from '../models.ts';

/** The latest judgment word of each side on a canvas above the judge line. */
export class BeMusicJudgmentDisplayElement extends BeMusicPlayfieldCanvasElement<BeMusicJudgmentDisplayData> {
  protected override paint(context: BeMusicPlayfieldPaintContext, data: BeMusicJudgmentDisplayData): void {
    paintJudgmentDisplay(context, data);
  }
}

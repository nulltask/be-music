import { BeMusicPlayfieldCanvasElement } from '../playfield/canvas-element.ts';
import { paintJudgeLine, type BeMusicPlayfieldPaintContext } from '../playfield/paint.ts';
import type { BeMusicJudgeLineData } from '../models.ts';

/** The judge line on a canvas the height of the line. */
export class BeMusicJudgeLineElement extends BeMusicPlayfieldCanvasElement<BeMusicJudgeLineData> {
  protected override paint(context: BeMusicPlayfieldPaintContext, data: BeMusicJudgeLineData): void {
    paintJudgeLine(context, data);
  }
}

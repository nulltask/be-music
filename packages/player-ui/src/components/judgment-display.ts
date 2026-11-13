import type { PropertyDeclarations } from 'lit';
import { BeMusicPlayfieldCanvasElement } from '../playfield/canvas-element.ts';
import { paintJudgmentDisplay, type BeMusicPlayfieldPaintContext } from '../playfield/paint.ts';
import type { BeMusicJudgmentDisplayData } from '../models.ts';
import { sameJudgmentDisplay } from '../playfield/judgment-display-data.ts';

/**
 * The latest judgment word of each side, and its combo, on a canvas above the judge line. The player hands it a fresh
 * object every frame; it repaints only when the words change.
 */
export class BeMusicJudgmentDisplayElement extends BeMusicPlayfieldCanvasElement<BeMusicJudgmentDisplayData> {
  static override properties: PropertyDeclarations = {
    ...BeMusicPlayfieldCanvasElement.properties,
    data: {
      attribute: false,
      hasChanged: (value: BeMusicJudgmentDisplayData | undefined, old: BeMusicJudgmentDisplayData | undefined) =>
        !sameJudgmentDisplay(value, old),
    },
  };

  protected override paint(context: BeMusicPlayfieldPaintContext, data: BeMusicJudgmentDisplayData): void {
    paintJudgmentDisplay(context, data);
  }
}

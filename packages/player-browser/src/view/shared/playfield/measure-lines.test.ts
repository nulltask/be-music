import { describe, expect, it } from 'vite-plus/test';
import { renderMeasureLines } from './measure-lines.ts';
import type { PlayfieldContext } from './context.ts';
import { resolveNoteDrawWindow } from '../../../chart/note-draw-window.ts';

describe('skin measure-line alignment', () => {
  it('uses the same beat origin as notes and applies the authored top-edge offset', () => {
    const sprites: Array<{ position: { set(x: number, y: number): void }; width?: number; height?: number }> = [];
    const positions: number[][] = [];
    const context = {
      play: {
        chart: { id: 'chart' },
        laneChannels: ['11'],
        laneX: new Map([['11', { x: 75, w: 54, top: 0, bottom: 725 }]]),
      },
      measureBeatCache: { chartId: 'chart', beats: [4] },
      playfieldSkin: { measureLines: () => [{ cell: { texture: {} }, x: 75, width: 432, height: 3, yOffset: -3 }] },
      noteLayerPool: {
        acquireSprite() {
          const sprite = {
            position: {
              set(x: number, y: number) {
                positions.push([x, y]);
              },
            },
          };
          sprites.push(sprite);
          return sprite;
        },
      },
    } as unknown as PlayfieldContext;
    const window = resolveNoteDrawWindow({
      rules: 'lr2',
      nowSeconds: 0,
      currentBeat: 2,
      laneBeats: 10,
      overscanBeats: 0,
    });
    renderMeasureLines(context, window, 100);
    expect(positions).toEqual([[75, 522]]);
    expect(sprites[0]?.height).toBe(3);
  });
});

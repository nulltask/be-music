import { describe, expect, it } from 'vite-plus/test';
import { renderMeasureLines } from './measure-lines.ts';
import type { PlayfieldContext } from './context.ts';
import { resolveNoteDrawWindow } from '../../../chart/note-draw-window.ts';

describe('skin measure-line alignment', () => {
  it("uses each side's LIFT scroll scale for measure lines just like notes", () => {
    const lines: unknown[] = [];
    const context = {
      play: {
        chart: { id: 'chart' },
        playState: { view: { hiSpeed: { locked: false } } },
        laneChannels: ['11', '21'],
        laneX: new Map([
          ['11', { x: 10, w: 40, top: 0, bottom: 300, baseBottom: 400, scrollScale: 0.75 }],
          ['21', { x: 100, w: 40, top: 0, bottom: 200, baseBottom: 400, scrollScale: 0.5 }],
        ]),
      },
      measureBeatCache: { chartId: 'chart', beats: [4] },
      playfieldSkin: { measureLines: () => undefined },
      skinBinding: { drawsMeasureLines: true, addMeasureLine: (line: unknown) => lines.push(line) },
    } as unknown as PlayfieldContext;
    renderMeasureLines(
      context,
      resolveNoteDrawWindow({ rules: 'lr2', nowSeconds: 0, currentBeat: 2, laneBeats: 4, overscanBeats: 0 }),
      100,
    );
    expect(lines).toEqual([
      { side: '1P', x: 10, w: 40, y: 150 },
      { side: '2P', x: 100, w: 40, y: 100 },
    ]);
  });

  it('uses the same beat origin as notes and applies the authored top-edge offset', () => {
    const sprites: Array<{ position: { set(x: number, y: number): void }; width?: number; height?: number }> = [];
    const positions: number[][] = [];
    const context = {
      play: {
        chart: { id: 'chart' },
        playState: { view: { hiSpeed: { locked: false } } },
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

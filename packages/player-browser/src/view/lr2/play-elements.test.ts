import { describe, expect, it } from 'vite-plus/test';
import { Texture } from 'pixi.js';
import { loadLR2SkinFromSourceFiles } from '@be-music/skin-lr2';
import { resolveLR2MeasureLines, type LR2PlayElementsContext } from './play-elements.ts';

function context(op = 0): LR2PlayElementsContext {
  const csv = [
    '#IMAGE,sheet.png',
    '#SRC_NOTE,0,0,0,0,1,1,1,1,0,0',
    '#DST_NOTE,0,0,75,722,90,3,0,255,255,255,255',
    '#SRC_LINE,0,0,0,0,1,1,1,1,0,0',
    `#DST_LINE,0,0,75,722,432,3,0,255,255,255,255,1,0,0,0,0,0,${op}`,
  ].join('\n');
  const skin = loadLR2SkinFromSourceFiles(new Map([['skin/main.csv', new TextEncoder().encode(csv)]]))!;
  return {
    skin,
    textures: new Map([['sheet.png', Texture.WHITE]]),
    timers: { isActive: () => true, elapsed: () => 0 },
    lr2State: { ops: new Set<number>() },
  } as unknown as LR2PlayElementsContext;
}

describe('LR2 measure-line geometry', () => {
  it('preserves the authored offset from the note timing origin in HD skins', () => {
    expect(resolveLR2MeasureLines(context())?.[0]).toMatchObject({ x: 75, width: 432, height: 3, yOffset: -3 });
  });
  it('does not draw a line whose destination condition is inactive', () => {
    expect(resolveLR2MeasureLines(context(162))).toEqual([]);
  });
});

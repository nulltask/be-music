import type { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vite-plus/test';
import { filament } from './result.ts';

/** Records the strokes a `Graphics` receives, with the polyline each one paints. */
function recorder(): { graphics: Graphics; strokes: { path: number[]; style: Record<string, unknown> }[] } {
  const strokes: { path: number[]; style: Record<string, unknown> }[] = [];
  let path: number[] = [];
  const graphics = {
    rect: () => graphics,
    circle: () => graphics,
    fill: () => graphics,
    poly(points: number[]) {
      path = [...points];
      return graphics;
    },
    stroke(style: Record<string, unknown>) {
      strokes.push({ path, style });
      return graphics;
    },
  } as unknown as Graphics;
  return { graphics, strokes };
}

describe('filament', () => {
  it('strokes the bloom and the line with round joins, so a sharp drop and recovery draws no spike', () => {
    const { graphics, strokes } = recorder();
    const points = [
      { x: 0, y: 0.5 },
      { x: 0.5, y: 0.9 },
      { x: 0.51, y: 0.4 },
      { x: 0.52, y: 0.9 },
      { x: 1, y: 0.9 },
    ];
    filament(graphics, 10, 20, 100, 50, points, 0xffaa33, 1);
    expect(strokes.map((stroke) => stroke.style)).toEqual([
      { color: 0xffaa33, width: 5, alpha: 0.12, join: 'round' },
      { color: 0xffaa33, width: 1.5, alpha: 0.95, join: 'round' },
    ]);
    expect(strokes[0]!.path).toEqual([10, 45, 60, 25, 61, 50, 62, 25, 110, 25]);
  });

  it('stops the line at `progress` of its span', () => {
    const { graphics, strokes } = recorder();
    filament(
      graphics,
      0,
      0,
      100,
      100,
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      0xffffff,
      0.5,
    );
    expect(strokes[0]!.path).toEqual([0, 100, 50, 50]);
  });
});

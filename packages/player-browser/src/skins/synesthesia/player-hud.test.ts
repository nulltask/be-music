import { describe, expect, it } from 'vite-plus/test';
import type { Graphics } from 'pixi.js';
import { drawGaugeCells } from './player-hud.ts';

describe('drawGaugeCells', () => {
  it.each([10, 12, 14])('keeps the clear marker inside a %i-pixel gauge', (barH) => {
    const rectangles: number[][] = [];
    const graphics = {
      rect(...coordinates: number[]) {
        rectangles.push(coordinates);
        return this;
      },
      fill() {
        return this;
      },
    };
    const groove = { x: 20, y: 100, w: 200, h: 14 };
    drawGaugeCells(graphics as unknown as Graphics, { gauge: 53, clearThreshold: 80 }, groove, barH);
    const marker = rectangles.at(-1)!;
    expect(marker[1]).toBe(groove.y + (groove.h - barH) / 2);
    expect(marker[3]).toBe(barH);
    expect(marker[1]! + marker[3]!).toBeLessThanOrEqual(groove.y + groove.h);
  });
});

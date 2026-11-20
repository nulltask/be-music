import { expect, test } from 'vite-plus/test';
import { BeMusicPlayfieldCanvasElement } from './canvas-element.ts';

test('redraws for a moved, resized or removed rectangle and skips an equivalent frame rectangle', () => {
  const changed = BeMusicPlayfieldCanvasElement.properties.rect!.hasChanged!;
  const rect = { x: 2, y: 4, w: 320, h: 240 };
  expect(changed({ ...rect }, rect)).toBe(false);
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    expect(changed({ ...rect, [key]: rect[key] + 1 }, rect)).toBe(true);
  }
  expect(changed(undefined, rect)).toBe(true);
  expect(changed(rect, undefined)).toBe(true);
});

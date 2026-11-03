import { describe, expect, test } from 'vite-plus/test';
import { keyboardKey, keyboardLayout } from './keyboard-layout.ts';

describe('keyboardLayout', () => {
  test('places each key once, inside the board, with no two keys overlapping', () => {
    for (const numpad of [false, true]) {
      const { keys, width, height } = keyboardLayout({ numpad });
      expect(new Set(keys.map((key) => key.code)).size).toBe(keys.length);
      for (const key of keys) {
        expect(key.x).toBeGreaterThanOrEqual(0);
        expect(key.y).toBeGreaterThanOrEqual(0);
        expect(key.x + key.width).toBeLessThanOrEqual(width);
        expect(key.y + key.height).toBeLessThanOrEqual(height);
      }
      for (const [index, a] of keys.entries()) {
        for (const b of keys.slice(index + 1)) {
          const overlaps = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
          expect(overlaps, `${a.code} / ${b.code}`).toBe(false);
        }
      }
    }
  });

  test('lines the main block’s rows up to the same width, and draws the number pad only when asked', () => {
    const { keys } = keyboardLayout();
    const rowEnds = new Map<number, number>();
    for (const key of keys.filter((key) => key.x < 15 && key.y > 1)) {
      rowEnds.set(key.y, Math.max(rowEnds.get(key.y) ?? 0, key.x + key.width));
    }
    expect([...rowEnds.values()]).toEqual([15, 15, 15, 15, 15]);
    expect(keys.some((key) => key.code.startsWith('Numpad'))).toBe(false);
    expect(keyboardLayout({ numpad: true }).keys.some((key) => key.code === 'Numpad0')).toBe(true);
  });

  test('names a key apart from its cap where the two sides share one', () => {
    expect(keyboardKey('ShiftLeft')).toMatchObject({ label: 'Shift', name: 'Left Shift' });
    expect(keyboardKey('Numpad0')).toMatchObject({ label: '0', name: 'Num 0', width: 2 });
    expect(keyboardKey('NumpadEnter')).toMatchObject({ height: 2 });
    expect(keyboardKey('KeyZ')).toMatchObject({ label: 'Z', name: 'Z' });
    expect(keyboardKey('Unidentified')).toBeUndefined();
  });
});

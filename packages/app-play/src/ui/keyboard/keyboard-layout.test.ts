import { describe, expect, test } from 'vite-plus/test';
import {
  guessKeyboard,
  KEYBOARD_CODES,
  KEYBOARD_FORMS,
  KEYBOARD_PLATFORMS,
  keyboardKey,
  keyboardLayout,
} from './keyboard-layout.ts';

const EVERY_LAYOUT = KEYBOARD_PLATFORMS.flatMap((platform) =>
  KEYBOARD_FORMS.flatMap((form) => [false, true].map((numpad) => ({ platform, form, numpad }))),
);

describe('keyboardLayout', () => {
  test('places each key once, inside the board, with no two keys overlapping', () => {
    for (const options of EVERY_LAYOUT) {
      const { keys, width, height } = keyboardLayout(options);
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
    for (const options of EVERY_LAYOUT) {
      const { keys } = keyboardLayout(options);
      const rowEnds = new Map<number, number>();
      for (const key of keys.filter((key) => key.x < 15 && key.y > 0 && key.height === 1)) {
        rowEnds.set(key.y, Math.max(rowEnds.get(key.y) ?? 0, key.x + key.width));
      }
      expect([...rowEnds.values()], JSON.stringify(options)).toEqual([15, 15, 15, 15, 15]);
    }
    const { keys } = keyboardLayout();
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

  test('draws a Mac’s caps and modifier order, keeping the codes', () => {
    const mac = keyboardLayout({ platform: 'mac' });
    const bottom = mac.keys.filter((key) => key.y === 5.25 && key.x < 15).map((key) => key.code);
    expect(bottom).toEqual(['ControlLeft', 'AltLeft', 'MetaLeft', 'Space', 'MetaRight', 'AltRight']);
    expect(keyboardKey('MetaLeft', 'mac')).toMatchObject({ label: '⌘', name: 'Left Command' });
    expect(keyboardKey('Enter', 'mac')).toMatchObject({ label: 'return', name: 'Return' });
    expect(keyboardKey('Backspace', 'mac')?.name).toBe('Delete');
    expect(keyboardKey('MetaLeft')).toMatchObject({ label: 'Win', name: 'Left Windows' });
    // A Mac has no Pause key; its name falls back to a Windows PC's.
    expect(mac.keys.some((key) => key.code === 'Pause')).toBe(false);
    expect(keyboardKey('Pause', 'mac')?.name).toBe('Pause');
    expect(keyboardLayout({ platform: 'mac', numpad: true }).keys.some((key) => key.code === 'NumpadEqual')).toBe(true);
  });

  test('tucks a laptop’s arrows into its bottom row, with no navigation cluster or number pad', () => {
    for (const platform of KEYBOARD_PLATFORMS) {
      const laptop = keyboardLayout({ platform, form: 'laptop', numpad: true });
      expect(laptop).toMatchObject({ width: 15, height: 6 });
      expect(laptop.keys.some((key) => key.code === 'Home' || key.code.startsWith('Numpad'))).toBe(false);
      const up = laptop.keys.find((key) => key.code === 'ArrowUp');
      const down = laptop.keys.find((key) => key.code === 'ArrowDown');
      expect(up).toMatchObject({ x: 13, y: 5, height: 0.5 });
      expect(down).toMatchObject({ x: 13, y: 5.5, height: 0.5 });
    }
    expect(KEYBOARD_CODES).toEqual(expect.arrayContaining(['Fn', 'F13', 'NumpadEqual', 'Pause']));
  });
});

describe('guessKeyboard', () => {
  test('takes macOS for a Mac laptop, anything else for a full Windows keyboard', () => {
    expect(guessKeyboard('macOS')).toEqual({ platform: 'mac', form: 'laptop' });
    expect(guessKeyboard('MacIntel')).toEqual({ platform: 'mac', form: 'laptop' });
    expect(guessKeyboard('Android')).toEqual({ platform: 'windows', form: 'full' });
    expect(guessKeyboard('Win32')).toEqual({ platform: 'windows', form: 'full' });
    expect(guessKeyboard('Linux x86_64')).toEqual({ platform: 'windows', form: 'full' });
    expect(guessKeyboard(undefined)).toEqual({ platform: 'windows', form: 'full' });
  });
});

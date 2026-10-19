import { describe, expect, test } from 'vite-plus/test';
import {
  ANSI_RESET,
  blendRgb,
  centerVisible,
  clampColorByte,
  colorizeText,
  dimRgb,
  findAnsiSgrSequenceEnd,
  getCharacterDisplayWidth,
  isSameRgb,
  padVisibleWidth,
  visibleWidth,
} from './ansi-text.ts';

describe('visibleWidth', () => {
  test('counts terminal cells and skips SGR sequences', () => {
    expect(visibleWidth('abc')).toBe(3);
    expect(visibleWidth('\u001b[31mab\u001b[0m')).toBe(2);
    expect(visibleWidth('あい')).toBe(4);
    expect(visibleWidth('é')).toBe(1);
  });

  test('counts an unterminated escape as visible text', () => {
    expect(visibleWidth('\u001b[31')).toBe(4);
  });
});

describe('getCharacterDisplayWidth', () => {
  test('is 0 for combining marks, 2 for wide characters and 1 otherwise', () => {
    expect(getCharacterDisplayWidth(0x41)).toBe(1);
    expect(getCharacterDisplayWidth(0x0301)).toBe(0);
    expect(getCharacterDisplayWidth(0x3042)).toBe(2);
    expect(getCharacterDisplayWidth(0x1f600)).toBe(2);
  });
});

describe('findAnsiSgrSequenceEnd', () => {
  test('finds the closing m of an SGR sequence', () => {
    expect(findAnsiSgrSequenceEnd('\u001b[38;2;1mX', 2)).toBe(8);
  });

  test('is -1 for another command or an unterminated sequence', () => {
    expect(findAnsiSgrSequenceEnd('\u001b[3Kx', 2)).toBe(-1);
    expect(findAnsiSgrSequenceEnd('\u001b[31', 2)).toBe(-1);
  });
});

describe('padVisibleWidth', () => {
  test('pads to the width after closing the styles', () => {
    expect(padVisibleWidth('ab', 4)).toBe(`ab${ANSI_RESET}  `);
  });

  test('truncates a longer line to the width', () => {
    expect(padVisibleWidth('abcdef', 3)).toBe(`abc${ANSI_RESET}`);
  });
});

describe('centerVisible', () => {
  test('centers the text, with the odd cell on the right', () => {
    expect(centerVisible('ab', 6)).toBe('  ab  ');
    expect(centerVisible('abc', 6)).toBe(' abc  ');
  });

  test('truncates text wider than the width', () => {
    expect(centerVisible('abcdef', 4)).toBe(`abcd${ANSI_RESET}`);
  });
});

describe('colorizeText', () => {
  test('wraps the text in a truecolor SGR sequence', () => {
    expect(colorizeText('x', { r: 1, g: 2, b: 3 })).toBe(`\u001b[38;2;1;2;3mx${ANSI_RESET}`);
    expect(colorizeText('x', { r: 1, g: 2, b: 3 }, { r: 4, g: 5, b: 6 }, true)).toBe(
      `\u001b[38;2;1;2;3;48;2;4;5;6;4mx${ANSI_RESET}`,
    );
  });
});

describe('colour helpers', () => {
  test('dimRgb scales each channel by a factor clamped to 0..1', () => {
    expect(dimRgb({ r: 200, g: 100, b: 51 }, 0.5)).toEqual({ r: 100, g: 50, b: 25 });
    expect(dimRgb({ r: 200, g: 100, b: 51 }, 2)).toEqual({ r: 200, g: 100, b: 51 });
  });

  test('blendRgb mixes two colours by a ratio clamped to 0..1', () => {
    expect(blendRgb({ r: 0, g: 0, b: 0 }, { r: 100, g: 200, b: 255 }, 0.5)).toEqual({ r: 50, g: 100, b: 127 });
    expect(blendRgb({ r: 10, g: 20, b: 30 }, { r: 100, g: 200, b: 255 }, -1)).toEqual({ r: 10, g: 20, b: 30 });
  });

  test('clampColorByte truncates into 0..255 and maps a missing value to 0', () => {
    expect(clampColorByte(12.9)).toBe(12);
    expect(clampColorByte(300)).toBe(255);
    expect(clampColorByte(-5)).toBe(0);
    expect(clampColorByte(Number.NaN)).toBe(0);
    expect(clampColorByte(undefined)).toBe(0);
  });

  test('isSameRgb compares by channel', () => {
    expect(isSameRgb(undefined, undefined)).toBe(true);
    expect(isSameRgb({ r: 1, g: 2, b: 3 }, { r: 1, g: 2, b: 3 })).toBe(true);
    expect(isSameRgb({ r: 1, g: 2, b: 3 }, { r: 1, g: 2, b: 4 })).toBe(false);
    expect(isSameRgb({ r: 1, g: 2, b: 3 }, undefined)).toBe(false);
  });
});

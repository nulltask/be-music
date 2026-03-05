import { describe, expect, test } from 'vitest';
import { resolveAltModifierLabel } from './player-utils.ts';

describe('player utils', () => {
  test('player-utils: uses Option label on macOS', () => {
    expect(resolveAltModifierLabel('darwin')).toBe('Option');
  });

  test('player-utils: uses Alt label on non-macOS platforms', () => {
    expect(resolveAltModifierLabel('win32')).toBe('Alt');
    expect(resolveAltModifierLabel('linux')).toBe('Alt');
  });
});

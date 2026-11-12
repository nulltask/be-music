import { describe, expect, test } from 'vite-plus/test';
import { DEFAULT_BPM_CHANGE_WARNING_STYLE } from '../shared/bpm-change-warning.ts';
import { resolveBuiltInBPMChangeWarningStyle } from './bpm-change-warning-style.ts';

describe('built-in BPM-change warning styles', () => {
  test("draws the warning in each built-in skin's own type and colours", () => {
    expect(resolveBuiltInBPMChangeWarningStyle('plain')).toMatchObject({
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      rising: 0x3d7bff,
      falling: 0xff4d5e,
      background: 0x1c1c21,
    });
    expect(resolveBuiltInBPMChangeWarningStyle('synesthesia')).toMatchObject({
      fontFamily: 'Orbitron, M PLUS 1p, sans-serif',
      rising: 0x46c4ff,
      falling: 0xff3d9e,
      radius: 0,
    });
    expect(resolveBuiltInBPMChangeWarningStyle('native').fontFamily).toBe('ui-sans-serif, system-ui, sans-serif');
  });

  test('keeps blue for a rising tempo and red for a falling one on every skin', () => {
    for (const id of ['plain', 'native', 'synesthesia']) {
      const { rising, falling } = resolveBuiltInBPMChangeWarningStyle(id);
      expect((rising & 0xff) > rising >> 16, id).toBe(true);
      expect(falling >> 16 > (falling & 0xff), id).toBe(true);
    }
  });

  test('falls back to the default box on a skin without a style, whatever its id', () => {
    expect(resolveBuiltInBPMChangeWarningStyle('third-party')).toBe(DEFAULT_BPM_CHANGE_WARNING_STYLE);
    expect(resolveBuiltInBPMChangeWarningStyle('toString')).toBe(DEFAULT_BPM_CHANGE_WARNING_STYLE);
  });
});

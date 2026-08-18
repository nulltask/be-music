import { describe, expect, it } from 'vitest';
import { formatDefaultDifficultyLabel } from './decide-render.ts';

describe('formatDefaultDifficultyLabel', () => {
  it('maps BMS difficulty indexes to generic labels', () => {
    expect(formatDefaultDifficultyLabel(undefined, undefined)).toBe('READY');
    expect(formatDefaultDifficultyLabel(1, 3)).toBe('BEGINNER  Lv 3');
    expect(formatDefaultDifficultyLabel(3, '12')).toBe('HYPER  Lv 12');
    expect(formatDefaultDifficultyLabel(5, undefined)).toBe('INSANE');
  });
});

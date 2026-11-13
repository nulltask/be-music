import { DEFAULT_RANDOM_MIX_CONDITIONS } from '@be-music/player-engine/course';
import { describe, expect, test } from 'vite-plus/test';
import { resolveRandomMixDialogConditions, toggleRandomMixValue } from './random-mix-dialog.ts';

describe('RANDOM MIX dialog', () => {
  test('toggles a value in a sorted set', () => {
    expect(toggleRandomMixValue([7], 14, true)).toEqual([7, 14]);
    expect(toggleRandomMixValue([5, 7], 5, true)).toEqual([5, 7]);
    expect(toggleRandomMixValue([5, 7], 5, false)).toEqual([7]);
  });

  test('opens on one key mode the library has, and a NONSTOP count as counted', () => {
    const initial = { ...DEFAULT_RANDOM_MIX_CONDITIONS, keyMode: 14, count: 'infinity' as const };
    expect(resolveRandomMixDialogConditions({ kind: 'expert', keyModes: [7, 14], initial })).toMatchObject({
      keyMode: 14,
      count: 'infinity',
    });
    // A key mode the library lacks: 7 keys when it has them, else its lowest.
    expect(resolveRandomMixDialogConditions({ kind: 'expert', keyModes: [5, 7], initial }).keyMode).toBe(7);
    expect(resolveRandomMixDialogConditions({ kind: 'nonstop', keyModes: [5, 10], initial })).toMatchObject({
      keyMode: 5,
      count: 5,
    });
    // A NONSTOP count is not capped at five, as an EXPERT one is not.
    expect(
      resolveRandomMixDialogConditions({ kind: 'nonstop', keyModes: [7], initial: { ...initial, count: 40 } }).count,
    ).toBe(40);
    // An empty library keeps what was asked.
    expect(resolveRandomMixDialogConditions({ kind: 'expert', keyModes: [], initial }).keyMode).toBe(14);
  });
});

import { DEFAULT_RANDOM_MIX_CONDITIONS } from '@be-music/player-engine/course';
import { describe, expect, test } from 'vite-plus/test';
import { resolveRandomMixDialogConditions, toggleRandomMixValue } from './random-mix-dialog.ts';

describe('RANDOM MIX dialog', () => {
  test('toggles a value in a sorted set', () => {
    expect(toggleRandomMixValue([7], 14, true)).toEqual([7, 14]);
    expect(toggleRandomMixValue([5, 7], 5, true)).toEqual([5, 7]);
    expect(toggleRandomMixValue([5, 7], 5, false)).toEqual([7]);
  });

  test('opens on the library key modes and caps a NONSTOP count', () => {
    const initial = { ...DEFAULT_RANDOM_MIX_CONDITIONS, keyModes: [7, 9], count: 'infinity' as const };
    expect(resolveRandomMixDialogConditions({ kind: 'expert', keyModes: [7, 14], initial })).toMatchObject({
      keyModes: [7],
      count: 'infinity',
    });
    // No key mode the library has: all of them.
    expect(resolveRandomMixDialogConditions({ kind: 'nonstop', keyModes: [5, 10], initial })).toMatchObject({
      keyModes: [5, 10],
      count: 5,
    });
  });
});

import { DEFAULT_LR2_RANDOM_MIX_SETTINGS, DEFAULT_RANDOM_MIX_CONDITIONS } from '@be-music/player-engine/course';
import { describe, expect, test } from 'vite-plus/test';
import { describeRandomMixSetup } from './random-mix-save-dialog.ts';

describe('describeRandomMixSetup', () => {
  test('lists an EXPERT run by level, its count and the draw settings, in the RANDOM MIX dialog order', () => {
    const rows = describeRandomMixSetup({
      kind: 'expert',
      conditions: { ...DEFAULT_RANDOM_MIX_CONDITIONS, minLevel: 3, maxLevel: 0, count: 'infinity' },
      settings: { ...DEFAULT_LR2_RANDOM_MIX_SETTINGS, preferredLevel: 0, bpmRange: 20, maxBPM: 0, minBPM: 120 },
      defaultConnection: 'cut',
    });
    expect(rows).toEqual([
      { label: 'Course', value: 'EXPERT' },
      { label: 'Keys', value: '7 KEYS' },
      { label: 'Level', value: '3 – Any' },
      { label: 'Stages', value: 'Infinity' },
      { label: 'Favorite level', value: 'OFF' },
      { label: 'BPM range', value: '+- 20BPM' },
      { label: 'Max BPM', value: 'NO LIMIT' },
      { label: 'Min BPM', value: '120 BPM' },
      { label: 'Draw charts whose BPM changes', value: 'On' },
    ]);
  });

  test('lists a NONSTOP run by difficulty with its estimate and connection', () => {
    const rows = describeRandomMixSetup({
      kind: 'nonstop',
      conditions: {
        ...DEFAULT_RANDOM_MIX_CONDITIONS,
        by: 'difficulty',
        difficulties: [4, 5],
        estimateDifficulty: false,
        allowBPMChanges: false,
        count: 12,
      },
      settings: { ...DEFAULT_LR2_RANDOM_MIX_SETTINGS },
      defaultConnection: 'cut-fit',
    });
    expect(rows).toContainEqual({ label: 'Course', value: 'NONSTOP' });
    expect(rows).toContainEqual({ label: 'Difficulty', value: 'ANOTHER, INSANE' });
    expect(rows).toContainEqual({ label: 'Estimate a missing #DIFFICULTY', value: 'Off' });
    expect(rows).toContainEqual({ label: 'Stages', value: '12' });
    expect(rows).toContainEqual({ label: 'Connection', value: 'CUT+FIT' });
    expect(rows.at(-1)).toEqual({ label: 'Draw charts whose BPM changes', value: 'Off' });
    expect(
      describeRandomMixSetup({
        kind: 'expert',
        conditions: { ...DEFAULT_RANDOM_MIX_CONDITIONS, by: 'difficulty', difficulties: [] },
        settings: { ...DEFAULT_LR2_RANDOM_MIX_SETTINGS },
        defaultConnection: 'fade',
      }),
    ).toContainEqual({ label: 'Difficulty', value: 'None' });
  });
});

import { describe, expect, test } from 'vite-plus/test';
import { getDependencyReleaseLine, getReleaseLine } from './changelog.ts';

describe('changelog lines', () => {
  test('writes a release line as @changesets/changelog-git does', async () => {
    expect(await getReleaseLine({ summary: 'Fix the gauge.', commit: '3a5d9c3f00' })).toBe('- 3a5d9c3: Fix the gauge.');
    expect(await getReleaseLine({ summary: 'Add seeking.\n\n- One  \n- Two' })).toBe(
      '- Add seeking.\n  \n  - One\n  - Two',
    );
  });

  test('lists every bumped dependency at its new version on one line', async () => {
    const changesets = [
      { summary: 'a', commit: '1111111' },
      { summary: 'b', commit: '2222222' },
      { summary: 'c', commit: '3333333' },
    ];
    expect(
      await getDependencyReleaseLine(changesets, [
        { name: '@be-music/player-engine', newVersion: '0.11.0' },
        { name: '@be-music/shared-utils', newVersion: '0.6.0' },
      ]),
    ).toBe('- Updated dependencies: `@be-music/player-engine@0.11.0`, `@be-music/shared-utils@0.6.0`');
  });

  test('writes nothing when no dependency moved', async () => {
    expect(await getDependencyReleaseLine([{ summary: 'a', commit: '1111111' }], [])).toBe('');
  });
});

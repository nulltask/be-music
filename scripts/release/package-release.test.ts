import { describe, expect, it } from 'vite-plus/test';
import { shouldReleasePackage } from './package-release.ts';

describe('shouldReleasePackage', () => {
  it('releases a public package whose version moved, or that is new', () => {
    expect(
      shouldReleasePackage(
        { name: '@be-music/chart-parser', version: '0.4.0' },
        { name: '@be-music/chart-parser', version: '0.3.0' },
      ),
    ).toBe(true);
    expect(shouldReleasePackage({ name: '@be-music/chart-parser', version: '0.1.0' }, null)).toBe(true);
  });

  it('skips a package whose version did not move', () => {
    expect(
      shouldReleasePackage(
        { name: '@be-music/chart-parser', version: '0.3.0' },
        { name: '@be-music/chart-parser', version: '0.3.0' },
      ),
    ).toBe(false);
  });

  it('never releases a private package', () => {
    expect(
      shouldReleasePackage(
        { name: '@be-music/app-play', version: '0.6.0', private: true },
        { name: '@be-music/app-play', version: '0.5.0', private: true },
      ),
    ).toBe(false);
  });
});

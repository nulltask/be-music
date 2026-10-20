import { describe, expect, test } from 'vite-plus/test';
import { renderBuildInfo } from './build-info.ts';

describe('build footer', () => {
  test('formats a fixed timestamp in UTC and abbreviates the revision', () => {
    const html = renderBuildInfo({ builtAt: '2026-10-20T17:00:00+09:00', revision: '0123456789abcdef' });
    expect(html).toContain('datetime="2026-10-20T08:00:00.000Z"');
    expect(html).toContain('2026-10-20 08:00:00 UTC');
    expect(html).toContain('<code title="0123456789abcdef">01234567</code>');
  });
  test('escapes revision markup and reports missing values honestly', () => {
    expect(renderBuildInfo({ builtAt: 'invalid', revision: '<script>"&' })).not.toContain('<script>');
    expect(renderBuildInfo({ builtAt: 'invalid', revision: '' })).toContain('unknown');
    expect(renderBuildInfo()).toBe('');
  });
});

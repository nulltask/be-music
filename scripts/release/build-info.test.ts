import { describe, expect, test } from 'vite-plus/test';
import { resolveBuildInfo } from './build-info.ts';
const now = new Date('2026-10-20T08:00:00Z');
const checkout = 'a'.repeat(40);
const event = 'b'.repeat(40);
describe('build metadata resolution', () => {
  test('uses the actual checkout rather than a potentially unrelated workflow event', () => {
    expect(resolveBuildInfo({ GITHUB_SHA: event }, checkout, now)).toEqual({
      builtAt: now.toISOString(),
      revision: checkout,
    });
  });
  test('supports explicit and Workers Builds metadata, and a fixed build timestamp', () => {
    expect(
      resolveBuildInfo({ WORKERS_CI_COMMIT_SHA: event, BUILD_TIMESTAMP: '2026-10-20T17:00:00+09:00' }, checkout, now),
    ).toEqual({ builtAt: now.toISOString(), revision: event });
    expect(resolveBuildInfo({ BUILD_REVISION: checkout, WORKERS_CI_COMMIT_SHA: event }, '', now).revision).toBe(
      checkout,
    );
  });
  test('uses CI metadata or unknown when there is no checkout and rejects invalid timestamps', () => {
    expect(resolveBuildInfo({ GITHUB_SHA: event }, '', now).revision).toBe(event);
    expect(resolveBuildInfo({ BUILD_REVISION: '<script>' }, '', now).revision).toBe('unknown');
    expect(() => resolveBuildInfo({ BUILD_TIMESTAMP: 'bad' }, checkout, now)).toThrow('Invalid build timestamp');
  });
});

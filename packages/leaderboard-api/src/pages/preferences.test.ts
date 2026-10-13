import { describe, expect, test } from 'vite-plus/test';
import { resolveDisplayRuleset, safeReturnPath } from './preferences.ts';

describe('display ruleset preference', () => {
  test('reads a known ruleset and defaults to LR2', () => {
    expect(resolveDisplayRuleset('beatoraja')).toBe('beatoraja');
    expect(resolveDisplayRuleset('iidx')).toBe('iidx');
    expect(resolveDisplayRuleset(undefined)).toBe('lr2');
    expect(resolveDisplayRuleset('popn')).toBe('lr2');
  });

  test('only returns to pages under /leaderboard on this site', () => {
    expect(safeReturnPath('/leaderboard/charts/x?assisted=1')).toBe('/leaderboard/charts/x?assisted=1');
    expect(safeReturnPath('/leaderboard')).toBe('/leaderboard');
    for (const next of [
      undefined,
      '/',
      'https://evil.example/leaderboard',
      '//evil.example/leaderboard',
      '/leaderboard\\..\\x',
      '/api/v0/me',
    ]) {
      expect(safeReturnPath(next)).toBe('/leaderboard');
    }
  });
});

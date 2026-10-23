import { describe, expect, test } from 'vite-plus/test';
import { resolveDisplayRuleset, safeReturnPath } from './preferences.ts';

describe('display ruleset preference', () => {
  test('reads a known ruleset and defaults to LR2', () => {
    expect(resolveDisplayRuleset('beatoraja')).toBe('beatoraja');
    expect(resolveDisplayRuleset('____')).toBe('____');
    expect(resolveDisplayRuleset(undefined)).toBe('lr2');
    expect(resolveDisplayRuleset('popn')).toBe('lr2');
  });

  test('only returns to pages on this site', () => {
    expect(safeReturnPath('/charts/x?assisted=1')).toBe('/charts/x?assisted=1');
    expect(safeReturnPath('/')).toBe('/');
    for (const next of [undefined, 'https://evil.example/', '//evil.example/', '/\\..\\x', '/api/v0/me', '/api']) {
      expect(safeReturnPath(next)).toBe('/');
    }
  });
});

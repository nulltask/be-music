import { describe, expect, test } from 'vite-plus/test';
import { dashboardFor, isAuthPath } from './routing.ts';

describe('isAuthPath', () => {
  test('takes Better Auth’s endpoints and callbacks', () => {
    expect(isAuthPath('/api/auth')).toBe(true);
    expect(isAuthPath('/api/auth/get-session')).toBe(true);
    expect(isAuthPath('/api/auth/callback/discord')).toBe(true);
  });

  test('leaves everything else', () => {
    expect(isAuthPath('/')).toBe(false);
    expect(isAuthPath('/api/v0/me')).toBe(false);
    expect(isAuthPath('/api/authx')).toBe(false);
    expect(isAuthPath('/leaderboard')).toBe(false);
  });
});

describe('dashboardFor', () => {
  test('finds the dashboard of the same environment', () => {
    expect(dashboardFor('accounts.be-music.app')).toBe('https://be-music.app');
    expect(dashboardFor('accounts.preview.be-music.app')).toBe('https://preview.be-music.app');
  });

  test('is undefined on other hosts', () => {
    expect(dashboardFor('localhost')).toBeUndefined();
    expect(dashboardFor('be-music.app')).toBeUndefined();
  });
});

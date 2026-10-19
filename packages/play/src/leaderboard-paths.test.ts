import { describe, expect, test } from 'vite-plus/test';
import { isLeaderboardPath } from './leaderboard-paths.ts';

describe('isLeaderboardPath', () => {
  test('takes the API, Better Auth included', () => {
    for (const path of ['/api/v0/me', '/api/auth/get-session']) {
      expect(isLeaderboardPath(path)).toBe(true);
    }
  });

  test('leaves the player and the Leaderboard pages, which live on their own host', () => {
    for (const path of [
      '/',
      '/index.html',
      '/api',
      '/leaderboard',
      '/leaderboard/players/x',
      '/ffmpeg-core/ffmpeg-core.wasm',
    ]) {
      expect(isLeaderboardPath(path)).toBe(false);
    }
  });
});

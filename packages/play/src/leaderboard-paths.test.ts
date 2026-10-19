import { describe, expect, test } from 'vite-plus/test';
import { isLeaderboardPath } from './leaderboard-paths.ts';

describe('isLeaderboardPath', () => {
  test('takes the API and every Leaderboard page, the bare /leaderboard included', () => {
    for (const path of ['/api/v0/me', '/api/auth/get-session', '/leaderboard', '/leaderboard/', '/leaderboard/api']) {
      expect(isLeaderboardPath(path)).toBe(true);
    }
  });

  test('leaves the player alone', () => {
    for (const path of ['/', '/index.html', '/api', '/leaderboards', '/leaderboard-x', '/ffmpeg-core/ffmpeg-core.js']) {
      expect(isLeaderboardPath(path)).toBe(false);
    }
  });
});

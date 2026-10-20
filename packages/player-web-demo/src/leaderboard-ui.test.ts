import { describe, expect, test } from 'vite-plus/test';
import { describeSubmittingClient } from './leaderboard-ui.ts';

describe('describeSubmittingClient', () => {
  test('names the app, its version and its build', () => {
    expect(describeSubmittingClient({ name: 'be-music-web', version: '0.5.0', build: 'abc123', platform: 'web' })).toBe(
      'be-music-web/0.5.0 (build abc123)',
    );
    expect(describeSubmittingClient({ name: 'be-music-web', version: '0.5.0', platform: 'web' })).toBe(
      'be-music-web/0.5.0',
    );
  });
});

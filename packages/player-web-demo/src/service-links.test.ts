import { describe, expect, test } from 'vite-plus/test';
import { leaderboardLink, siteOfPlayHost } from './service-links.ts';

describe('siteOfPlayHost', () => {
  test('finds the site under a play host, preview included', () => {
    expect(siteOfPlayHost('play.be-music.app')).toBe('be-music.app');
    expect(siteOfPlayHost('play.preview.be-music.app')).toBe('preview.be-music.app');
    expect(siteOfPlayHost('PLAY.be-music.app')).toBe('be-music.app');
  });

  test('is undefined elsewhere', () => {
    expect(siteOfPlayHost('localhost')).toBeUndefined();
    expect(siteOfPlayHost('feature-x-play-preview.be-music.workers.dev')).toBeUndefined();
    expect(siteOfPlayHost('be-music.app')).toBeUndefined();
  });
});

describe('leaderboardLink', () => {
  test('points at the Leaderboard host next to a play host', () => {
    expect(leaderboardLink('/leaderboard/players/abc', 'play.be-music.app')).toBe(
      'https://leaderboard.be-music.app/leaderboard/players/abc',
    );
    expect(leaderboardLink('/leaderboard', 'play.preview.be-music.app')).toBe(
      'https://leaderboard.preview.be-music.app/leaderboard',
    );
  });

  test('stays relative where the player’s Worker serves the Leaderboard itself', () => {
    expect(leaderboardLink('/leaderboard', 'localhost')).toBe('/leaderboard');
  });
});

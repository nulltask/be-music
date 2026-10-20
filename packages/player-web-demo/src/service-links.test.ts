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
    expect(leaderboardLink('/players/abc', 'play.be-music.app')).toBe('https://leaderboard.be-music.app/players/abc');
    expect(leaderboardLink('/', 'play.preview.be-music.app')).toBe('https://leaderboard.preview.be-music.app/');
  });

  test('a branch Preview URL of the preview Player links the preview Leaderboard', () => {
    expect(leaderboardLink('/', 'feature-x-play-preview.be-music.workers.dev')).toBe(
      'https://leaderboard.preview.be-music.app/',
    );
  });

  test('anywhere else links production', () => {
    expect(leaderboardLink('/players/abc', 'localhost')).toBe('https://leaderboard.be-music.app/players/abc');
  });
});

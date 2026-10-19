import { describe, expect, test } from 'vite-plus/test';
import { playerAppHref, playerHref } from './basics.tsx';

describe('playerAppHref', () => {
  test('points at the player of the same environment', () => {
    expect(playerAppHref('https://leaderboard.be-music.app/charts/x')).toBe('https://play.be-music.app/');
    expect(playerAppHref('https://leaderboard.preview.be-music.app/')).toBe('https://play.preview.be-music.app/');
  });

  test('falls back to the production player elsewhere', () => {
    expect(playerAppHref('http://localhost:8787/')).toBe('https://play.be-music.app/');
  });
});

describe('playerHref', () => {
  test('links a player page at the root', () => {
    expect(playerHref('a b')).toBe('/players/a%20b');
  });
});

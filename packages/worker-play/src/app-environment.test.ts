import { describe, expect, test } from 'vite-plus/test';
import { playEnvironmentOfOrigin } from './app-environment.ts';

describe('playEnvironmentOfOrigin', () => {
  test('tells the preview Worker by its public origin', () => {
    expect(playEnvironmentOfOrigin('https://play.preview.be-music.app')).toBe('preview');
    expect(playEnvironmentOfOrigin('https://PLAY.preview.be-music.app/')).toBe('preview');
  });

  test('takes any other origin as production', () => {
    for (const origin of [
      'https://play.be-music.app',
      'https://leaderboard.preview.be-music.app',
      'http://localhost',
    ]) {
      expect(playEnvironmentOfOrigin(origin)).toBe('production');
    }
  });
});

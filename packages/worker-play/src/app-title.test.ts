import { describe, expect, test } from 'vite-plus/test';
import { playAppShortName, playAppTitle, playEnvironmentOfOrigin, retitleHTML, retitleManifest } from './app-title.ts';

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

describe('playAppTitle / playAppShortName', () => {
  test('names the environment outside production', () => {
    expect(playAppTitle('production')).toBe('Be-Music Play');
    expect(playAppTitle('preview')).toBe('Be-Music Play (Preview)');
    expect(playAppTitle('development')).toBe('Be-Music Play (Development)');
    expect(playAppShortName('production')).toBe('Be-Music');
    expect(playAppShortName('preview')).toBe('Be-Music (Preview)');
    expect(playAppShortName('development')).toBe('Be-Music (Development)');
  });
});

describe('retitleManifest', () => {
  test('sets the names and keeps every other member', () => {
    const manifest = JSON.stringify({ id: '/', name: 'Be-Music Play', short_name: 'Be-Music', display: 'standalone' });
    expect(JSON.parse(retitleManifest(manifest, 'preview'))).toEqual({
      id: '/',
      name: 'Be-Music Play (Preview)',
      short_name: 'Be-Music (Preview)',
      display: 'standalone',
    });
  });
});

describe('retitleHTML', () => {
  test('sets the title and the iOS home screen title', () => {
    const html = [
      '<head>',
      '<meta name="apple-mobile-web-app-title" content="Be-Music" />',
      '<title>Be-Music Play</title>',
      '</head>',
    ].join('\n');
    expect(retitleHTML(html, 'development')).toBe(
      [
        '<head>',
        '<meta name="apple-mobile-web-app-title" content="Be-Music (Development)" />',
        '<title>Be-Music Play (Development)</title>',
        '</head>',
      ].join('\n'),
    );
  });

  test('leaves a page without them alone', () => {
    expect(retitleHTML('<p>Be-Music Play</p>', 'preview')).toBe('<p>Be-Music Play</p>');
  });
});

import { describe, expect, test } from 'vite-plus/test';
import {
  FFMPEG_CORE_URLS,
  FONT_CACHE_NAME,
  currentCacheNames,
  extractFontFileURLs,
  ffmpegCoreCacheName,
  fontFetchInit,
  isCacheableResponse,
  routeRequest,
  shellCacheName,
  staleCacheNames,
  type PrecacheManifest,
  type RequestFacts,
} from './routes.ts';

const ORIGIN = 'https://play.be-music.app';
const PRECACHED = new Set([
  '/',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/acknowledgements.json',
]);

function get(path: string, facts: Partial<RequestFacts> = {}): RequestFacts {
  return {
    url: path.startsWith('http') ? path : `${ORIGIN}${path}`,
    method: 'GET',
    mode: 'cors',
    destination: '',
    hasRange: false,
    ...facts,
  };
}

function navigate(path: string, facts: Partial<RequestFacts> = {}): RequestFacts {
  return get(path, { mode: 'navigate', destination: 'document', ...facts });
}

const route = (facts: RequestFacts) => routeRequest(facts, ORIGIN, PRECACHED);

describe('routeRequest', () => {
  test('answers a page load of the app with the shell, query string and all', () => {
    for (const path of [
      '/',
      '/?music=https%3A%2F%2Fhost%2Fsong.zip&skin=https%3A%2F%2Fhost%2Ftheme.zip',
      '/index.html',
      '/a/b',
    ]) {
      expect(route(navigate(path))).toBe('shell-navigation');
    }
  });

  test('leaves the Worker routes to the network, page loads included', () => {
    for (const path of [
      '/api/auth/sign-in?returnTo=%2F',
      '/api/auth/get-session',
      '/api/auth/callback?code=x',
      '/api/player-settings',
      '/api/v0/me',
      '/api',
      '/__url-load-proxy?url=https%3A%2F%2Fhost%2Fsong.zip',
    ]) {
      expect(route(get(path))).toBe('network');
      expect(route(navigate(path))).toBe('network');
    }
  });

  test('keeps the embed page out of the app', () => {
    for (const path of ['/embed', '/embed/', '/embed/?track=abc', '/embed/index.html']) {
      expect(route(navigate(path))).toBe('network');
      expect(route(get(path))).toBe('network');
    }
  });

  test('never handles a write, a range request or the worker script', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
      expect(route(get('/assets/main-abc.js', { method }))).toBe('network');
      expect(route(navigate('/', { method }))).toBe('network');
    }
    expect(route(get('/ffmpeg-core/ffmpeg-core.wasm', { hasRange: true }))).toBe('network');
    expect(route(get('/sw.js'))).toBe('network');
  });

  test('leaves page loads of files and frames to the network', () => {
    expect(route(navigate('/favicon.svg'))).toBe('network');
    expect(route(navigate('/assets/main-abc.js'))).toBe('network');
    expect(route(navigate('/', { destination: 'iframe' }))).toBe('network');
  });

  test('caches the hashed build assets, the precached files and the ffmpeg core', () => {
    expect(route(get('/assets/main-abc.js', { destination: 'script' }))).toBe('hashed-asset');
    expect(route(get('/assets/compute-worker-abc.js', { destination: 'worker' }))).toBe('hashed-asset');
    expect(route(get('/favicon.svg'))).toBe('precached');
    expect(route(get('/manifest.webmanifest', { destination: 'manifest' }))).toBe('precached');
    expect(route(get('/acknowledgements.json'))).toBe('precached');
    expect(route(get('/ffmpeg-core/ffmpeg-core.js'))).toBe('ffmpeg-core');
    expect(route(get('/ffmpeg-core/ffmpeg-core.wasm'))).toBe('ffmpeg-core');
  });

  test('sends an unlisted file, or a precached one with a query, to the network', () => {
    expect(route(get('/favicon.svg?v=2'))).toBe('network');
    expect(route(get('/ffmpeg-core/ffmpeg-core.wasm?v=2'))).toBe('network');
    expect(route(get('/robots.txt'))).toBe('network');
  });

  test('caches the UI fonts and nothing else from another origin', () => {
    expect(route(get('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500&display=swap'))).toBe(
      'font-stylesheet',
    );
    expect(route(get('https://fonts.gstatic.com/s/orbitron/v31/abc.woff2', { destination: 'font' }))).toBe('font-file');
    for (const url of [
      'https://host.example/song.zip',
      'https://leaderboard.be-music.app/api/v0/charts',
      'https://accounts.be-music.app/api/auth/session',
      'http://fonts.gstatic.com/s/orbitron/v31/abc.woff2',
      'https://fonts.googleapis.com/icon?family=Material+Icons',
      'https://play.preview.be-music.app/assets/main-abc.js',
    ]) {
      expect(route(get(url))).toBe('network');
    }
  });

  test('leaves a URL it cannot read to the network', () => {
    expect(route(get('not a url'))).toBe('network');
  });
});

describe('isCacheableResponse', () => {
  test('stores complete successful answers', () => {
    expect(isCacheableResponse({ status: 200, type: 'basic' })).toBe(true);
    expect(isCacheableResponse({ status: 200, type: 'cors' })).toBe(true);
  });

  test('never stores errors, partial content or redirects', () => {
    expect(isCacheableResponse({ status: 404, type: 'basic' })).toBe(false);
    expect(isCacheableResponse({ status: 206, type: 'basic' })).toBe(false);
    expect(isCacheableResponse({ status: 0, type: 'opaqueredirect' })).toBe(false);
  });

  test('never stores an opaque answer, which a cross-origin isolated page cannot read back', () => {
    expect(isCacheableResponse({ status: 0, type: 'opaque' })).toBe(false);
  });

  test('fetches the fonts with CORS and no credentials, whatever mode the page asked in', () => {
    expect(fontFetchInit).toEqual({ mode: 'cors', credentials: 'omit' });
  });
});

describe('cache names', () => {
  const manifest: PrecacheManifest = { version: 'v2', urls: ['/'], ffmpegCoreVersion: '0.12.10', fontStylesheets: [] };

  test('name the shell by deploy and the ffmpeg core by version', () => {
    expect(currentCacheNames(manifest)).toEqual([
      shellCacheName('v2'),
      ffmpegCoreCacheName('0.12.10'),
      FONT_CACHE_NAME,
    ]);
    expect(shellCacheName('v2')).not.toBe(shellCacheName('v1'));
  });

  test("drop the earlier deploys' caches and keep the current ones and other caches on the origin", () => {
    const existing = [
      shellCacheName('v1'),
      shellCacheName('v2'),
      ffmpegCoreCacheName('0.12.9'),
      ffmpegCoreCacheName('0.12.10'),
      FONT_CACHE_NAME,
      'some-other-cache',
    ];
    expect(staleCacheNames(existing, manifest)).toEqual([shellCacheName('v1'), ffmpegCoreCacheName('0.12.9')]);
  });

  test('drop the first font cache, which could hold opaque answers', () => {
    expect(FONT_CACHE_NAME).not.toBe('be-music-play-fonts');
    expect(staleCacheNames(['be-music-play-fonts', FONT_CACHE_NAME], manifest)).toEqual(['be-music-play-fonts']);
  });
});

test('lists the font files a Google Fonts stylesheet names, each once', () => {
  const css = `
@font-face { font-family: 'Orbitron'; src: url(https://fonts.gstatic.com/s/orbitron/v31/a.woff2) format('woff2'); }
@font-face { font-family: 'M PLUS 1p'; src: url("https://fonts.gstatic.com/s/mplus1p/v28/b.woff2") format('woff2'); unicode-range: U+3000-30FF; }
@font-face { font-family: 'M PLUS 1p'; src: url(https://fonts.gstatic.com/s/mplus1p/v28/b.woff2) format('woff2'); }
@font-face { src: url(https://example.com/elsewhere.woff2); }`;
  expect(extractFontFileURLs(css)).toEqual([
    'https://fonts.gstatic.com/s/orbitron/v31/a.woff2',
    'https://fonts.gstatic.com/s/mplus1p/v28/b.woff2',
  ]);
  expect(extractFontFileURLs('')).toEqual([]);
});

test('caches the ffmpeg core the player loads, which the ffmpeg route answers', () => {
  const origin = 'https://play.be-music.app';
  for (const path of FFMPEG_CORE_URLS) {
    expect(
      routeRequest(
        { url: origin + path, method: 'GET', mode: 'cors', destination: '', hasRange: false },
        origin,
        new Set(),
      ),
    ).toBe('ffmpeg-core');
  }
});

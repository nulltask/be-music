import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vite-plus/test';
import {
  MANIFEST_PLACEHOLDER,
  findFontStylesheets,
  injectManifest,
  isNeverPrecached,
  precacheURL,
  precacheVersion,
  selectPrecacheFiles,
  versionedPWAURL,
} from './service-worker-plugin.ts';

describe('selectPrecacheFiles', () => {
  const bundle = [
    { fileName: 'index.html', references: ['assets/main-a.js'] },
    { fileName: 'embed/index.html', references: ['assets/embed-b.js'] },
    { fileName: 'assets/main-a.js', references: ['assets/shared-c.js', 'assets/lazy-d.js', 'assets/main-e.css'] },
    { fileName: 'assets/embed-b.js', references: ['assets/shared-c.js', 'assets/embed-f.css'] },
    { fileName: 'assets/shared-c.js', references: [] },
    { fileName: 'assets/lazy-d.js', references: [] },
    { fileName: 'assets/main-e.css', references: [] },
    { fileName: 'assets/embed-f.css', references: [] },
    // Loaded by URL, not imported: a root of its own.
    { fileName: 'assets/compute-worker-g.js', references: [] },
    { fileName: 'acknowledgements.json', references: [] },
    { fileName: 'favicon.svg', references: [] },
    { fileName: 'sw.js', references: [] },
    { fileName: 'ffmpeg-core/ffmpeg-core.wasm', references: [] },
    { fileName: 'ffmpeg-core/ffmpeg-core.js', references: [] },
  ];

  test('keeps what the player loads, shared chunks included, and drops what only the embed page loads', () => {
    expect(selectPrecacheFiles(bundle, ['embed/index.html'])).toEqual([
      'acknowledgements.json',
      'assets/compute-worker-g.js',
      'assets/lazy-d.js',
      'assets/main-a.js',
      'assets/main-e.css',
      'assets/shared-c.js',
      'favicon.svg',
      'index.html',
    ]);
  });

  test('ignores references to files outside the bundle', () => {
    expect(selectPrecacheFiles([{ fileName: 'index.html', references: ['assets/gone.js'] }], [])).toEqual([
      'index.html',
    ]);
  });
});

describe('isNeverPrecached', () => {
  test('leaves out the worker, the ffmpeg core, hidden files and source maps', () => {
    for (const name of [
      'sw.js',
      'ffmpeg-core/ffmpeg-core.wasm',
      '.assetsignore',
      '.vite/manifest.json',
      'icons/.DS_Store',
      'assets/main-a.js.map',
    ]) {
      expect(isNeverPrecached(name)).toBe(true);
    }
    for (const name of ['index.html', 'assets/main-a.js', 'icons/icon-192.png', 'manifest.webmanifest']) {
      expect(isNeverPrecached(name)).toBe(false);
    }
  });
});

describe('precacheURL', () => {
  test('caches the player page as the shell at the root', () => {
    expect(precacheURL('index.html')).toBe('/');
    expect(precacheURL('assets/main-a.js')).toBe('/assets/main-a.js');
    expect(precacheURL('icons/icon-512.png')).toBe('/icons/icon-512.png');
  });
});

describe('precacheVersion', () => {
  test('changes with any byte and not with the order of the files', () => {
    const files = [
      ['index.html', '<!doctype html>'],
      ['favicon.svg', new Uint8Array([1, 2, 3])],
    ] as const;
    const version = precacheVersion(files);
    expect(version).toMatch(/^[0-9a-f]{16}$/);
    expect(precacheVersion([...files].reverse())).toBe(version);
    expect(precacheVersion([files[0], ['favicon.svg', new Uint8Array([1, 2, 4])]])).not.toBe(version);
    expect(precacheVersion([files[0], ['favicon2.svg', files[1][1]]])).not.toBe(version);
  });
});

describe('versionedPWAURL', () => {
  test('uses a stable URL for the same bytes and a new URL when the asset changes', () => {
    const first = versionedPWAURL('/favicon.svg', 'before');
    expect(first).toMatch(/^\/favicon\.svg\?v=[0-9a-f]{16}$/);
    expect(versionedPWAURL('/favicon.svg', new TextEncoder().encode('before'))).toBe(first);
    expect(versionedPWAURL('/favicon.svg', 'after')).not.toBe(first);
  });
});

describe('injectManifest', () => {
  test('writes the manifest in place of the placeholder', () => {
    const manifest = { version: 'abc', urls: ['/'], ffmpegCoreVersion: '0.12.10', fontStylesheets: [] };
    expect(injectManifest(`var m=${MANIFEST_PLACEHOLDER};`, manifest)).toBe(`var m=${JSON.stringify(manifest)};`);
  });

  test('refuses a worker without exactly one placeholder', () => {
    const manifest = { version: 'abc', urls: [], ffmpegCoreVersion: '0', fontStylesheets: [] };
    expect(() => injectManifest('var m=1;', manifest)).toThrow(/found 0/);
    expect(() => injectManifest(`${MANIFEST_PLACEHOLDER}${MANIFEST_PLACEHOLDER}`, manifest)).toThrow(/found 2/);
  });
});

describe('the web app manifest', () => {
  const publicDir = resolve(import.meta.dirname, '../public');
  const manifest = JSON.parse(readFileSync(resolve(publicDir, 'manifest.webmanifest'), 'utf8')) as {
    name: string;
    start_url: string;
    scope: string;
    display: string;
    display_override?: string[];
    orientation?: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };

  test('names the app and installs it in its own window at the root', () => {
    expect(manifest.name).toBe('Be-Music Play');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(['standalone', 'fullscreen']).toContain(manifest.display);
    expect(manifest.orientation ?? 'any').not.toMatch(/^portrait/);
  });

  test('lets a desktop install put the header in the title bar, and a phone go fullscreen', () => {
    expect(manifest.display_override).toEqual(['window-controls-overlay', 'fullscreen', 'standalone']);
  });

  test('lists 192 and 512 px icons, a maskable one among them, that all exist', () => {
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512')).toBe(true);
    for (const icon of manifest.icons) {
      expect(() => readFileSync(resolve(publicDir, icon.src.slice(1)))).not.toThrow();
    }
  });
});

describe('findFontStylesheets', () => {
  test('finds the Google Fonts stylesheets a page links to, each once, unescaped', () => {
    const html = `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500&amp;display=swap" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500&amp;display=swap" />`;
    expect(findFontStylesheets(html)).toEqual([
      'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500&display=swap',
    ]);
  });

  test('finds the stylesheet the player shell links to', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf8');
    expect(findFontStylesheets(html)).toHaveLength(1);
    expect(findFontStylesheets(html)[0]).toContain('family=Orbitron');
  });
});

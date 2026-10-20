import { describe, expect, test } from 'vite-plus/test';
import { parseURLMediaParams, resolveURLLoadFetchURL, URL_LOAD_PROXY_PATH } from './url-load.ts';

describe('URL media auto-load helpers', () => {
  test('parseURLMediaParams extracts optional music and skin URLs', () => {
    const params = parseURLMediaParams(
      'http://localhost:5174/?music=https%3A%2F%2Fassets.example%2Fmusic.zip&skin=https%3A%2F%2Fassets.example%2Fskin.zip',
    );

    expect(params.musicURL).toBe('https://assets.example/music.zip');
    expect(params.skinURL).toBe('https://assets.example/skin.zip');
  });

  test('resolveURLLoadFetchURL routes cross-origin archives through the same-origin proxy', () => {
    const resolved = resolveURLLoadFetchURL(
      'https://assets.be-music.app/LR2beta3.zip',
      'http://localhost:5174/player?skin=https://assets.be-music.app/LR2beta3.zip',
    );
    const proxy = new URL(resolved);

    expect(proxy.origin).toBe('http://localhost:5174');
    expect(proxy.pathname).toBe(URL_LOAD_PROXY_PATH);
    expect(proxy.searchParams.get('url')).toBe('https://assets.be-music.app/LR2beta3.zip');
  });

  test('resolveURLLoadFetchURL keeps same-origin archive URLs direct', () => {
    expect(resolveURLLoadFetchURL('/packs/music.zip', 'http://localhost:5174/player')).toBe(
      'http://localhost:5174/packs/music.zip',
    );
  });

  test('resolveURLLoadFetchURL rejects unsupported protocols', () => {
    expect(() => resolveURLLoadFetchURL('ftp://assets.example/music.zip', 'http://localhost:5174/')).toThrow(
      'only supports http(s)',
    );
  });

  test('resolveURLLoadFetchURL rejects cross-origin http archive URLs', () => {
    expect(() => resolveURLLoadFetchURL('http://assets.example/music.zip', 'http://localhost:5174/')).toThrow(
      'cross-origin URL auto-load only supports https URLs',
    );
  });
});

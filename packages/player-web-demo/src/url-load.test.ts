import { describe, expect, test } from 'vitest';
import { parseUrlMediaParams, resolveUrlLoadFetchUrl, URL_LOAD_PROXY_PATH } from './url-load.ts';

describe('URL media auto-load helpers', () => {
  test('parseUrlMediaParams extracts optional music and skin URLs', () => {
    const params = parseUrlMediaParams(
      'http://localhost:5174/?music=https%3A%2F%2Fassets.example%2Fmusic.zip&skin=https%3A%2F%2Fassets.example%2Fskin.zip',
    );

    expect(params.musicUrl).toBe('https://assets.example/music.zip');
    expect(params.skinUrl).toBe('https://assets.example/skin.zip');
  });

  test('resolveUrlLoadFetchUrl routes cross-origin archives through the same-origin proxy', () => {
    const resolved = resolveUrlLoadFetchUrl(
      'https://assets.nulltask.dev/LR2beta3.zip',
      'http://localhost:5174/player?skin=https://assets.nulltask.dev/LR2beta3.zip',
    );
    const proxy = new URL(resolved);

    expect(proxy.origin).toBe('http://localhost:5174');
    expect(proxy.pathname).toBe(URL_LOAD_PROXY_PATH);
    expect(proxy.searchParams.get('url')).toBe('https://assets.nulltask.dev/LR2beta3.zip');
  });

  test('resolveUrlLoadFetchUrl keeps same-origin archive URLs direct', () => {
    expect(resolveUrlLoadFetchUrl('/packs/music.zip', 'http://localhost:5174/player')).toBe(
      'http://localhost:5174/packs/music.zip',
    );
  });

  test('resolveUrlLoadFetchUrl rejects unsupported protocols', () => {
    expect(() => resolveUrlLoadFetchUrl('ftp://assets.example/music.zip', 'http://localhost:5174/')).toThrow(
      'only supports http(s)',
    );
  });

  test('resolveUrlLoadFetchUrl rejects cross-origin http archive URLs', () => {
    expect(() => resolveUrlLoadFetchUrl('http://assets.example/music.zip', 'http://localhost:5174/')).toThrow(
      'cross-origin URL auto-load only supports https URLs',
    );
  });
});

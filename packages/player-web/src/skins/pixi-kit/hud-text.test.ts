import { TextStyle } from 'pixi.js';
import { describe, expect, it } from 'vite-plus/test';
import { rememberStyle } from './hud-text.ts';

describe('rememberStyle', () => {
  it('caches styles and forgets the oldest once full', () => {
    const cache = new Map<string, TextStyle>();
    const first = new TextStyle();
    rememberStyle(cache, 'first', first);
    for (let index = 0; index < 511; index += 1) rememberStyle(cache, `k${index}`, new TextStyle());
    expect(cache.get('first')).toBe(first);
    rememberStyle(cache, 'overflow', new TextStyle());
    expect(cache.size).toBe(512);
    expect(cache.has('first')).toBe(false);
    expect(cache.has('overflow')).toBe(true);
  });
});

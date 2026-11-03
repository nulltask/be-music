import { Container, TextStyle } from 'pixi.js';
import { describe, expect, it, test } from 'vite-plus/test';
import { addHUDText, quantizeTextEffectAlpha, quantizeTextEffectColor, rememberStyle } from './hud-text.ts';

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

describe('text effect quantization', () => {
  test('rounds a glow or outline colour to 16 levels per channel, keeping exact 4-bit colours', () => {
    expect(quantizeTextEffectColor(0xffffff)).toBe(0xffffff);
    expect(quantizeTextEffectColor(0x000000)).toBe(0x000000);
    expect(quantizeTextEffectColor(0x112233)).toBe(0x112233);
    // Nearby colours of a drifting accent share one step.
    expect(quantizeTextEffectColor(0xff7a1e)).toBe(quantizeTextEffectColor(0xfe7b1f));
    expect(quantizeTextEffectColor(0xff7a1e)).toBe(0xff7722);
  });

  test('rounds a glow opacity to steps of 0.05', () => {
    expect(quantizeTextEffectAlpha(0.8)).toBe(0.8);
    expect(quantizeTextEffectAlpha(0.73)).toBe(0.75);
    expect(quantizeTextEffectAlpha(0.71)).toBe(0.7);
  });

  test('gives a drifting glow colour one style until it crosses a step', () => {
    const layer = new Container();
    const a = addHUDText(layer, 'FREE PLAY', 0, 0, {
      dropShadow: { color: 0xff7a1e, alpha: 0.8, blur: 6, distance: 0 },
    });
    const b = addHUDText(layer, 'FREE PLAY', 0, 0, {
      dropShadow: { color: 0xfe7b1f, alpha: 0.81, blur: 6, distance: 0 },
    });
    expect(b.style).toBe(a.style);
  });
});

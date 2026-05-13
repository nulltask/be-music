import { describe, expect, it, vi } from 'vitest';
import { attachBlobUrlToTexture } from './textures.ts';

describe('attachBlobUrlToTexture', () => {
  it('records the blob URL on a real texture object', () => {
    // Minimal duck-typed `Texture` stand-in — `attachBlobUrlToTexture` only stamps a Symbol-keyed string. Real Pixi
    // textures inherit from `EventEmitter` etc.; we don't need that surface to exercise the property write.
    const texture: Record<symbol, unknown> = {};
    attachBlobUrlToTexture(texture as unknown as Parameters<typeof attachBlobUrlToTexture>[0], 'blob:test/abc');
    const symbol = Object.getOwnPropertySymbols(texture).find((s) => s.description?.includes('texture-blob-url'));
    expect(symbol).toBeDefined();
    expect(texture[symbol!]).toBe('blob:test/abc');
  });

  it('is a no-op for null/undefined textures (regression: Pixi Assets.load can resolve null)', () => {
    // Pixi v8 occasionally resolves `Assets.load(blobUrl)` with `null` for unsupported payload bytes (e.g. a `.dds`
    // file blob-loaded as `image/png` falls through every decoder). Before the guard, the resulting
    // `attachBlobUrlToTexture(null, url)` crashed with `Cannot set properties of null (setting 'Symbol...')` —
    // surfaced as a hard error from the LITONE4 font loader's `font_11.dds`. The guard now silently no-ops on
    // null / undefined input so the caller's normal "unsupported asset → fallback" path runs.
    expect(() => attachBlobUrlToTexture(null, 'blob:test/null')).not.toThrow();
    expect(() => attachBlobUrlToTexture(undefined, 'blob:test/undef')).not.toThrow();
  });

  it('does not invoke the Symbol setter when the texture is falsy', () => {
    // Ensures the guard short-circuits BEFORE the property write — otherwise a getter on `texture[Symbol]` would
    // still run for non-null falsy values. We use a spy on `Object.defineProperty` to confirm no write happens.
    const spy = vi.spyOn(Object, 'defineProperty');
    attachBlobUrlToTexture(null, 'blob:no');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

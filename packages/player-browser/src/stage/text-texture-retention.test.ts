import { describe, expect, test } from 'vite-plus/test';
import { retainReleasedTextTextures, type RetainableTextSystem } from './text-texture-retention.ts';

/** Pixi's text system's reference counting, as `AbstractTextSystem` does it, with the textures it returned. */
function fakeTextSystem(): RetainableTextSystem & { returned: unknown[]; acquire(key: string): unknown } {
  const system = {
    _activeTextures: {} as RetainableTextSystem['_activeTextures'],
    returned: [] as unknown[],
    rasterized: 0,
    acquire(key: string): unknown {
      if (this._activeTextures[key]) {
        this._increaseReferenceCount(key);
        return this._activeTextures[key]!.texture;
      }
      const texture = { key, id: (this.rasterized += 1) };
      this._activeTextures[key] = { texture, usageCount: 1 };
      return texture;
    },
    decreaseReferenceCount(key: string): void {
      const entry = this._activeTextures[key];
      if (!entry) return;
      entry.usageCount -= 1;
      if (entry.usageCount === 0) {
        this.returnTexture(entry.texture);
        this._activeTextures[key] = null;
      }
    },
    _increaseReferenceCount(key: string): void {
      this._activeTextures[key]!.usageCount += 1;
    },
    returnTexture(texture: unknown): void {
      this.returned.push(texture);
    },
  };
  return system;
}

describe('retainReleasedTextTextures', () => {
  test('keeps a texture its last text let go, so the string coming back reuses it', () => {
    const system = fakeTextSystem();
    retainReleasedTextTextures(system);
    const seven = system.acquire('7');
    system.decreaseReferenceCount('7');
    expect(system.returned).toEqual([]);
    expect(system.acquire('7')).toBe(seven);
    expect(system._activeTextures['7']!.usageCount).toBe(1);
  });

  test('counts users as before while more than one text shares a texture', () => {
    const system = fakeTextSystem();
    retainReleasedTextTextures(system);
    system.acquire('1');
    system.acquire('1');
    system.decreaseReferenceCount('1');
    expect(system._activeTextures['1']!.usageCount).toBe(1);
  });

  test('returns the least recently released textures once more than the capacity wait', () => {
    const system = fakeTextSystem();
    retainReleasedTextTextures(system, 2);
    const a = system.acquire('a');
    system.acquire('b');
    system.acquire('c');
    system.decreaseReferenceCount('a');
    system.decreaseReferenceCount('b');
    system.decreaseReferenceCount('c');
    expect(system.returned).toEqual([a]);
    expect(system._activeTextures.a).toBeNull();
    // A kept texture in use again leaves the queue, so it is not the next to go.
    system.acquire('b');
    system.acquire('d');
    system.decreaseReferenceCount('d');
    expect(system._activeTextures.b!.usageCount).toBe(1);
    expect(system._activeTextures.c!.usageCount).toBe(0);
  });

  test('restores the original methods and releases what it kept', () => {
    const system = fakeTextSystem();
    const original = system.decreaseReferenceCount;
    const restore = retainReleasedTextTextures(system);
    const kept = system.acquire('x');
    system.decreaseReferenceCount('x');
    restore();
    expect(system.decreaseReferenceCount).toBe(original);
    expect(system.returned).toEqual([kept]);
    expect(system._activeTextures.x).toBeNull();
  });

  test('leaves a text system without the members it relies on alone', () => {
    expect(() => retainReleasedTextTextures(undefined)()).not.toThrow();
    expect(() => retainReleasedTextTextures({ returnTexture: () => undefined })()).not.toThrow();
  });
});

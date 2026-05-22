import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBeatorajaFonts } from './fonts.ts';

class FakeFontFace {
  readonly family: string;
  readonly source: ArrayBuffer;

  constructor(family: string, source: ArrayBuffer) {
    this.family = family;
    this.source = source;
  }

  async load(): Promise<FakeFontFace> {
    return this;
  }
}

describe('loadBeatorajaFonts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unregisters loaded CSS font faces when disposed', async () => {
    const faces = new Set<FakeFontFace>();
    const fontSet = {
      add: vi.fn((face: FakeFontFace) => {
        faces.add(face);
      }),
      delete: vi.fn((face: FakeFontFace) => faces.delete(face)),
    };
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('document', { fonts: fontSet });

    const cache = await loadBeatorajaFonts({
      files: new Map([['skin/font.ttf', new Uint8Array([0, 1, 2, 3])]]),
      entryPath: 'skin/select.json',
      fonts: [{ id: 1, path: 'font.ttf' }],
    });

    expect(cache.kind(1)).toBe('css');
    expect(cache.family(1)).toContain('beatoraja-skin-');
    expect(cache.values()).toHaveLength(1);
    expect(fontSet.add).toHaveBeenCalledTimes(1);
    expect(faces.size).toBe(1);

    const [face] = faces;
    cache.dispose();

    expect(fontSet.delete).toHaveBeenCalledWith(face);
    expect(faces.size).toBe(0);
    expect(cache.kind(1)).toBeUndefined();
    expect(cache.family(1)).toBeUndefined();
    expect(cache.values()).toEqual([]);

    cache.dispose();
    expect(fontSet.delete).toHaveBeenCalledTimes(1);
  });
});

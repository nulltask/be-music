import { describe, expect, it } from 'vite-plus/test';
import type { LR2SkinFileEntry } from './file-lookup.ts';
import { normalizeLR2Path, resolveLR2AssetBytes, resolveLR2IncludePath, wildcardToRegExp } from './assets.ts';
import type { LR2Skin } from './skin.ts';

const BYTES_A = new Uint8Array([1, 2, 3]);
const BYTES_B = new Uint8Array([4, 5, 6]);

function skinWithFiles(files: ReadonlyMap<string, LR2SkinFileEntry>): LR2Skin {
  return { files } as LR2Skin;
}

describe('resolveLR2IncludePath', () => {
  it('resolves includes relative to the current skin directory case-insensitively', () => {
    const files = new Map<string, LR2SkinFileEntry>([['LR2files/Theme/LR2/Select/Parts.CSV', BYTES_A]]);

    expect(resolveLR2IncludePath(files, 'LR2files/Theme/LR2/Select', 'parts.csv')).toBe(
      'LR2files/Theme/LR2/Select/Parts.CSV',
    );
  });

  it('falls back through grandparent / parent suffixes before basename-only matching', () => {
    const files = new Map<string, LR2SkinFileEntry>([
      ['Other/Theme/Result/result_normal.csv', BYTES_A],
      ['Fallback/result_normal.csv', BYTES_B],
    ]);

    expect(resolveLR2IncludePath(files, 'missing', 'Theme/Result/result_normal.csv')).toBe(
      'Other/Theme/Result/result_normal.csv',
    );
  });
});

describe('resolveLR2AssetBytes', () => {
  it('returns already-loaded bytes via case-insensitive exact matching', () => {
    const skin = skinWithFiles(new Map([['LR2files/Theme/Parts.TGA', BYTES_A]]));

    expect(resolveLR2AssetBytes(skin, 'lr2files/theme/parts.tga')).toBe(BYTES_A);
  });

  it('matches wildcard asset declarations against the basename', () => {
    const skin = skinWithFiles(new Map([['LR2files/Theme/custom/blue-frame.png', BYTES_B]]));

    expect(resolveLR2AssetBytes(skin, 'custom/blue-*.png')).toBe(BYTES_B);
  });

  it('does not return lazy file entries from the synchronous resolver', () => {
    const file = new File([BYTES_A], 'parts.tga');
    const skin = skinWithFiles(new Map([['parts.tga', file]]));

    expect(resolveLR2AssetBytes(skin, 'parts.tga')).toBeUndefined();
  });
});

describe('LR2 asset path helpers', () => {
  it('normalizes LR2 backslash paths and leading dot prefixes', () => {
    expect(normalizeLR2Path(String.raw`.\Result\parts.tga`)).toBe('Result/parts.tga');
  });

  it('converts wildcard patterns into case-insensitive full-match regexps', () => {
    const regexp = wildcardToRegExp('parts_*.tga');
    expect(regexp.test('PARTS_CLEAR.tga')).toBe(true);
    expect(regexp.test('xparts_clear.tga')).toBe(false);
  });
});

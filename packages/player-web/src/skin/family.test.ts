import { describe, expect, test } from 'vitest';
import { beatorajaSkinFamily } from './beatoraja/family.ts';
import { defaultSkinFamily } from './default/family.ts';
import { createSkinFamilyRegistry, type SkinFamily } from './family.ts';
import { lr2SkinFamily } from './lr2/family.ts';
import { skinFamilyRegistry } from './registry.ts';

describe('SkinFamily definitions', () => {
  test('LR2 family matches `.lr2skin` paths case-insensitively', () => {
    expect(lr2SkinFamily.matchesThemeFile?.('Theme/LR2/Select/select.lr2skin')).toBe(true);
    expect(lr2SkinFamily.matchesThemeFile?.('themes/Default.LR2SKIN')).toBe(true);
    // The same predicate must reject obviously-not-LR2 theme files.
    expect(lr2SkinFamily.matchesThemeFile?.('beatoraja/skin/ModernChic/header.luaskin')).toBe(false);
    expect(lr2SkinFamily.matchesThemeFile?.('song/main.bms')).toBe(false);
  });

  test('beatoraja family matches `.luaskin` and `skin/*.json` indicators', () => {
    expect(beatorajaSkinFamily.matchesThemeFile?.('beatoraja/skin/ModernChic/header.luaskin')).toBe(true);
    expect(beatorajaSkinFamily.matchesThemeFile?.('beatoraja/skin/foo/config.json')).toBe(true);
    // A `.json` outside any `skin/` segment is ambiguous (every BMS pack ships `info.json` / `score.json`) and must
    // NOT trigger the beatoraja loader.
    expect(beatorajaSkinFamily.matchesThemeFile?.('song/info.json')).toBe(false);
    expect(beatorajaSkinFamily.matchesThemeFile?.('Theme/LR2/Select/select.lr2skin')).toBe(false);
  });

  test('default family deliberately exposes no matcher (fallthrough family)', () => {
    expect(defaultSkinFamily.matchesThemeFile).toBeUndefined();
  });
});

describe('skinFamilyRegistry', () => {
  test('exposes the three shipped families', () => {
    expect(skinFamilyRegistry.families.map((family) => family.id)).toEqual(['lr2', 'beatoraja', 'default']);
  });

  test('byId resolves each family or returns undefined', () => {
    expect(skinFamilyRegistry.byId('lr2')).toBe(lr2SkinFamily);
    expect(skinFamilyRegistry.byId('beatoraja')).toBe(beatorajaSkinFamily);
    expect(skinFamilyRegistry.byId('default')).toBe(defaultSkinFamily);
    expect(skinFamilyRegistry.byId('unknown' as 'lr2')).toBeUndefined();
  });

  test('detectThemeFile routes a path to the first matching family', () => {
    expect(skinFamilyRegistry.detectThemeFile('Theme/LR2/Select/select.lr2skin')?.id).toBe('lr2');
    expect(skinFamilyRegistry.detectThemeFile('beatoraja/skin/ModernChic/header.luaskin')?.id).toBe('beatoraja');
    // Unrecognised path → undefined (never the default family — that's the fallthrough, not a matcher).
    expect(skinFamilyRegistry.detectThemeFile('song/main.bms')).toBeUndefined();
    expect(skinFamilyRegistry.detectThemeFile('song/info.json')).toBeUndefined();
  });

  test('detectThemeFamilies aggregates ids across a file list', () => {
    const matched = skinFamilyRegistry.detectThemeFamilies([
      'Theme/LR2/Play/7keys/7_LL0.lr2skin',
      'beatoraja/skin/foo/skin.luaskin',
      'song/main.bms',
    ]);
    expect(matched.has('lr2')).toBe(true);
    expect(matched.has('beatoraja')).toBe(true);
    // Default never matches a file directly.
    expect(matched.has('default')).toBe(false);
  });

  test('detectThemeFamilies returns an empty set when no theme files match', () => {
    const matched = skinFamilyRegistry.detectThemeFamilies(['song/main.bms', 'song/main.bmson']);
    expect(matched.size).toBe(0);
  });
});

describe('createSkinFamilyRegistry', () => {
  test('honours the order passed to it (first-match-wins)', () => {
    // Construct two families with the same predicate to assert the iteration order rule.
    const firstMatchesAll: SkinFamily = {
      id: 'lr2',
      label: 'A',
      matchesThemeFile: () => true,
    };
    const secondMatchesAll: SkinFamily = {
      id: 'beatoraja',
      label: 'B',
      matchesThemeFile: () => true,
    };
    const registry = createSkinFamilyRegistry([firstMatchesAll, secondMatchesAll]);
    expect(registry.detectThemeFile('anything')).toBe(firstMatchesAll);
  });
});

import { latticeSkin, plainSkin, synesthesiaSkin } from '@be-music/player-browser/skin';
import type { BeMusicSkin } from '@be-music/player-skin-sdk';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import type { PlayerGUIState } from '../../types.ts';
import { BE_MUSIC_SKINS } from '../built-in-skins.ts';
import { BuiltInThemeService, type BuiltInThemeServiceOptions } from './built-in.ts';

function harness(state: Partial<Pick<PlayerGUIState, 'builtInSkin' | 'skinEffects'>> = {}): {
  service: BuiltInThemeService;
  options: BuiltInThemeServiceOptions;
  guiState: Pick<PlayerGUIState, 'builtInSkin' | 'skinEffects'>;
} {
  const guiState = { builtInSkin: synesthesiaSkin.id, skinEffects: 'full' as const, ...state };
  const options: BuiltInThemeServiceOptions = { guiState, setStatus: vi.fn(), handleBuiltInSkinChange: vi.fn() };
  return { service: new BuiltInThemeService(options), options, guiState };
}

beforeEach(() => {
  // `loadSkinFonts` asks `document.fonts` for an added skin's faces.
  vi.stubGlobal('document', { fonts: { load: vi.fn(async () => []) } });
  vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => {} }, confirm: vi.fn(() => false) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BuiltInThemeService', () => {
  test("the kit is the picked skin, the player's settings for it and the effect level, read as they change", () => {
    const { service, guiState } = harness({ skinEffects: 'reduced' });
    expect(service.builtInKit).toEqual({
      family: 'built-in',
      skin: synesthesiaSkin,
      settings: undefined,
      effects: 'reduced',
    });

    service.skinSettings.set(plainSkin.id, { accent: 'red' });
    guiState.builtInSkin = plainSkin.id;
    guiState.skinEffects = 'off';
    expect(service.beMusicSkin).toBe(plainSkin);
    expect(service.builtInKit).toEqual({
      family: 'built-in',
      skin: plainSkin,
      settings: { accent: 'red' },
      effects: 'off',
    });
  });

  test('an unknown skin id falls back to the first registered skin', () => {
    const { service } = harness({ builtInSkin: 'gone' });
    expect(service.beMusicSkin).toBe(BE_MUSIC_SKINS.skins[0]);
  });

  test('an added skin is registered, its fonts load and the scenes switch to it', () => {
    const { service, options } = harness();
    service.addBeMusicSkin(latticeSkin);
    expect(BE_MUSIC_SKINS.skins).toContain(latticeSkin);
    expect(document.fonts.load).toHaveBeenCalled();
    expect(options.handleBuiltInSkinChange).toHaveBeenCalledWith(latticeSkin.id);
    expect(options.setStatus).toHaveBeenLastCalledWith(
      `Added skin ${latticeSkin.label} ${latticeSkin.version} by ${latticeSkin.author.name}`,
    );
  });

  test('a skin that does not validate is refused, with the reason, and nothing switches', () => {
    const { service, options } = harness();
    const broken = { ...plainSkin, id: 'broken', apiVersion: 999 } as unknown as BeMusicSkin;
    service.addBeMusicSkin(broken);
    expect(BE_MUSIC_SKINS.skins).not.toContain(broken);
    expect(options.handleBuiltInSkinChange).not.toHaveBeenCalled();
    expect(vi.mocked(options.setStatus).mock.calls.at(-1)![0]).toMatch(/^Skin "broken" was not added: /);
  });

  test('a plain JavaScript skin without fontLoads is refused, not added and half-loaded', () => {
    const { service, options } = harness();
    const { fontLoads: _, ...rest } = plainSkin;
    const noFonts = { ...rest, id: 'no-fonts' } as unknown as BeMusicSkin;
    expect(() => service.addBeMusicSkin(noFonts)).not.toThrow();
    expect(BE_MUSIC_SKINS.skins).not.toContain(noFonts);
    expect(document.fonts.load).not.toHaveBeenCalled();
    expect(options.handleBuiltInSkinChange).not.toHaveBeenCalled();
    expect(vi.mocked(options.setStatus).mock.calls.at(-1)![0]).toMatch(/^Skin "no-fonts" was not added: fontLoads /);
  });

  test('a skin module is loaded from a URL only once one is given and the player confirms it', async () => {
    const { service, options } = harness();
    await service.addBeMusicSkinFromURL('  ');
    expect(options.setStatus).toHaveBeenLastCalledWith('Enter the URL of a skin module first');
    await service.addBeMusicSkinFromURL('https://skins.example/skin.js');
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(options.setStatus).toHaveBeenCalledOnce();
    expect(options.handleBuiltInSkinChange).not.toHaveBeenCalled();
  });
});

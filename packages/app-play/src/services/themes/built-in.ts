// The be-music skin the built-in family draws with: the one the Debug Menu picked (`guiState.builtInSkin`), the
// player's values for its settings, and the skins added while the page is open.

import type { BuiltInKit } from '@be-music/player-browser/host';
import type { BeMusicSkin } from '@be-music/player-skin-sdk';
import { readStoredSkinSettings, type StoredSkinSettings } from '../../skin-settings.ts';
import type { PlayerGUIState } from '../../types.ts';
import { BE_MUSIC_SKINS, loadSkinFonts } from '../built-in-skins.ts';

export interface BuiltInThemeServiceOptions {
  /** The Debug Menu's state: the built-in skin picked (`builtInSkin`) and how much motion skins show (`skinEffects`). */
  readonly guiState: Pick<PlayerGUIState, 'builtInSkin' | 'skinEffects'>;
  readonly setStatus: (text: string) => void;
  /** Switches to the skin `id`: it is stored, and the select screen is made again with it. */
  readonly handleBuiltInSkinChange: (id: string) => void;
}

/** The be-music skin the built-in screens draw with, the player's settings for each skin, and adding skins. */
export class BuiltInThemeService {
  /** Each be-music skin's `settings` values by skin id, persisted in `localStorage` and handed to its scenes. */
  public readonly skinSettings: StoredSkinSettings = readStoredSkinSettings();
  private readonly guiState: BuiltInThemeServiceOptions['guiState'];
  private readonly setStatus: BuiltInThemeServiceOptions['setStatus'];
  private readonly handleBuiltInSkinChange: BuiltInThemeServiceOptions['handleBuiltInSkinChange'];

  public constructor(options: BuiltInThemeServiceOptions) {
    this.guiState = options.guiState;
    this.setStatus = options.setStatus;
    this.handleBuiltInSkinChange = options.handleBuiltInSkinChange;
  }

  /** The be-music skin the default-family scenes render with. */
  public get beMusicSkin(): BeMusicSkin {
    return BE_MUSIC_SKINS.resolve(this.guiState.builtInSkin);
  }

  /** Registers `skin` (validated), loads its fonts, and switches to it; reports why when it is refused. */
  public addBeMusicSkin(skin: BeMusicSkin): void {
    const problems = BE_MUSIC_SKINS.add(skin);
    if (problems.length > 0) {
      this.setStatus(`Skin "${skin.id}" was not added: ${problems.join('; ')}`);
      return;
    }
    loadSkinFonts(skin);
    this.handleBuiltInSkinChange(skin.id);
    this.setStatus(`Added skin ${skin.label} ${skin.version} by ${skin.author.name}`);
  }

  /**
   * Imports a skin module from `url` and adds its default export. A skin is code that runs with this page's full
   * access, so the user confirms the source first.
   */
  public async addBeMusicSkinFromURL(url: string): Promise<void> {
    const trimmed = url.trim();
    if (!trimmed) {
      this.setStatus('Enter the URL of a skin module first');
      return;
    }
    if (
      !window.confirm(
        `Load the skin at ${trimmed}?\n\nA skin is code that runs with full access to this page. Only load skins you trust.`,
      )
    ) {
      return;
    }
    try {
      const module = (await import(/* @vite-ignore */ trimmed)) as { default?: BeMusicSkin };
      if (!module.default) {
        this.setStatus('That module has no default export to use as a skin');
        return;
      }
      this.addBeMusicSkin(module.default);
    } catch (error) {
      this.setStatus(`Could not load the skin: ${(error as Error).message}`);
    }
  }

  /** The stored values for the active be-music skin's settings, as handed to its scenes (`beMusicSkinSettings`). */
  public get beMusicSkinSettings(): Readonly<Record<string, unknown>> | undefined {
    return this.skinSettings.get(this.beMusicSkin.id);
  }

  /** The kit the built-in scenes draw with: the active be-music skin, its stored settings and the effect level. */
  public get builtInKit(): BuiltInKit {
    return {
      family: 'built-in',
      skin: this.beMusicSkin,
      settings: this.beMusicSkinSettings,
      effects: this.guiState.skinEffects,
    };
  }
}

// The skin-options panel for the beatoraja screen showing (`BeatorajaSkinOptionsGUI`, bottom centre): its skin's
// `property[]` / `filepath[]`. A change is kept for the entry and handed back to the app, which loads the skin again
// with it.

import type { BeatorajaSkinConfig, BeatorajaSkinHeader } from '@be-music/skin-beatoraja';
import type { PlayScene } from '@be-music/player-browser/host';
import type { BeatorajaPlayableVariant, BeatorajaSceneKitCaches } from '@be-music/player-browser/skin';
import { BeatorajaSkinOptionsGUI } from '../beatoraja-skin-options-gui.ts';

/** The beatoraja theme's play entry a play on the stage is drawn with. */
export interface ActiveBeatorajaPlay {
  readonly entryPath: string;
  readonly header: BeatorajaSkinHeader;
  readonly variant: BeatorajaPlayableVariant;
}

/** What the panel needs from the app: the beatoraja screens showing, their skins' options, and applying new ones. */
export interface BeatorajaSkinOptionsPanelDeps {
  /** The player shell, which the panel attaches to. */
  readonly container: HTMLElement;
  /** The beatoraja scene kit caches, whose `skinConfigs` keep the options the player picks for each entry. */
  readonly beatorajaKitCaches: Pick<BeatorajaSceneKitCaches, 'skinConfigs'>;
  /** The play: loading behind a decide screen, or on the stage. */
  gameplayView(): PlayScene | undefined;
  /** The beatoraja play entry the play on the stage is drawn with, when it plays on a beatoraja theme. */
  activeBeatorajaPlay(): ActiveBeatorajaPlay | undefined;
  /** The beatoraja select entry as last loaded, while a beatoraja select screen shows it. */
  beatorajaSelectKit(): { readonly entryPath: string; readonly header: BeatorajaSkinHeader } | undefined;
  /** The player's options for an entry, or its header's defaults. */
  beatorajaSkinConfig(entryPath: string, header: BeatorajaSkinHeader): BeatorajaSkinConfig;
  /** The files each of an entry's `filepath[]` wildcards matches in the theme. */
  collectBeatorajaFileCandidates(
    entryPath: string,
    header: BeatorajaSkinHeader,
  ): ReadonlyMap<string, ReadonlyArray<string>>;
  /** Loads the play's entry again with new options and hands it to the play on the stage. */
  applyBeatorajaPlaySkinConfig(entryPath: string, config: BeatorajaSkinConfig): Promise<void>;
  /** Loads the select entry again with new options and hands it to the select screen. */
  applyBeatorajaSelectSkinConfig(entryPath: string, config: BeatorajaSkinConfig): Promise<void>;
}

/** The skin-options panel for the beatoraja select screen or play showing. */
export class BeatorajaSkinOptionsPanel {
  /**
   * Bottom-right Tweakpane panel exposing the active beatoraja skin's `property[]` / `filepath[]` /
   * note-offset for live editing. Lazily constructed once `start()` mounts the host (the panel is
   * absolute-positioned inside the player shell so the shell needs to exist first).
   */
  private beatorajaSkinOptionsGUI: BeatorajaSkinOptionsGUI | undefined;
  private readonly deps: BeatorajaSkinOptionsPanelDeps;

  public constructor(deps: BeatorajaSkinOptionsPanelDeps) {
    this.deps = deps;
  }

  /**
   * The skin-options panel for the beatoraja play on the stage: its skin's `property[]` / `filepath[]`. A change reloads
   * the skin with the new options and hands it to the play (`applyBeatorajaPlaySkinConfig`), which carries on.
   */
  public refreshBeatorajaPlaySkinOptions(): void {
    const active = this.deps.activeBeatorajaPlay();
    if (active === undefined || this.deps.gameplayView()?.identity.family !== 'beatoraja') return;
    this.refreshBeatorajaSkinOptionsGUI({
      title: `Skin Config (Play ${active.variant}K)`,
      entryPath: active.entryPath,
      header: active.header,
      onApply: (nextConfig) => {
        void this.deps.applyBeatorajaPlaySkinConfig(active.entryPath, nextConfig);
      },
    });
  }

  /** The bottom-centre skin-options panel for the beatoraja select entry shown: its `property[]` / `filepath[]`. */
  public refreshBeatorajaSelectSkinOptions(): void {
    const shown = this.deps.beatorajaSelectKit();
    if (shown === undefined) return;
    this.refreshBeatorajaSkinOptionsGUI({
      title: 'Skin Config (Select)',
      entryPath: shown.entryPath,
      header: shown.header,
      onApply: (nextConfig) => {
        void this.deps.applyBeatorajaSelectSkinConfig(shown.entryPath, nextConfig);
      },
    });
  }

  /**
   * Lazily instantiate the skin-options panel. Deferred from the constructor because the player shell
   * (the parent the panel attaches to) doesn't exist until `app.innerHTML` materializes.
   */
  private ensureBeatorajaSkinOptionsGUI(): BeatorajaSkinOptionsGUI {
    if (this.beatorajaSkinOptionsGUI === undefined) {
      this.beatorajaSkinOptionsGUI = new BeatorajaSkinOptionsGUI({ container: this.deps.container });
    }
    return this.beatorajaSkinOptionsGUI;
  }

  /**
   * Update the bottom-centre skin-options panel for a freshly-mounted beatoraja scene. Subsequent
   * user changes flow back through `onChange` → cache update → scene re-mount.
   *
   * Skin selection itself is handled by the Debug Menu, not this panel — its skin pickers record the override and
   * apply it to the scene showing (`applyBeatorajaSkinSwitchIfActive`).
   */
  private refreshBeatorajaSkinOptionsGUI(args: {
    title: string;
    entryPath: string;
    header: BeatorajaSkinHeader;
    onApply: (updatedConfig: BeatorajaSkinConfig) => void;
  }): void {
    const config = this.deps.beatorajaSkinConfig(args.entryPath, args.header);
    const candidates = this.deps.collectBeatorajaFileCandidates(args.entryPath, args.header);
    const gui = this.ensureBeatorajaSkinOptionsGUI();
    gui.setSkin({
      title: args.title,
      // Forward the entry's stable path so `setSkin` can short-circuit when the same skin entry
      // is being reapplied (the round-trip after every controller tweak). Without this the GUI
      // tears down and rebuilds on every value change, snapping the panel back to its
      // initial collapsed state mid-edit.
      entryPath: args.entryPath,
      header: args.header,
      config,
      fileCandidates: candidates,
      onChange: (next) => {
        // Persist and notify the caller so it can re-mount the active scene with the new config.
        this.deps.beatorajaKitCaches.skinConfigs.set(args.entryPath, next);
        args.onApply(next);
      },
    });
  }

  /** Takes the panel down: the beatoraja screen it was for has gone. */
  public clear(): void {
    this.beatorajaSkinOptionsGUI?.clear();
  }
}

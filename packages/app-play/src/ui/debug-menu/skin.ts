// The Debug Menu's Skin & display folder, and the controls in it that follow what is loaded: the Skin system picker,
// the LR2 theme picker and the be-music skin's settings. They are built with the menu as `this` (`DebugMenu`).

import type { GUI } from 'lil-gui';
import { latticeSkin } from '@be-music/player-browser/skin';
import { resolveBeMusicSkinSettings } from '@be-music/player-skin-sdk';
import type { PlayLayoutChoice } from '../../device-profile.ts';
import { hasAnyLR2Skin } from '../../family-dispatch.ts';
import { toggleFullscreen } from '../../fullscreen.ts';
import { renderResolutionLabel, renderResolutionSteps, storeRenderResolution } from '../../render-resolution.ts';
import { BE_MUSIC_SKINS, EXTRA_BUILT_IN_SKINS_ENABLED } from '../../services/built-in-skins.ts';
import { storePlayLayout, storeSkinEffects } from '../../services/settings.ts';
import { describeSkinSettingControllers, setStoredSkinSetting, storeSkinSettings } from '../../skin-settings.ts';
import type { SkinFamilyOverride } from '../../types.ts';
import { DEBUG_MENU_FOLDERS, type DebugMenuFolder } from './folders.ts';
import type { DebugMenu } from './index.ts';
import { AUTO_DETECT_RESOLUTION_LABEL } from './render-resolution.ts';

/** How the skins look and lay out, the loaded themes' pickers, the be-music skin's settings, and adding skins. */
export function buildSkinFolder(
  this: DebugMenu,
  skin: GUI,
  addFolder: (parent: GUI, folder: DebugMenuFolder) => GUI,
): void {
  this.skinFolder = skin;
  // Skin family override — picks the active rendering family (LR2 / beatoraja / default) regardless of what's
  // loaded. First-time build seeds with `Auto` + `Default` only; `rebuildSkinFamilyPicker` swaps the option list
  // in place once a theme drop adds LR2 / beatoraja to the pool.
  this.rebuildSkinFamilyPicker();
  // Built-in (be-music) skin used whenever the default family renders — i.e. no LR2 / beatoraja theme covers the
  // scene. Persisted so a reload keeps the pick.
  const skinOptions = () => Object.fromEntries(BE_MUSIC_SKINS.skins.map((skin) => [skin.label, skin.id]));
  const skinPicker = skin
    .add(this.guiState, 'builtInSkin', skinOptions())
    .name('Built-in skin')
    .onChange((id: string) => {
      this.deps.handleBuiltInSkinChange(id);
    });
  // Skins added at runtime join the picker (in place: re-adding the controller would stack a second handler).
  BE_MUSIC_SKINS.subscribe(() => skinPicker.options(skinOptions()).updateDisplay());
  const skinEffects = skin
    .add(this.guiState, 'skinEffects', { Full: 'full', Reduced: 'reduced', Off: 'off' })
    .name('Skin effects')
    .onChange((level: 'full' | 'reduced' | 'off') => {
      storeSkinEffects(level);
      this.deps.handleSkinFamilyOverrideChange(this.guiState.skinFamilyOverride);
    });
  // Both make the select screen again, so they wait for the play to end.
  this.skinControllers.push(skinPicker, skinEffects);
  // Canvas pixels per CSS pixel, 1× up to the display's ratio. Lower trades sharpness for fill-rate (tablets drop
  // under 30 fps at 2×); applies from the next frame. `?resolution=` in the URL overrides it until a pick here.
  const resolutionSteps = renderResolutionSteps(window.devicePixelRatio || 1);
  this.resolutionPicker = skin
    .add(
      this.guiState,
      'renderResolution',
      Object.fromEntries(resolutionSteps.map((value) => [renderResolutionLabel(value), value])),
    )
    .name('Render resolution')
    .onChange((value: number) => {
      storeRenderResolution(value);
      this.sceneHost.setResolution(value);
    });
  // Measures the frame rate at each resolution on whatever screen is showing and keeps the highest that holds it.
  this.autoDetectResolutionControl = skin
    .add({ detect: () => void this.detectRenderResolution() }, 'detect')
    .name(AUTO_DETECT_RESOLUTION_LABEL);
  if (resolutionSteps.length < 2) this.autoDetectResolutionControl.hide();
  // Auto picks the touch layout on phones / tablets; applies from the next play.
  skin
    .add(this.guiState, 'playLayout', { Auto: 'auto', Desktop: 'standard', Touch: 'touch' })
    .name('Play layout')
    .onChange((choice: PlayLayoutChoice) => storePlayLayout(choice));
  // Picks between LR2 / beatoraja's "a judged note stays until its time" and "a judged note goes the moment it is
  // judged". Pushed live into the running gameplay view so a mid-song toggle takes effect on the very next paint — the
  // visibility check is a single per-frame branch with no backing state to rebuild.
  skin
    .add(this.guiState, 'judgedNoteDisplay', {
      'Keep until its time (LR2)': 'KEEP_SCROLLING',
      'Hide on judge': 'HIDE',
    })
    .name('Judged notes')
    .onChange((value: 'KEEP_SCROLLING' | 'HIDE') => {
      this.guiState.judgedNoteDisplay = value;
      this.gameplayView?.setJudgedNoteDisplay(value);
    });
  // The same toggle as double-clicking the playfield, for pointers where a double click is awkward.
  skin.add({ fullscreen: () => void toggleFullscreen(this.deps.shell) }, 'fullscreen').name('Toggle fullscreen');
  // "LR2 theme" (see `rebuildLR2ThemePicker`) slots in here, above the beatoraja pickers, once a drop carries themes.
  // Per-scene beatoraja skin picker, hidden until a beatoraja theme is dropped — `rebuildBeatorajaSkinPickers()`
  // re-populates it on each load. Selecting a non-default entry for a scene records it on
  // `beatorajaSkinOverridesByType`; the next mount picks it up via `pickBeatorajaSkinEntryWithOverride`.
  this.beatorajaSkinPickerFolder = addFolder(skin, DEBUG_MENU_FOLDERS.beatorajaSkins).hide();
  // The active be-music skin's own settings, built from its `settings` schema (rebuilt when the skin changes).
  this.skinSettingsFolder = addFolder(skin, DEBUG_MENU_FOLDERS.skinSettings);
  this.rebuildSkinSettingsFolder();
  // LR2 theme picker — added once a drop discovers a theme (see `rebuildLR2ThemePicker`).
  this.rebuildLR2ThemePicker();
  // Add skins: the bundled Lattice, or a skin module from a URL (its default export, built with the skin SDK).
  if (!EXTRA_BUILT_IN_SKINS_ENABLED) return;
  const addSkins = addFolder(skin, DEBUG_MENU_FOLDERS.addSkin);
  const skinSource = {
    url: '',
    addLattice: () => this.deps.addBeMusicSkin(latticeSkin),
    addFromURL: () => void this.deps.addBeMusicSkinFromURL(skinSource.url),
  };
  // Adding a skin switches to it, which makes the select screen again: the buttons wait for the play to end.
  this.skinControllers.push(addSkins.add(skinSource, 'addLattice').name('Add Lattice'));
  addSkins.add(skinSource, 'url').name('Skin module URL');
  this.skinControllers.push(addSkins.add(skinSource, 'addFromURL').name('Add from URL'));
}

/**
 * Rebuilds (or first-builds) the Debug Menu's "Skin family" dropdown. Called once during `buildGUI` and again
 * after every theme load / wipe so the available options track the loaded asset state. When the user's
 * previously-selected override becomes unavailable, silently resets to `'auto'` before swapping options in so
 * the dropdown never displays a value that wouldn't actually be honoured.
 *
 * Implementation detail: lil-gui's `Controller#options(values)` destroys the underlying controller and
 * recreates it in place — same approach the beatoraja per-scene skin picker uses, see
 * `rebuildBeatorajaSkinPickers`. The replacement preserves insertion order, so the dropdown stays where
 * `buildGUI` parked it (right after the `Open files` button).
 */
export function rebuildSkinFamilyPicker(this: DebugMenu): void {
  const gui = this.gui;
  if (gui === undefined) return;
  const lr2Available = hasAnyLR2Skin(this.deps.familyDispatchState());
  const beatorajaAvailable = this.deps.beatorajaTheme() !== undefined;
  // Snap back to 'auto' BEFORE rebuilding options so the freshly-built controller initialises to a valid value.
  // Without this guard a user-picked LR2 / beatoraja override that became unavailable mid-session would render
  // as a phantom dropdown value the runtime silently ignored.
  const override = this.guiState.skinFamilyOverride;
  if ((override === 'lr2' && !lr2Available) || (override === 'beatoraja' && !beatorajaAvailable)) {
    this.guiState.skinFamilyOverride = 'auto';
  }
  // The three skin systems are always listed; one without a loaded skin says so, and picking it asks for a drop.
  const options: Record<string, SkinFamilyOverride> = { 'Auto (prefer loaded theme)': 'auto' };
  options['Built-in'] = 'default';
  options[lr2Available ? 'LR2' : 'LR2 (drop a skin)'] = 'lr2';
  options[beatorajaAvailable ? 'beatoraja' : 'beatoraja (drop a skin)'] = 'beatoraja';
  if (this.skinFamilyController !== undefined) {
    // `OptionController#options(values)` updates the option list **in place** on an existing option controller
    // (see lil-gui v0.21.0 source: the subclass override mutates `_values` / `_names` + replaces the `<option>`
    // DOM nodes, returning `this`). The previously-attached `onChange` listener stays bound to the same
    // controller instance — re-attaching here would stack a second handler and fire `handleSkinFamilyOverrideChange`
    // twice per user pick. `updateDisplay()` is enough to snap the visible label to whatever value
    // `rebuildSkinFamilyPicker` just settled on (e.g. the silent revert to `'auto'` when the prior pick became
    // unavailable).
    this.skinFamilyController.options(options).updateDisplay();
    return;
  }
  // First-time build (called from `buildGUI` before any theme has been loaded).
  this.skinFamilyController = (this.skinFolder ?? gui)
    .add(this.guiState, 'skinFamilyOverride', options)
    .name('Skin system')
    .onChange((value: SkinFamilyOverride) => {
      const loaded =
        value === 'lr2'
          ? hasAnyLR2Skin(this.deps.familyDispatchState())
          : value === 'beatoraja'
            ? this.deps.beatorajaTheme() !== undefined
            : true;
      if (!loaded) {
        // Nothing of that system is loaded: stay on the current one and ask for a drop of its skin.
        this.deps.promptSkinDrop(value === 'lr2' ? 'lr2' : 'beatoraja');
        // Restored without `setValue`, which would run this handler again and rebuild the select screen for nothing.
        this.guiState.skinFamilyOverride = this.activeSkinSystem;
        this.skinFamilyController?.updateDisplay();
        return;
      }
      this.activeSkinSystem = value;
      this.deps.handleSkinFamilyOverrideChange(value);
    });
}

/**
 * Refills the "Skin settings" folder from the active be-music skin's `settings` schema — a dropdown per choice, a
 * slider per number, a checkbox per toggle — seeded with the stored values, and hides it when the skin declares none.
 * Every change is stored under the skin's id and reaches the scenes on screen at once.
 */
export function rebuildSkinSettingsFolder(this: DebugMenu): void {
  const folder = this.skinSettingsFolder;
  if (!folder) return;
  // `controllersRecursive` returns a copy, so destroying (which splices `folder.controllers`) is safe mid-loop.
  for (const controller of folder.controllersRecursive()) controller.destroy();
  const skin = this.deps.beMusicSkin();
  const controllers = describeSkinSettingControllers(skin.settings);
  folder.show(controllers.length > 0);
  if (controllers.length === 0) return;
  const values: Record<string, unknown> = { ...resolveBeMusicSkinSettings(skin, this.skinSettings.get(skin.id)) };
  for (const controller of controllers) {
    const added =
      controller.kind === 'dropdown'
        ? folder.add(values, controller.id, controller.options)
        : controller.kind === 'slider'
          ? folder.add(values, controller.id, controller.min, controller.max, controller.step)
          : folder.add(values, controller.id);
    added.name(controller.name).onChange((value: string | number | boolean) => {
      setStoredSkinSetting(this.skinSettings, skin.id, controller.id, value);
      storeSkinSettings(this.skinSettings);
      this.deps.applyBeMusicSkinSettings();
    });
  }
  folder
    .add(
      {
        reset: () => {
          this.skinSettings.delete(skin.id);
          storeSkinSettings(this.skinSettings);
          this.deps.applyBeMusicSkinSettings();
          this.rebuildSkinSettingsFolder();
        },
      },
      'reset',
    )
    .name('Reset to defaults');
}

/**
 * Builds (or rebuilds in place) the Debug Menu's "LR2 theme" dropdown. Visible whenever at least one theme has
 * been discovered from the dropped tree — a single-theme drop still gets the picker (with one option) so the
 * user can SEE which theme is active, and subsequent drops that add more themes flip it into a real switcher
 * without the picker disappearing and reappearing.
 *
 * Implementation detail: lil-gui's `OptionController#options(values)` updates the option list in-place on an
 * existing option controller (returns the same instance, preserves the attached `onChange` listener). Same
 * pattern the skin-family picker uses — keeps the controller's position in the panel stable across rebuilds.
 */
export function rebuildLR2ThemePicker(this: DebugMenu): void {
  const folder = this.skinFolder;
  if (folder === undefined) return;
  const themes = this.deps.availableLR2Themes();
  if (themes.length === 0) {
    // No discovered theme (drop didn't carry an `LR2files/Theme/<name>/` shape, OR LR2 isn't loaded at all).
    // Tear the controller down so the panel doesn't show a stale picker with options that no longer resolve.
    this.lr2ThemeController?.destroy();
    this.lr2ThemeController = undefined;
    return;
  }
  // `themes` is already alphabetised by `discoverLR2Themes`. Use the theme name as both the dropdown label and
  // the bound value — the picker proxy stores the name and `applyLR2ThemeByName` resolves it back to the files.
  const options: Record<string, string> = {};
  for (const theme of themes) {
    options[theme.name] = theme.name;
  }
  if (this.lr2ThemeController !== undefined) {
    this.lr2ThemeController.options(options).updateDisplay();
    return;
  }
  const proxy = { lr2Theme: this.deps.activeLR2ThemeName() ?? themes[0]!.name };
  this.lr2ThemeController = folder
    .add(proxy, 'lr2Theme', options)
    .name('LR2 theme')
    .onChange((value: string) => {
      // Hosting the proxy on a literal lets us re-read the picked name without leaking a separate `guiState`
      // field — the theme name is fully redundant with `activeLR2ThemeName`, which `mountLR2Theme` writes.
      // No-op when the user "picks" the already-active theme — `applyLR2ThemeByName` early-returns inside
      // `mountLR2Theme` since the same files re-mount to the same slots, but we still call through so a
      // hypothetical future code path that observes the picker change has a single chokepoint to subscribe to.
      void this.deps.applyLR2ThemeByName(value);
    });
  // A theme dropped during a play brings the picker in disabled, as the other skin controls are then.
  this.lr2ThemeController.enable(!this.playLock.skinControlsLocked);
  // lil-gui appends; move the row up next to the beatoraja pickers so the theme pickers read as one group.
  const beatorajaFolder = this.beatorajaSkinPickerFolder?.domElement;
  if (beatorajaFolder?.parentElement === folder.$children) {
    folder.$children.insertBefore(this.lr2ThemeController.domElement, beatorajaFolder);
  }
}

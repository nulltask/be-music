import { selectBinding, paneOptions } from '../../pane-controls.ts';
// The Debug Menu's Skin & display folder, and the controls in it that follow what is loaded: the Skin system picker,
// the LR2 theme picker and the be-music skin's settings. They are built with the menu as `this` (`DebugMenu`).
import type { FolderApi } from 'tweakpane';
import { latticeSkin } from '@be-music/player-browser/skin';
import { resolveBeMusicSkinSettings } from '@be-music/player-skin-sdk';
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
  skin: FolderApi,
  addFolder: (parent: FolderApi, folder: DebugMenuFolder) => FolderApi,
): void {
  this.skinFolder = skin;
  // Skin family override — picks the active rendering family (LR2 / beatoraja / default) regardless of what's
  // loaded. First-time build seeds with `Auto` + `Default` only; `rebuildSkinFamilyPicker` swaps the option list
  // in place once a theme drop adds LR2 / beatoraja to the pool.
  this.rebuildSkinFamilyPicker();
  // Built-in (be-music) skin used whenever the default family renders — i.e. no LR2 / beatoraja theme covers the
  // scene. Persisted so a reload keeps the pick.
  const skinOptions = () => Object.fromEntries(BE_MUSIC_SKINS.skins.map((skin) => [skin.label, skin.id]));
  const skinPicker = selectBinding(skin, this.guiState, 'builtInSkin', 'Built-in skin', skinOptions()).on(
    'change',
    ({ value: id }) => {
      this.deps.handleBuiltInSkinChange(id);
    },
  );
  // Skins added at runtime join the picker (in place: re-adding the controller would stack a second handler).
  BE_MUSIC_SKINS.subscribe(() => {
    skinPicker.options = paneOptions(skinOptions());
    skinPicker.refresh();
  });
  const skinEffects = selectBinding(skin, this.guiState, 'skinEffects', 'Skin effects', {
    Full: 'full',
    Reduced: 'reduced',
    Off: 'off',
  }).on('change', ({ value: level }) => {
    storeSkinEffects(level);
    this.deps.handleSkinFamilyOverrideChange(this.guiState.skinFamilyOverride);
  });
  // Both make the select screen again, so they wait for the play to end.
  this.skinControllers.push(skinPicker, skinEffects);
  // Canvas pixels per CSS pixel, 1× up to the display's ratio. Lower trades sharpness for fill-rate (tablets drop
  // under 30 fps at 2×); applies from the next frame. `?resolution=` in the URL overrides it until a pick here.
  const resolutionSteps = renderResolutionSteps(window.devicePixelRatio || 1);
  this.resolutionPicker = selectBinding(
    skin,
    this.guiState,
    'renderResolution',
    'Render resolution',
    Object.fromEntries(resolutionSteps.map((value) => [renderResolutionLabel(value), value])),
  ).on('change', ({ value }) => {
    storeRenderResolution(value);
    this.sceneHost.setResolution(value);
  });
  // Measures the frame rate at each resolution on whatever screen is showing and keeps the highest that holds it.
  this.autoDetectResolutionControl = skin
    .addButton({ title: AUTO_DETECT_RESOLUTION_LABEL })
    .on('click', () => void this.detectRenderResolution());
  if (resolutionSteps.length < 2) this.autoDetectResolutionControl.hidden = true;
  // Auto picks the touch layout on phones / tablets; applies from the next play.
  selectBinding(skin, this.guiState, 'playLayout', 'Play layout', {
    Auto: 'auto',
    Desktop: 'standard',
    Touch: 'touch',
  }).on('change', ({ value: choice }) => storePlayLayout(choice));
  // Picks between LR2 / beatoraja's "a judged note stays until its time" and "a judged note goes the moment it is
  // judged". Pushed live into the running gameplay view so a mid-song toggle takes effect on the very next paint — the
  // visibility check is a single per-frame branch with no backing state to rebuild.
  selectBinding(skin, this.guiState, 'judgedNoteDisplay', 'Judged notes', {
    'Keep until its time (LR2)': 'KEEP_SCROLLING',
    'Hide on judge': 'HIDE',
  }).on('change', ({ value }) => {
    this.guiState.judgedNoteDisplay = value;
    this.gameplayView?.setJudgedNoteDisplay(value);
  });
  // The same toggle as double-clicking the playfield, for pointers where a double click is awkward.
  skin.addButton({ title: 'Toggle fullscreen' }).on('click', () => void toggleFullscreen(this.deps.shell));
  // "LR2 theme" (see `rebuildLR2ThemePicker`) slots in here, above the beatoraja pickers, once a drop carries themes.
  // Per-scene beatoraja skin picker, hidden until a beatoraja theme is dropped — `rebuildBeatorajaSkinPickers()`
  // re-populates it on each load. Selecting a non-default entry for a scene records it on
  // `beatorajaSkinOverridesByType`; the next mount picks it up via `pickBeatorajaSkinEntryWithOverride`.
  this.beatorajaSkinPickerFolder = addFolder(skin, DEBUG_MENU_FOLDERS.beatorajaSkins);
  this.beatorajaSkinPickerFolder.hidden = true;
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
  this.skinControllers.push(addSkins.addButton({ title: 'Add Lattice' }).on('click', () => skinSource['addLattice']()));
  addSkins.addBinding(skinSource, 'url', { label: 'Skin module URL' });
  this.skinControllers.push(
    addSkins.addButton({ title: 'Add from URL' }).on('click', () => skinSource['addFromURL']()),
  );
}
/**
 * Rebuilds (or first-builds) the Debug Menu's "Skin family" dropdown. Called once during `buildGUI` and again
 * after every theme load / wipe so the available options track the loaded asset state. When the user's
 * previously-selected override becomes unavailable, silently resets to `'auto'` before swapping options in so
 * the dropdown never displays a value that wouldn't actually be honoured.
 *
 * The native list's mutable options preserve its position and previously attached change handler.
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
    // Update the public native list options, retaining the single change listener.
    this.skinFamilyController.options = paneOptions(options);
    this.skinFamilyController.refresh();
    return;
  }
  // First-time build (called from `buildGUI` before any theme has been loaded).
  this.skinFamilyController = selectBinding(
    this.skinFolder ?? gui,
    this.guiState,
    'skinFamilyOverride',
    'Skin system',
    options,
  ).on('change', ({ value }) => {
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
      this.skinFamilyController?.refresh();
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
  // Snapshot native children before disposing them; disposal removes them from the folder.
  for (const controller of folder.children.slice()) controller.dispose();
  const skin = this.deps.beMusicSkin();
  const controllers = describeSkinSettingControllers(skin.settings);
  folder.hidden = controllers.length === 0;
  if (controllers.length === 0) return;
  const values: Record<string, unknown> = { ...resolveBeMusicSkinSettings(skin, this.skinSettings.get(skin.id)) };
  for (const controller of controllers) {
    const added =
      controller.kind === 'dropdown'
        ? selectBinding(folder, values, controller.id, controller.id, controller.options)
        : controller.kind === 'slider'
          ? folder.addBinding(values, controller.id, {
              min: controller.min,
              max: controller.max,
              step: controller.step,
            })
          : folder.addBinding(values, controller.id);
    added.label = controller.name;
    added.on('change', ({ value }) => {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return;
      setStoredSkinSetting(this.skinSettings, skin.id, controller.id, value);
      storeSkinSettings(this.skinSettings);
      this.deps.applyBeMusicSkinSettings();
    });
  }
  folder.addButton({ title: 'Reset to defaults' }).on('click', () => {
    this.skinSettings.delete(skin.id);
    storeSkinSettings(this.skinSettings);
    this.deps.applyBeMusicSkinSettings();
    this.rebuildSkinSettingsFolder();
  });
}
/**
 * Builds (or rebuilds in place) the Debug Menu's "LR2 theme" dropdown. Visible whenever at least one theme has
 * been discovered from the dropped tree — a single-theme drop still gets the picker (with one option) so the
 * user can SEE which theme is active, and subsequent drops that add more themes flip it into a real switcher
 * without the picker disappearing and reappearing.
 *
 * Native mutable options keep the picker in place across theme discoveries.
 */
export function rebuildLR2ThemePicker(this: DebugMenu): void {
  const folder = this.skinFolder;
  if (folder === undefined) return;
  const themes = this.deps.availableLR2Themes();
  if (themes.length === 0) {
    // No discovered theme (drop didn't carry an `LR2files/Theme/<name>/` shape, OR LR2 isn't loaded at all).
    // Tear the controller down so the panel doesn't show a stale picker with options that no longer resolve.
    this.lr2ThemeController?.dispose();
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
    this.lr2ThemeController.options = paneOptions(options);
    this.lr2ThemeController.refresh();
    return;
  }
  const proxy = { lr2Theme: this.deps.activeLR2ThemeName() ?? themes[0]!.name };
  this.lr2ThemeController = selectBinding(folder, proxy, 'lr2Theme', 'LR2 theme', options).on('change', ({ value }) => {
    // Hosting the proxy on a literal lets us re-read the picked name without leaking a separate `guiState`
    // field — the theme name is fully redundant with `activeLR2ThemeName`, which `mountLR2Theme` writes.
    // No-op when the user "picks" the already-active theme — `applyLR2ThemeByName` early-returns inside
    // `mountLR2Theme` since the same files re-mount to the same slots, but we still call through so a
    // hypothetical future code path that observes the picker change has a single chokepoint to subscribe to.
    void this.deps.applyLR2ThemeByName(value);
  });
  // A theme dropped during a play brings the picker in disabled, as the other skin controls are then.
  this.lr2ThemeController.disabled = this.playLock.skinControlsLocked;
  // Reorder through the native container API, preserving the theme picker group.
  const before = this.beatorajaSkinPickerFolder;
  const index = before === undefined ? -1 : folder.children.indexOf(before);
  if (index >= 0) {
    folder.remove(this.lr2ThemeController);
    folder.add(this.lr2ThemeController, index);
  }
}

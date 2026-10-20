// The Debug Menu's "Beatoraja skins" pickers: one per scene type the loaded beatoraja theme ships, and the switch of
// the screen showing to the entry picked. They run with the menu as `this` (`DebugMenu`).

import { BEATORAJA_SKIN_TYPE, type BeatorajaSkinEntry } from '@be-music/skin-beatoraja';
import { playSkinTypeForVariant } from '../../demo-utils.ts';
import type { DebugMenu } from './index.ts';

/**
 * Repopulate the "Beatoraja skins" debug-menu folder with one dropdown per scene type that the
 * loaded theme actually ships an entry for. Called from `loadBeatorajaTheme` after each drop,
 * so the dropdowns always reflect the live `beatorajaTheme.entries` list.
 *
 * Each dropdown:
 *   - shows the scene's "best" entry (from theme discovery) as the default — selecting a
 *     different option sets `beatorajaSkinOverridesByType` and the next scene mount uses it
 *     via {@link pickBeatorajaSkinEntryWithOverride}.
 *   - labels options by `${header.name} (${entryPath})` so the user can disambiguate same-
 *     named skins from different folders.
 *   - is omitted entirely for scene types the loaded theme doesn't ship at all (so the panel
 *     stays compact). Single-entry types still get a dropdown so the user can see at a glance
 *     which file is mounted.
 */
export function rebuildBeatorajaSkinPickers(this: DebugMenu): void {
  const folder = this.beatorajaSkinPickerFolder;
  if (folder === undefined) return;
  // Tear down previous controllers so dropdown options match the current theme bundle. lil-gui
  // doesn't support live-updating an `add(target, prop, options)` controller's option list, so
  // recreating each time is the safe path.
  for (const controller of this.beatorajaSkinPickerControllers.values()) {
    controller.destroy();
  }
  this.beatorajaSkinPickerControllers.clear();
  const theme = this.deps.beatorajaTheme()?.theme;
  // Shown only while a beatoraja theme is loaded; an empty folder header would just be noise.
  folder.show(theme !== undefined);
  if (theme === undefined) return;
  // Order matters here — the folder lays controllers out in insertion order, so we keep the
  // play-variant types together (clustered by key count), then chrome scenes (select / decide
  // / result / etc.) below them.
  const sceneTypes: ReadonlyArray<{ typeCode: number; label: string; best?: BeatorajaSkinEntry }> = [
    { typeCode: BEATORAJA_SKIN_TYPE.PLAY_5KEYS, label: 'Play 5K', best: theme.playSkins['5'] },
    { typeCode: BEATORAJA_SKIN_TYPE.PLAY_7KEYS, label: 'Play 7K', best: theme.playSkins['7'] },
    { typeCode: BEATORAJA_SKIN_TYPE.PLAY_9KEYS, label: 'Play 9K', best: theme.playSkins['9'] },
    { typeCode: BEATORAJA_SKIN_TYPE.PLAY_10KEYS, label: 'Play 10K', best: theme.playSkins['10'] },
    { typeCode: BEATORAJA_SKIN_TYPE.PLAY_14KEYS, label: 'Play 14K', best: theme.playSkins['14'] },
    { typeCode: BEATORAJA_SKIN_TYPE.PLAY_24KEYS, label: 'Play 24K', best: theme.playSkins['24'] },
    { typeCode: BEATORAJA_SKIN_TYPE.PLAY_24KEYS_DOUBLE, label: 'Play 24K DP', best: theme.playSkins['24d'] },
    { typeCode: BEATORAJA_SKIN_TYPE.MUSIC_SELECT, label: 'Music Select', best: theme.selectSkin },
    { typeCode: BEATORAJA_SKIN_TYPE.DECIDE, label: 'Decide', best: theme.decideSkin },
    { typeCode: BEATORAJA_SKIN_TYPE.RESULT, label: 'Result', best: theme.resultSkin },
    { typeCode: BEATORAJA_SKIN_TYPE.COURSE_RESULT, label: 'Course Result', best: theme.courseResultSkin },
  ];
  for (const scene of sceneTypes) {
    const candidates = theme.entries.filter((entry) => entry.header.type === scene.typeCode);
    if (candidates.length === 0) continue;
    // Build a label → entryPath map. lil-gui shows the keys in the dropdown and writes the
    // matching value to the proxy. Using entryPath as the value lets us look up the entry on
    // change without keeping a separate index.
    const options: Record<string, string> = {};
    for (const entry of candidates) {
      const name = entry.header.name?.length ? entry.header.name : '(unnamed)';
      const label = `${name} (${entry.entryPath})`;
      options[label] = entry.entryPath;
    }
    // The proxy holds the currently-selected entryPath. Default to the discovery's best pick
    // so the dropdown reflects what would actually mount if no override is set.
    const proxy = { entryPath: scene.best?.entryPath ?? candidates[0]!.entryPath };
    const controller = folder
      .add(proxy, 'entryPath', options)
      .name(`${scene.label} (${candidates.length})`)
      .onChange((nextEntryPath: string) => {
        if (scene.best !== undefined && nextEntryPath === scene.best.entryPath) {
          // Picking the discovery default = "no override" — drop any prior override so future
          // theme rotations pick up the new "best" automatically.
          this.beatorajaSkinOverridesByType.delete(scene.typeCode);
        } else {
          this.beatorajaSkinOverridesByType.set(scene.typeCode, nextEntryPath);
        }
        // Live-apply: if the user's pick matches the currently-mounted scene type, re-mount it
        // immediately against the new entry. Without this the Debug Menu only takes effect on
        // the NEXT scene transition, which felt broken to the user (drop a theme, pick a skin,
        // nothing visible until you ESC and re-enter the scene).
        this.applyBeatorajaSkinSwitchIfActive(scene.typeCode, nextEntryPath, candidates);
      });
    this.beatorajaSkinPickerControllers.set(scene.typeCode, controller);
  }
}

/**
 * If the active scene's type-code matches `typeCode`, re-mount it against `entryPath`. Invoked
 * by the Debug Menu's skin-picker dropdown (the canonical surface for switching skins —
 * the bottom-centre `BeatorajaSkinOptionsGUI` only exposes the picked skin's authored
 * `property[]` / `filepath[]` schema, not the picker itself). No-op when no matching scene is
 * active (e.g., user picks a Decide skin while the Select scene is on screen — the override
 * still gets recorded by the caller for the next mount, but nothing visible changes now).
 *
 * `candidates` carries the dropdown's source list so we can recover the entry's `header` for
 * config-defaults seeding without re-loading the skin to read it back. The header is also
 * needed by `applyBeatoraja*SkinConfig` indirectly via the cached config map.
 */
export function applyBeatorajaSkinSwitchIfActive(
  this: DebugMenu,
  typeCode: number,
  entryPath: string,
  candidates: ReadonlyArray<BeatorajaSkinEntry>,
): void {
  const matched = candidates.find((entry) => entry.entryPath === entryPath);
  if (matched === undefined) return;
  const config = this.deps.beatorajaSkinConfig(entryPath, matched.header);
  if (typeCode === BEATORAJA_SKIN_TYPE.MUSIC_SELECT && this.selectView?.identity.family === 'beatoraja') {
    void this.deps.applyBeatorajaSelectSkinConfig(entryPath, config);
    return;
  }
  const play = this.deps.activeBeatorajaPlay();
  if (
    this.gameplayView?.identity.family === 'beatoraja' &&
    play !== undefined &&
    playSkinTypeForVariant(play.variant) === typeCode
  ) {
    void this.deps.applyBeatorajaPlaySkinConfig(entryPath, config);
  }
}

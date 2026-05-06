// Browser-side wiring for beatoraja themes.
//
// Mirrors `loadLr2ThemeSkinsFromFiles` from `@be-music/lr2-skin` so the host UI can keep its LR2 code path and pick
// up beatoraja themes through a parallel surface. The parser pipeline lives in `@be-music/beatoraja-skin`; this file
// only wires the dropped-File array up to that pipeline and doesn't open any PixiJS resources.

import {
  discoverBeatorajaTheme,
  loadBeatorajaSkin,
  pickBeatorajaPlaySkin,
  readFilesIntoBytesMap,
} from '@be-music/beatoraja-skin';
import type {
  BeatorajaPlaySkinMap,
  BeatorajaPlayVariant,
  BeatorajaSkinConfig,
  BeatorajaSkinEntry,
  BeatorajaSkinFileEntry,
  BeatorajaSkinHeader,
  BeatorajaSkinInputFile,
  BeatorajaTheme,
  BeatorajaThemeDiscoveryWarning,
} from '@be-music/beatoraja-skin';
import type { LoadProgressCallback } from './types.ts';

/** Single discovered skin entry, sized to live alongside its loaded byte map. */
export interface BeatorajaThemeBundle {
  /** All files the user dropped, indexed by case-insensitive lookup key. */
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>;
  /** Per-scene entries discovered from the bundle. */
  theme: BeatorajaTheme;
  /** Entries the discovery pass failed to parse. Surfaced for diagnostics; consumers can keep going. */
  warnings: ReadonlyArray<BeatorajaThemeDiscoveryWarning>;
}

export interface LoadBeatorajaThemeOptions {
  /**
   * Optional progress hook fired as files are read. The bundle parser is fast (<50ms for the reference theme), so the
   * dominant cost is reading file bytes off disk; the callback fires once per file as the read completes.
   */
  onProgress?: LoadProgressCallback;
}

/**
 * Read the dropped theme files into memory and discover every skin entry inside. Returns the file map alongside the
 * discovered theme so the caller can hand both to {@link loadBeatorajaPlaySkinFromBundle} when the user picks a
 * scene.
 */
export async function loadBeatorajaThemeFromFiles(
  files: ReadonlyArray<BeatorajaSkinInputFile>,
  options: LoadBeatorajaThemeOptions = {},
): Promise<BeatorajaThemeBundle> {
  const total = files.length;
  const fileMap = await readFilesIntoBytesMap(files, {
    onRead: (_path, current) => {
      options.onProgress?.({ phase: 'reading', current, total });
    },
  });
  const { theme, warnings } = discoverBeatorajaTheme(fileMap);
  return { files: fileMap, theme, warnings };
}

/**
 * Load the play skin for `desired` (or a fallback variant), evaluating the entry script against `skinConfig`.
 * Returns `undefined` when the bundle has no play skin for any variant.
 */
export function loadBeatorajaPlaySkinFromBundle(
  bundle: BeatorajaThemeBundle,
  desired: BeatorajaPlayVariant,
  skinConfig?: BeatorajaSkinConfig,
): { entry: BeatorajaSkinEntry; result: ReturnType<typeof loadBeatorajaSkin> } | undefined {
  const entry = pickBeatorajaPlaySkin(bundle.theme.playSkins, desired);
  if (entry === undefined) return undefined;
  const result = loadBeatorajaSkin({ entryPath: entry.entryPath, files: bundle.files, skinConfig });
  return { entry, result };
}

/**
 * Load the select skin from the bundle. Mirrors {@link loadBeatorajaPlaySkinFromBundle} for the song-select scene.
 */
export function loadBeatorajaSelectSkinFromBundle(
  bundle: BeatorajaThemeBundle,
  skinConfig?: BeatorajaSkinConfig,
): { entry: BeatorajaSkinEntry; result: ReturnType<typeof loadBeatorajaSkin> } | undefined {
  return loadSceneSkin(bundle, bundle.theme.selectSkin, skinConfig);
}

export function loadBeatorajaDecideSkinFromBundle(
  bundle: BeatorajaThemeBundle,
  skinConfig?: BeatorajaSkinConfig,
): { entry: BeatorajaSkinEntry; result: ReturnType<typeof loadBeatorajaSkin> } | undefined {
  return loadSceneSkin(bundle, bundle.theme.decideSkin, skinConfig);
}

export function loadBeatorajaResultSkinFromBundle(
  bundle: BeatorajaThemeBundle,
  skinConfig?: BeatorajaSkinConfig,
): { entry: BeatorajaSkinEntry; result: ReturnType<typeof loadBeatorajaSkin> } | undefined {
  return loadSceneSkin(bundle, bundle.theme.resultSkin, skinConfig);
}

function loadSceneSkin(
  bundle: BeatorajaThemeBundle,
  entry: BeatorajaSkinEntry | undefined,
  skinConfig?: BeatorajaSkinConfig,
): { entry: BeatorajaSkinEntry; result: ReturnType<typeof loadBeatorajaSkin> } | undefined {
  if (entry === undefined) return undefined;
  const result = loadBeatorajaSkin({ entryPath: entry.entryPath, files: bundle.files, skinConfig });
  return { entry, result };
}

/**
 * Compact textual summary of the play skins inside a bundle. Useful for logging "loaded play=7,14" lines next to the
 * LR2 equivalent.
 */
export function summarizeBeatorajaPlaySkins(playSkins: BeatorajaPlaySkinMap, separator = ','): string {
  const variants: BeatorajaPlayVariant[] = ['7', '5', '14', '10', '9', '24', '24d'];
  const present = variants.filter((v) => playSkins[v] !== undefined);
  return present.join(separator);
}

export type {
  BeatorajaPlaySkinMap,
  BeatorajaPlayVariant,
  BeatorajaSkinConfig,
  BeatorajaSkinEntry,
  BeatorajaSkinHeader,
  BeatorajaTheme,
};

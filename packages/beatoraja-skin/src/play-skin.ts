// Theme-bundle discovery for beatoraja skins.
//
// A "theme" in beatoraja is a directory tree under `skin/<name>/` containing one entry script per scene/variant.
// The host UI drops the directory, we walk the file map, classify each entry by `type`, and produce a
// {@link BeatorajaTheme} object whose fields point at the per-scene loaders.

import { dirname, normalizePath } from '@be-music/utils/core';
import {
  collectBeatorajaLuaModules,
  detectBeatorajaSkinFormat,
  extractBeatorajaSkinHeader,
  loadBeatorajaSkin,
} from './skin.ts';
import type { LoadBeatorajaSkinResult } from './skin.ts';
import { BEATORAJA_PLAY_VARIANTS, playVariantForSkinType, sceneForSkinType } from './types.ts';
import type { BeatorajaPlayVariant, BeatorajaSkinConfig, BeatorajaSkinHeader } from './types.ts';
import { asLoadedBytes, type BeatorajaSkinFileEntry } from './file-lookup.ts';
import { evaluateBeatorajaLuaSkin } from './lua.ts';
import { parseBeatorajaSkinJsonHeader } from './json.ts';

/**
 * Per-skin entry catalogued during theme discovery. Contains the parsed header (used to populate the selector UI)
 * plus the path the host should hand back to {@link loadBeatorajaSkin} once the user picks options.
 */
export interface BeatorajaSkinEntry {
  /** Path inside the theme bundle (e.g. `skin/default/play24.json`). */
  entryPath: string;
  /** Header summary harvested without running the skin's `main()`. */
  header: BeatorajaSkinHeader;
}

export type BeatorajaPlaySkinMap = Partial<Record<BeatorajaPlayVariant, BeatorajaSkinEntry>>;

export interface BeatorajaTheme {
  /** Best play-skin entry per variant. Multiple files can target the same variant; later-discovered files lose. */
  playSkins: BeatorajaPlaySkinMap;
  selectSkin?: BeatorajaSkinEntry;
  decideSkin?: BeatorajaSkinEntry;
  resultSkin?: BeatorajaSkinEntry;
  courseResultSkin?: BeatorajaSkinEntry;
  /** All entries discovered in the bundle. Useful for debugging or for custom UI. */
  entries: ReadonlyArray<BeatorajaSkinEntry>;
}

/** Diagnostics for entries that look like skins but failed to parse. */
export interface BeatorajaThemeDiscoveryWarning {
  entryPath: string;
  message: string;
}

export interface DiscoverBeatorajaThemeResult {
  theme: BeatorajaTheme;
  warnings: BeatorajaThemeDiscoveryWarning[];
}

/**
 * Walk `files` for skin entry candidates and classify each. JSON skins are parsed for their `type` field; Lua skins
 * are evaluated with `skin_config = nil` to harvest the header table.
 *
 * The walk is bounded — only `*.json` and `*.luaskin` files are inspected, so a theme with hundreds of unrelated
 * assets stays cheap.
 */
export function discoverBeatorajaTheme(
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
): DiscoverBeatorajaThemeResult {
  const warnings: BeatorajaThemeDiscoveryWarning[] = [];
  const entries: BeatorajaSkinEntry[] = [];

  for (const [path, entry] of files) {
    const format = detectBeatorajaSkinFormat(path);
    if (format === undefined) continue;
    if (!isBeatorajaSkinPath(path)) continue;
    const bytes = asLoadedBytes(entry);
    if (bytes === undefined) {
      // Deferred handles can't be parsed synchronously; theme discovery is best-effort. Skip and move on.
      continue;
    }
    try {
      const header = readHeader(bytes, path, format, files);
      entries.push({ entryPath: normalizePath(path), header });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      warnings.push({ entryPath: normalizePath(path), message });
    }
  }

  const theme = buildTheme(entries);
  return { theme, warnings };
}

/**
 * Decide whether `candidate` should replace `incumbent` for a given scene slot. We can't unconditionally take the
 * first hit because the bundled beatoraja folder ships TWO themes (`skin/default/`, `skin/GdbG_Skin/`, …) and
 * each one provides its own copy of every variant. Without a tiebreaker the default theme — the only one our
 * renderer can fully drive without engine-side `main_state` integration — gets shadowed by whichever theme is
 * encountered last during folder iteration.
 *
 * Tiebreakers (top wins):
 *   1. JSON entry beats Lua entry (parsed deterministically, no host-module stubs needed).
 *   2. Path containing `/default/` beats other themes (the only fully-renderable theme today).
 *   3. Lexicographically earlier path wins.
 */
function preferEntry(candidate: BeatorajaSkinEntry, incumbent: BeatorajaSkinEntry): boolean {
  const candIsJson = candidate.entryPath.toLowerCase().endsWith('.json');
  const incIsJson = incumbent.entryPath.toLowerCase().endsWith('.json');
  if (candIsJson !== incIsJson) return candIsJson;
  const candIsDefault = isDefaultThemePath(candidate.entryPath);
  const incIsDefault = isDefaultThemePath(incumbent.entryPath);
  if (candIsDefault !== incIsDefault) return candIsDefault;
  return candidate.entryPath < incumbent.entryPath;
}

function isDefaultThemePath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.includes('/skin/default/') || lower.startsWith('skin/default/');
}

/**
 * Restrict skin discovery to paths under a `skin/` segment. Beatoraja's user-data tree (`practice/<sha>.json`,
 * `player/<id>/config_player.json`, `score/...`, etc.) lives inside the same dropped folder but isn't a skin —
 * accepting them produces noisy parse-error warnings for files that were never meant to be skins. `.luaskin` is
 * unambiguously a skin entry, so we admit it from anywhere.
 */
function isBeatorajaSkinPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith('.luaskin')) return true;
  // Skin JSON conventionally lives at `<bundle>/skin/<theme>/...`. Match a `/skin/` segment OR a leading `skin/`.
  return lower.includes('/skin/') || lower.startsWith('skin/');
}

function readHeader(
  bytes: Uint8Array,
  entryPath: string,
  format: 'json' | 'lua',
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
): BeatorajaSkinHeader {
  if (format === 'json') {
    return parseBeatorajaSkinJsonHeader(bytes);
  }
  const modules = collectBeatorajaLuaModules(files, dirname(normalizePath(entryPath)));
  const result = evaluateBeatorajaLuaSkin({ entry: bytes, entryName: entryPath, modules });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  if (result.value === null || typeof result.value !== 'object' || Array.isArray(result.value)) {
    throw new Error('Lua skin returned a non-object header');
  }
  return extractBeatorajaSkinHeader(result.value as Readonly<Record<string, unknown>>);
}

function buildTheme(entries: ReadonlyArray<BeatorajaSkinEntry>): BeatorajaTheme {
  const playSkins: BeatorajaPlaySkinMap = {};
  let selectSkin: BeatorajaSkinEntry | undefined;
  let decideSkin: BeatorajaSkinEntry | undefined;
  let resultSkin: BeatorajaSkinEntry | undefined;
  let courseResultSkin: BeatorajaSkinEntry | undefined;

  for (const entry of entries) {
    const scene = sceneForSkinType(entry.header.type);
    const variant = playVariantForSkinType(entry.header.type);
    if (scene === 'play' && variant !== undefined) {
      const existing = playSkins[variant];
      if (existing === undefined || preferEntry(entry, existing)) {
        playSkins[variant] = entry;
      }
      continue;
    }
    if (scene === 'select' && (selectSkin === undefined || preferEntry(entry, selectSkin))) selectSkin = entry;
    else if (scene === 'decide' && (decideSkin === undefined || preferEntry(entry, decideSkin))) decideSkin = entry;
    else if (scene === 'result' && (resultSkin === undefined || preferEntry(entry, resultSkin))) resultSkin = entry;
    else if (scene === 'course-result' && (courseResultSkin === undefined || preferEntry(entry, courseResultSkin)))
      courseResultSkin = entry;
  }

  return {
    playSkins,
    selectSkin,
    decideSkin,
    resultSkin,
    courseResultSkin,
    entries,
  };
}

/**
 * Order of variants the play scene should fall back through when the chart's native variant is missing. Mirrors
 * LR2's fallback chain so song-select can switch into a playable layout even if the user shipped a single variant.
 */
const PLAY_SKIN_FALLBACKS: Record<BeatorajaPlayVariant, ReadonlyArray<BeatorajaPlayVariant>> = {
  '7': ['7', '14', '5', '10', '9', '24', '24d'],
  '5': ['5', '7', '14', '10', '9', '24', '24d'],
  '14': ['14', '24d', '7', '10', '5', '9', '24'],
  '10': ['10', '14', '7', '5', '9', '24', '24d'],
  '9': ['9', '7', '14', '5', '10', '24', '24d'],
  '24': ['24', '24d', '14', '7', '10', '5', '9'],
  '24d': ['24d', '24', '14', '7', '10', '5', '9'],
};

export function pickBeatorajaPlaySkin(
  playSkins: BeatorajaPlaySkinMap,
  desired: BeatorajaPlayVariant,
): BeatorajaSkinEntry | undefined {
  const order = PLAY_SKIN_FALLBACKS[desired];
  for (const v of order) {
    const skin = playSkins[v];
    if (skin) return skin;
  }
  // As a last resort, return any present skin.
  for (const v of BEATORAJA_PLAY_VARIANTS) {
    const skin = playSkins[v];
    if (skin) return skin;
  }
  return undefined;
}

/**
 * Convenience wrapper: discover the theme, pick the right play skin for `desired`, and return the loaded skin.
 *
 * Does NOT preserve the previously-evaluated header — it re-runs the entry script with the user's `skinConfig`
 * applied. Callers that need both the header and the skin should call {@link discoverBeatorajaTheme} first to drive
 * the option picker, then this function once the user confirms.
 */
export function loadBeatorajaPlaySkin(
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
  entry: BeatorajaSkinEntry,
  skinConfig?: BeatorajaSkinConfig,
): LoadBeatorajaSkinResult {
  return loadBeatorajaSkin({ entryPath: entry.entryPath, files, skinConfig });
}

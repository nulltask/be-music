// Theme-bundle discovery for beatoraja skins.
//
// A "theme" in beatoraja is a directory tree under `skin/<name>/` containing one entry script per scene/variant.
// The host UI drops the directory, we walk the file map, classify each entry by `type`, and produce a
// {@link BeatorajaTheme} object whose fields point at the per-scene loaders.

import { dirname, normalizePath } from '@be-music/shared-utils/core';
import {
  collectBeatorajaLuaModules,
  detectBeatorajaSkinFormat,
  extractBeatorajaSkinHeader,
  loadBeatorajaSkin,
} from './skin.ts';
import type { LoadBeatorajaSkinResult } from './skin.ts';
import { playVariantForSkinType, sceneForSkinType } from './types.ts';
import type { BeatorajaPlayVariant, BeatorajaSkinConfig, BeatorajaSkinHeader } from './types.ts';
import { asLoadedBytes, type BeatorajaSkinFileEntry } from './file-lookup.ts';
import { evaluateBeatorajaLuaSkin } from './lua.ts';
import { parseBeatorajaSkinJSONHeader } from './json.ts';

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
    const conventionalPath = isBeatorajaSkinPath(path);
    const bytes = asLoadedBytes(entry);
    if (bytes === undefined) {
      // Deferred handles can't be parsed synchronously; theme discovery is best-effort. Skip and move on.
      continue;
    }
    try {
      const header = readHeader(bytes, path, format, files);
      // A theme folder may be dropped directly, losing the enclosing skin/ directory. Admit its JSON headers
      // by shape while keeping unrelated player/practice JSON quiet in a whole-installation drop.
      if (
        !conventionalPath &&
        !(
          Number.isInteger(header.type) &&
          header.type >= 0 &&
          typeof header.name === 'string' &&
          Number.isFinite(header.w) &&
          header.w > 0 &&
          Number.isFinite(header.h) &&
          header.h > 0
        )
      )
        continue;
      entries.push({ entryPath: normalizePath(path), header });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (conventionalPath) warnings.push({ entryPath: normalizePath(path), message });
    }
  }

  const theme = buildTheme(entries);
  return { theme, warnings };
}

/**
 * Decide whether `candidate` should replace `incumbent` for a given scene slot. We can't unconditionally take the
 * first hit because a whole-installation drop can contain several themes for the same scene.
 * Prefer JSON over Lua, the conventional skin/default path over other themes, then the lexicographically earlier
 * path. Explicit user selections override this initial discovery order in the host.
 */
function preferEntry(candidate: BeatorajaSkinEntry, incumbent: BeatorajaSkinEntry): boolean {
  const candIsJSON = candidate.entryPath.toLowerCase().endsWith('.json');
  const incIsJSON = incumbent.entryPath.toLowerCase().endsWith('.json');
  if (candIsJSON !== incIsJSON) return candIsJSON;
  const candIsDefault = isDefaultThemePath(candidate.entryPath);
  const incIsDefault = isDefaultThemePath(incumbent.entryPath);
  if (candIsDefault !== incIsDefault) return candIsDefault;
  return candidate.entryPath < incumbent.entryPath;
}

function isDefaultThemePath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.includes('/skin/default/') || lower.startsWith('skin/default/');
}

/** Conventional skin paths receive parse diagnostics; standalone JSON files are admitted by header shape. */
function isBeatorajaSkinPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith('.luaskin')) return true;
  // Whole-installation JSON skins conventionally live at <bundle>/skin/<theme>/.
  return lower.includes('/skin/') || lower.startsWith('skin/');
}

function readHeader(
  bytes: Uint8Array,
  entryPath: string,
  format: 'json' | 'lua',
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
): BeatorajaSkinHeader {
  if (format === 'json') {
    return parseBeatorajaSkinJSONHeader(bytes);
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
 * The variants a play falls back through, in order, when the theme has no skin for the chart's own (first in each
 * list). Every list names all seven variants, so any theme with a play skin yields one.
 *
 * beatoraja itself never falls back across play modes: a play loads the skin configured for its mode's `SkinType`, or
 * that type's built-in default (`SkinLoader.load`, `SkinConfig.Default`). The one reuse across modes it has is offering
 * an LR2 7 KEY / 14 KEY skin for 5 KEY / 10 KEY (`SkinConfigurationView` and `SkinConfiguration`), so 5 falls back to 7
 * and 10 to 14 first. A theme dropped into Be-Music has no built-in default behind it, so the rest of each list picks
 * the closest shape: the That-Which-Must-Not-Be-Named and POPN variants keep to themselves before trying the keyboard ones, and the keyboard
 * variants try each other first, since a keyboard chart on an That-Which-Must-Not-Be-Named skin draws its extra lanes on the host's fallback
 * playfield.
 */
const PLAY_SKIN_FALLBACKS: Readonly<Record<BeatorajaPlayVariant, ReadonlyArray<BeatorajaPlayVariant>>> = {
  '7': ['7', '14', '5', '10', '9', '24', '24d'],
  '5': ['5', '7', '14', '10', '9', '24', '24d'],
  '14': ['14', '7', '10', '5', '9', '24d', '24'],
  '10': ['10', '14', '7', '5', '9', '24d', '24'],
  '9': ['9', '7', '14', '5', '10', '24', '24d'],
  '24': ['24', '24d', '9', '7', '14', '5', '10'],
  '24d': ['24d', '24', '9', '14', '7', '10', '5'],
};

/**
 * The variant whose skin plays a `desired` chart: `desired` when the theme has it, otherwise the first variant down its
 * fallback list the theme ships. `undefined` only when the theme has no play skin at all.
 */
export function pickBeatorajaPlaySkinVariant(
  playSkins: BeatorajaPlaySkinMap,
  desired: BeatorajaPlayVariant,
): BeatorajaPlayVariant | undefined {
  return PLAY_SKIN_FALLBACKS[desired].find((variant) => playSkins[variant] !== undefined);
}

/** The play skin entry for a `desired` chart (see {@link pickBeatorajaPlaySkinVariant}). */
export function pickBeatorajaPlaySkin(
  playSkins: BeatorajaPlaySkinMap,
  desired: BeatorajaPlayVariant,
): BeatorajaSkinEntry | undefined {
  const variant = pickBeatorajaPlaySkinVariant(playSkins, desired);
  return variant === undefined ? undefined : playSkins[variant];
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

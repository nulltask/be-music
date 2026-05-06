// Theme-bundle discovery for beatoraja skins.
//
// A "theme" in beatoraja is a directory tree under `skin/<name>/` containing one entry script per scene/variant.
// The host UI drops the directory, we walk the file map, classify each entry by `type`, and produce a
// {@link BeatorajaTheme} object whose fields point at the per-scene loaders.

import { dirname, normalizePath } from '@be-music/utils/core';
import { detectBeatorajaSkinFormat, loadBeatorajaSkin } from './beatoraja-skin.ts';
import type { LoadBeatorajaSkinResult } from './beatoraja-skin.ts';
import { BEATORAJA_PLAY_VARIANTS, playVariantForSkinType, sceneForSkinType } from './beatoraja-skin-types.ts';
import type { BeatorajaPlayVariant, BeatorajaSkinConfig, BeatorajaSkinHeader } from './beatoraja-skin-types.ts';
import { asLoadedBytes, type BeatorajaSkinFileEntry } from './file-lookup.ts';
import { evaluateBeatorajaLuaSkin } from './beatoraja-skin-lua.ts';
import { parseBeatorajaSkinJsonHeader } from './beatoraja-skin-json.ts';

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
  gradeResultSkin?: BeatorajaSkinEntry;
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
  // Lua header pass.
  const baseDir = dirname(normalizePath(entryPath));
  const modules: { name: string; source: Uint8Array }[] = [];
  const baseDirLower = baseDir.toLowerCase();
  const parentDirLower = dirname(baseDir).toLowerCase();
  for (const [path, entry] of files) {
    if (!path.toLowerCase().endsWith('.lua')) continue;
    const lower = path.toLowerCase();
    const slash = lower.lastIndexOf('/');
    const fileDir = slash >= 0 ? lower.slice(0, slash) : '';
    if (fileDir !== baseDirLower && fileDir !== parentDirLower) continue;
    const name = path.slice(slash + 1, -'.lua'.length);
    const source = asLoadedBytes(entry);
    if (source === undefined) continue;
    // Same-dir wins over parent-dir on conflict.
    const existing = modules.find((m) => m.name === name);
    if (existing) {
      if (fileDir === baseDirLower) {
        existing.source = source;
      }
      continue;
    }
    modules.push({ name, source });
  }
  const result = evaluateBeatorajaLuaSkin({ entry: bytes, entryName: entryPath, modules });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  if (result.value === null || typeof result.value !== 'object' || Array.isArray(result.value)) {
    throw new Error('Lua skin returned a non-object header');
  }
  const obj = result.value as Record<string, unknown>;
  return {
    type: typeof obj.type === 'number' ? obj.type : 0,
    name: typeof obj.name === 'string' ? obj.name : undefined,
    author: typeof obj.author === 'string' ? obj.author : undefined,
    w: typeof obj.w === 'number' ? obj.w : 0,
    h: typeof obj.h === 'number' ? obj.h : 0,
    playstart: typeof obj.playstart === 'number' ? obj.playstart : undefined,
    scene: typeof obj.scene === 'number' ? obj.scene : undefined,
    input: typeof obj.input === 'number' ? obj.input : undefined,
    close: typeof obj.close === 'number' ? obj.close : undefined,
    fadeout: typeof obj.fadeout === 'number' ? obj.fadeout : undefined,
    finishmargin: typeof obj.finishmargin === 'number' ? obj.finishmargin : undefined,
    property: Array.isArray(obj.property) ? (obj.property as BeatorajaSkinHeader['property']) : undefined,
    filepath: Array.isArray(obj.filepath) ? (obj.filepath as BeatorajaSkinHeader['filepath']) : undefined,
    offset: typeof obj.offset === 'number' ? obj.offset : undefined,
  };
}

function buildTheme(entries: ReadonlyArray<BeatorajaSkinEntry>): BeatorajaTheme {
  const playSkins: BeatorajaPlaySkinMap = {};
  let selectSkin: BeatorajaSkinEntry | undefined;
  let decideSkin: BeatorajaSkinEntry | undefined;
  let resultSkin: BeatorajaSkinEntry | undefined;
  let courseResultSkin: BeatorajaSkinEntry | undefined;
  let gradeResultSkin: BeatorajaSkinEntry | undefined;

  for (const entry of entries) {
    const scene = sceneForSkinType(entry.header.type);
    const variant = playVariantForSkinType(entry.header.type);
    if (scene === 'play' && variant !== undefined) {
      // Prefer JSON over Lua when both are present for the same variant — JSON is faster and parsing-deterministic.
      const existing = playSkins[variant];
      if (existing === undefined || (entry.entryPath.endsWith('.json') && existing.entryPath.endsWith('.luaskin'))) {
        playSkins[variant] = entry;
      }
      continue;
    }
    if (scene === 'select' && selectSkin === undefined) selectSkin = entry;
    else if (scene === 'decide' && decideSkin === undefined) decideSkin = entry;
    else if (scene === 'result' && resultSkin === undefined) resultSkin = entry;
    else if (scene === 'course-result' && courseResultSkin === undefined) courseResultSkin = entry;
    else if (scene === 'grade-result' && gradeResultSkin === undefined) gradeResultSkin = entry;
  }

  return {
    playSkins,
    selectSkin,
    decideSkin,
    resultSkin,
    courseResultSkin,
    gradeResultSkin,
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

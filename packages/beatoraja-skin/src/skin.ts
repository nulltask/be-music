// Top-level loader for beatoraja skins.
//
// Whether the skin entry is a `.json` (static) or a `.luaskin` (script), the loader produces the same
// {@link BeatorajaSkinHeader} for the selector UI and {@link BeatorajaSkin} after the user has confirmed their
// custom-option / custom-file picks.

import { dirname, normalizePath } from '@be-music/utils/core';
import { asLoadedBytes, findCaseInsensitivePath, type BeatorajaSkinFileEntry } from './file-lookup.ts';
import { parseBeatorajaSkinJson, parseBeatorajaSkinJsonHeader } from './json.ts';
import { evaluateBeatorajaLuaSkin, type BeatorajaLuaModuleSource, type BeatorajaLuaRuntimeContext } from './lua.ts';
import { normalizeBeatorajaSkinCustomOffsets } from './types.ts';
import type { BeatorajaSkin, BeatorajaSkinConfig, BeatorajaSkinHeader } from './types.ts';

export type BeatorajaSkinFormat = 'json' | 'lua';

export function detectBeatorajaSkinFormat(entryPath: string): BeatorajaSkinFormat | undefined {
  const lower = entryPath.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.luaskin')) return 'lua';
  return undefined;
}

export interface LoadBeatorajaSkinOptions {
  /**
   * Path to the entry skin file (relative to the dropped theme root). Used to resolve `path` fields and to discover
   * sibling `.lua` modules for `require()`.
   */
  entryPath: string;
  /** All theme files the host has provided. May contain deferred byte handles for large assets. */
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>;
  /**
   * User's custom-option / custom-file picks. Pass `undefined` for the header-discovery pass so the Lua script
   * returns just the schema. Ignored for JSON skins (which are static).
   */
  skinConfig?: BeatorajaSkinConfig;
  /**
   * Optional runtime context for `main_state` accessors invoked at skin-load time. See
   * {@link EvaluateBeatorajaLuaSkinOptions.runtimeContext} for the full rationale — short
   * version: ModernChic-style themes call `main_state.option(MAIN.OP.DIFFICULTY1..)` from
   * inside `main()` to pre-compute per-difficulty RGB triples; without a context the accessor
   * returns `false` and the Lua eval crashes when the resulting `nil` is indexed. Hosts that
   * know the chart's classification (difficulty / judge rank / etc.) should pass a context
   * whose `option` reflects the chart's ops.
   */
  runtimeContext?: BeatorajaLuaRuntimeContext;
}

export type LoadBeatorajaSkinResult =
  | {
      ok: true;
      /** Always populated. Header fields are also present on `skin` when {@link skin} is set. */
      header: BeatorajaSkinHeader;
      /**
       * Full skin definition. Populated when {@link LoadBeatorajaSkinOptions.skinConfig} was supplied OR when the
       * entry is a JSON skin (which has no header-only mode). `undefined` when the caller asked for header-only.
       */
      skin?: BeatorajaSkin;
      format: BeatorajaSkinFormat;
    }
  | {
      ok: false;
      error: { message: string };
    };

/**
 * Read the entry file and return either the full skin tree or just the header schema, depending on
 * {@link LoadBeatorajaSkinOptions.skinConfig}. The Lua path runs `evaluateBeatorajaLuaSkin` with `skin_config = nil`
 * for header discovery and a populated config for the second phase. JSON skins always return the full skin (the
 * `if`/`values` conditional resolution still happens at render time).
 */
export function loadBeatorajaSkin(options: LoadBeatorajaSkinOptions): LoadBeatorajaSkinResult {
  const format = detectBeatorajaSkinFormat(options.entryPath);
  if (format === undefined) {
    return { ok: false, error: { message: `unsupported skin entry: ${options.entryPath}` } };
  }
  const entryKey = findCaseInsensitivePath(options.files, normalizePath(options.entryPath));
  if (entryKey === undefined) {
    return { ok: false, error: { message: `entry file not found: ${options.entryPath}` } };
  }
  const entryBytes = asLoadedBytes(options.files.get(entryKey));
  if (entryBytes === undefined) {
    return { ok: false, error: { message: `entry file is deferred / unreadable: ${options.entryPath}` } };
  }

  if (format === 'json') {
    try {
      const skin = parseBeatorajaSkinJson(entryBytes);
      const header = parseBeatorajaSkinJsonHeader(entryBytes);
      return { ok: true, header, skin, format };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, error: { message: `failed to parse JSON skin '${options.entryPath}': ${message}` } };
    }
  }

  // Lua path.
  const baseDir = dirname(normalizePath(entryKey));
  const modules = collectBeatorajaLuaModules(options.files, baseDir);
  // Translate the host-facing `BeatorajaSkinConfig` into the Lua-bridge shape
  // (`BeatorajaLuaSkinConfig`). The Lua `skin_config.offset` table reads from `customOffset`
  // (the per-name record); the chart timing `offset` number is host-only and not surfaced to
  // Lua. Skins relying on `skin_config.offset[name]` (ModernChic et al.) get a populated
  // table when the user has picked offsets, an empty table with default-zero `__index`
  // otherwise.
  const luaSkinConfig =
    options.skinConfig === undefined
      ? undefined
      : {
          ...options.skinConfig,
          offset: options.skinConfig.customOffset,
        };
  const evalResult = evaluateBeatorajaLuaSkin({
    entry: entryBytes,
    entryName: entryKey,
    modules,
    skinConfig: luaSkinConfig,
    skinBaseDir: baseDir,
    runtimeContext: options.runtimeContext,
    // `dofile(skin_config.get_path("Play/lua/sp/info.lua"))` (the ModernChic pattern)
    // resolves to a path the skin built up via `get_path` — `${baseDir}/${rel}` after our
    // `setupSkinConfig` joins them. Look that up against the bundle's file map.
    dofileResolver: (path) => {
      const key = findCaseInsensitivePath(options.files, normalizePath(path));
      if (key === undefined) return undefined;
      return asLoadedBytes(options.files.get(key));
    },
  });
  if (!evalResult.ok) {
    return { ok: false, error: { message: evalResult.error.message } };
  }
  const value = evalResult.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: { message: `Lua skin '${options.entryPath}' returned a non-object value` } };
  }
  const skin = value as BeatorajaSkin;
  const header = headerFromSkin(skin);
  return {
    ok: true,
    header,
    skin: options.skinConfig === undefined ? undefined : skin,
    format,
  };
}

/**
 * Pull every `.lua` file reachable from `baseDir` (recursively, plus one directory up to support themes that
 * keep shared modules at the theme root) into the Lua module table.
 *
 * Module names mirror beatoraja's resolution: the relative path under `baseDir`, with `/` separators
 * preserved and the `.lua` suffix stripped. So `theme/blanket/result/util.lua` reachable from
 * `theme/blanket/result.luaskin` becomes module `"result/util"` (`require("result/util")` matches). Flat
 * `theme/blanket/prop.lua` becomes `"prop"`. A parent-directory `theme/play_parts.lua` becomes
 * `"../play_parts"` (rare; same-directory module wins on collision).
 *
 * Beatoraja's actual `require` accepts both `/` and `.` as separators. The collector only emits the `/`
 * form; the `setupCustomRequire` runtime then normalizes incoming names so a `require("result.util")`
 * still matches the `"result/util"` key.
 */
export function collectBeatorajaLuaModules(
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
  baseDir: string,
): BeatorajaLuaModuleSource[] {
  const baseDirNorm = normalizeDir(baseDir);
  const parentDirNorm = normalizeDir(dirname(baseDir));
  const seen = new Map<string, BeatorajaLuaModuleSource>();
  for (const [path, entry] of files) {
    const lower = path.toLowerCase();
    if (!lower.endsWith('.lua')) continue;
    const lastSlash = lower.lastIndexOf('/');
    const fileDir = lastSlash >= 0 ? lower.slice(0, lastSlash) : '';
    let moduleKey: string | undefined;
    if (fileDir === baseDirNorm || fileDir.startsWith(`${baseDirNorm}/`)) {
      // Inside (or a sub-directory of) the entry directory — strip the prefix to form the module key.
      // Use the lowercase form so the key is case-insensitive against `require()` lookups (the
      // resolver also lowercases incoming names).
      const relative = fileDir === baseDirNorm ? '' : fileDir.slice(baseDirNorm.length + 1);
      const fileName = lastSlash >= 0 ? lower.slice(lastSlash + 1) : lower;
      const stem = fileName.slice(0, -'.lua'.length);
      moduleKey = relative === '' ? stem : `${relative}/${stem}`;
    } else if (fileDir === parentDirNorm) {
      // Parent-directory shared module — beatoraja themes occasionally keep helpers (e.g. `play_parts.lua`)
      // one level above the entry. Resolved as the bare stem; same-directory entries take precedence on
      // collision because `require("play_parts")` should prefer the closer file.
      const fileName = lastSlash >= 0 ? lower.slice(lastSlash + 1) : lower;
      moduleKey = fileName.slice(0, -'.lua'.length);
    } else {
      continue;
    }
    const isInside = fileDir === baseDirNorm || fileDir.startsWith(`${baseDirNorm}/`);
    if (seen.has(moduleKey) && !isInside) {
      // Same-key collision: a module already inside `baseDir` wins over the parent-directory fallback.
      continue;
    }
    const bytes = asLoadedBytes(entry);
    if (bytes === undefined) continue;
    seen.set(moduleKey, { name: moduleKey, source: bytes });
  }
  return Array.from(seen.values());
}

/** Normalize a directory path for case-insensitive comparison: lowercased, no trailing slash. */
function normalizeDir(dir: string): string {
  const lower = dir.toLowerCase();
  return lower.endsWith('/') ? lower.slice(0, -1) : lower;
}

/**
 * Extract a `BeatorajaSkinHeader` from a record-shaped object — the only header fields are the well-known
 * top-level keys. Used both by the JSON loader and the Lua header pass; they hand in the same shape so the
 * picker logic can be shared.
 */
export function extractBeatorajaSkinHeader(obj: Readonly<Record<string, unknown>>): BeatorajaSkinHeader {
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
    offset: normalizeBeatorajaSkinCustomOffsets(obj.offset),
    category: Array.isArray(obj.category) ? (obj.category as BeatorajaSkinHeader['category']) : undefined,
  };
}

function headerFromSkin(skin: BeatorajaSkin): BeatorajaSkinHeader {
  return extractBeatorajaSkinHeader(skin as unknown as Readonly<Record<string, unknown>>);
}

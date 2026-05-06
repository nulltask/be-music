// Top-level loader for beatoraja skins.
//
// Whether the skin entry is a `.json` (static) or a `.luaskin` (script), the loader produces the same
// {@link BeatorajaSkinHeader} for the selector UI and {@link BeatorajaSkin} after the user has confirmed their
// custom-option / custom-file picks.

import { dirname, normalizePath } from '@be-music/utils/core';
import { asLoadedBytes, findCaseInsensitivePath, type BeatorajaSkinFileEntry } from './file-lookup.ts';
import { parseBeatorajaSkinJson, parseBeatorajaSkinJsonHeader } from './beatoraja-skin-json.ts';
import { evaluateBeatorajaLuaSkin, type BeatorajaLuaModuleSource } from './beatoraja-skin-lua.ts';
import type { BeatorajaSkin, BeatorajaSkinConfig, BeatorajaSkinHeader } from './beatoraja-skin-types.ts';

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
  const modules = collectLuaModules(options.files, baseDir);
  const evalResult = evaluateBeatorajaLuaSkin({
    entry: entryBytes,
    entryName: entryKey,
    modules,
    skinConfig: options.skinConfig,
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
 * Pull every `.lua` file in `baseDir` (and one directory up — beatoraja themes occasionally use `../play_parts.lua`)
 * into the Lua module table. The module name is the filename without the `.lua` suffix.
 */
function collectLuaModules(
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
  baseDir: string,
): BeatorajaLuaModuleSource[] {
  const baseDirLower = baseDir.toLowerCase();
  const parentDirLower = dirname(baseDir).toLowerCase();
  const seen = new Map<string, BeatorajaLuaModuleSource>();
  for (const [path, entry] of files) {
    const lower = path.toLowerCase();
    if (!lower.endsWith('.lua')) continue;
    const lastSlash = lower.lastIndexOf('/');
    const fileDir = lastSlash >= 0 ? lower.slice(0, lastSlash) : '';
    if (fileDir !== baseDirLower && fileDir !== parentDirLower) continue;
    const fileName = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
    const moduleName = fileName.slice(0, -'.lua'.length);
    if (seen.has(moduleName)) {
      // Same-directory module wins over parent-directory module (matches beatoraja's `require` lookup order).
      if (fileDir !== baseDirLower) continue;
    }
    const bytes = asLoadedBytes(entry);
    if (bytes === undefined) continue;
    seen.set(moduleName, { name: moduleName, source: bytes });
  }
  return Array.from(seen.values());
}

function headerFromSkin(skin: BeatorajaSkin): BeatorajaSkinHeader {
  const {
    type,
    name,
    author,
    w,
    h,
    playstart,
    scene,
    input,
    close,
    fadeout,
    finishmargin,
    property,
    filepath,
    offset,
  } = skin;
  return {
    type: typeof type === 'number' ? type : 0,
    name: typeof name === 'string' ? name : undefined,
    author: typeof author === 'string' ? author : undefined,
    w: typeof w === 'number' ? w : 0,
    h: typeof h === 'number' ? h : 0,
    playstart: typeof playstart === 'number' ? playstart : undefined,
    scene: typeof scene === 'number' ? scene : undefined,
    input: typeof input === 'number' ? input : undefined,
    close: typeof close === 'number' ? close : undefined,
    fadeout: typeof fadeout === 'number' ? fadeout : undefined,
    finishmargin: typeof finishmargin === 'number' ? finishmargin : undefined,
    property: Array.isArray(property) ? (property as BeatorajaSkinHeader['property']) : undefined,
    filepath: Array.isArray(filepath) ? (filepath as BeatorajaSkinHeader['filepath']) : undefined,
    offset: typeof offset === 'number' ? offset : undefined,
  };
}

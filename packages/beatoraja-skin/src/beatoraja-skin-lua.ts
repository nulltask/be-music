// Lua skin evaluator for beatoraja `.luaskin` themes.
//
// beatoraja Lua skins follow a 2-phase contract:
//   local t = require("xxxmain")
//   if skin_config then return t.main() else return t.header end
// The host runs the entry script TWICE — once with `skin_config = nil` to harvest the property/filepath schema, then
// again with `skin_config` populated by the user's choices. Both runs return a Lua table whose shape is identical to
// a `.json` skin's top-level object.
//
// We embed Fengari via the browser-friendly `fengari-web` wrapper (a Lua 5.3 interpreter in pure JS). `fengari-web`
// ships a prebundled UMD that strips Node-only references (`process`, `os.platform()`, etc.) so the evaluator runs
// hermetically in any browser without host-side polyfills. The same module also runs under Node for the Vitest
// suite — UMDs work in both environments.
//
// `fengari-web` only exposes `lua` / `lauxlib` / `lualib` (not the individual `luaopen_*` symbols), so the sandbox
// uses the "open everything, then strip dangerous globals" approach: `luaL_openlibs` enables the full standard
// library, then we nil-out `package` / `io` / `os` / `debug` / `coroutine` from `_G` before the skin script runs.
// The reference beatoraja themes only use `base` / `table` / `string` / `math` so the strip is non-disruptive.

import { lauxlib, lua, lualib, to_luastring } from 'fengari-web';
import type { lua_State, LuaCFunction } from 'fengari-web';

const {
  LUA_OK,
  LUA_REGISTRYINDEX,
  LUA_TBOOLEAN,
  LUA_TFUNCTION,
  LUA_TNIL,
  LUA_TNUMBER,
  LUA_TSTRING,
  LUA_TTABLE,
  lua_call,
  lua_close,
  lua_createtable,
  lua_getfield,
  lua_gettop,
  lua_isinteger,
  lua_next,
  lua_pcall,
  lua_pop,
  lua_pushboolean,
  lua_pushinteger,
  lua_pushjsfunction,
  lua_pushnil,
  lua_pushnumber,
  lua_pushstring,
  lua_pushvalue,
  lua_rawgeti,
  lua_rawlen,
  lua_rawseti,
  lua_remove,
  lua_setfield,
  lua_setglobal,
  lua_toboolean,
  lua_tojsstring,
  lua_tonumber,
  lua_tostring,
  lua_type,
} = lua;
const { luaL_error, luaL_loadbufferx, luaL_newstate } = lauxlib;
const { luaL_openlibs } = lualib;

/**
 * Plain-JS shape Lua tables get converted into. Lua doesn't distinguish list-from-record so we have to pick one
 * shape per table; the converter promotes `{ [1]=…, [2]=…, … }` into a JS array and everything else into an object.
 *
 * Keys are normalized to JS strings; numeric keys on records are stringified the same way `JSON.parse` does.
 */
export type LuaValue = null | boolean | number | string | LuaValue[] | { [key: string]: LuaValue };

/**
 * `skin_config` table the host injects into the global environment between the two evaluation passes. Keys mirror
 * beatoraja's Java side (`SkinHeader.CustomOption`).
 */
export interface BeatorajaLuaSkinConfig {
  /** Note offset in milliseconds. Defaults to 0. */
  offset?: number;
  /** Selected option per `property[].name` → option `op` integer. */
  option?: Readonly<Record<string, number>>;
  /** Selected file per `filepath[].name` → resolved relative path. */
  file?: Readonly<Record<string, string>>;
}

export interface BeatorajaLuaModuleSource {
  /**
   * Module name as it appears in `require("…")`. Beatoraja uses bare names like `"play24main"` and resolves them by
   * prefixing the entry script's directory; see {@link evaluateBeatorajaLuaSkin} for the lookup strategy.
   */
  name: string;
  /**
   * Lua source bytes. Stored as raw UTF-8 bytes so the evaluator can hand them straight to fengari without going
   * through `String` (Lua's source format is byte-oriented and we'd rather not lose `\r\n` quirks during conversion).
   */
  source: Uint8Array;
}

export interface EvaluateBeatorajaLuaSkinOptions {
  /** Entry script source (`*.luaskin`). */
  entry: Uint8Array;
  /** Display name used in Lua error messages — usually the entry file's basename. */
  entryName?: string;
  /** Modules reachable from `require()`. Includes the same-directory `.lua` files of the skin folder. */
  modules: ReadonlyArray<BeatorajaLuaModuleSource>;
  /**
   * Optional `skin_config` table for the second pass. Pass `undefined` to run the header-discovery pass — the entry
   * script will then return the `header` branch.
   */
  skinConfig?: BeatorajaLuaSkinConfig;
}

export interface BeatorajaLuaEvaluationError {
  /** Human-readable Lua error including `chunkname:line:` prefix. */
  message: string;
}

export type BeatorajaLuaEvaluationResult =
  | { ok: true; value: LuaValue }
  | { ok: false; error: BeatorajaLuaEvaluationError };

/**
 * Evaluate a beatoraja `.luaskin` entry script and convert the returned Lua table into plain JS. Returns a Result
 * union rather than throwing so the caller can handle "skin had a syntax error" without try/catch ceremony — most
 * call sites want to surface the error to the user as a load failure.
 */
export function evaluateBeatorajaLuaSkin(options: EvaluateBeatorajaLuaSkinOptions): BeatorajaLuaEvaluationResult {
  const L = luaL_newstate();
  try {
    openSkinSandbox(L);
    setupCustomRequire(L, options.modules);
    setupSkinConfig(L, options.skinConfig);

    const entryName = options.entryName ?? 'skin.luaskin';
    const loadStatus = luaL_loadbufferx(
      L,
      options.entry,
      options.entry.length,
      to_luastring(`@${entryName}`),
      to_luastring('t'),
    );
    if (loadStatus !== LUA_OK) {
      return errorResultFromTop(L);
    }

    const callStatus = lua_pcall(L, 0, 1, 0);
    if (callStatus !== LUA_OK) {
      return errorResultFromTop(L);
    }

    const value = popLuaValue(L);
    return { ok: true, value };
  } finally {
    lua_close(L);
  }
}

function openSkinSandbox(L: lua_State): void {
  // `luaL_openlibs` opens every Lua standard library, including the dangerous ones (`io`, `os`, `package`,
  // `debug`). We immediately strip those globals — beatoraja's reference theme only needs `base` / `table` /
  // `string` / `math`, and removing the rest keeps the evaluator hermetic. (We can't selectively skip them at
  // open-time because `fengari-web` doesn't expose individual `luaopen_*` symbols.)
  luaL_openlibs(L);

  // Strip libraries the skin author has no legitimate reason to touch. Setting these to nil also clears the
  // matching `package.loaded` entry (irrelevant once `package` itself is nilled, but harmless).
  for (const removed of [
    'package',
    'io',
    'os',
    'debug',
    'coroutine',
    // `require` and friends rely on `package` — nil them out now that the library is gone so a skin author who
    // tests `if require then …` gets a deterministic answer.
    'require',
    'dofile',
    'loadfile',
    'load',
    'loadstring',
    'collectgarbage',
  ]) {
    lua_pushnil(L);
    lua_setglobal(L, to_luastring(removed));
  }
}

const REGISTRY_MODULE_CACHE = '__be_music_beatoraja_module_cache';
const REGISTRY_MODULE_SOURCES = '__be_music_beatoraja_module_sources';

function setupCustomRequire(L: lua_State, modules: ReadonlyArray<BeatorajaLuaModuleSource>): void {
  // Registry sources table: { [name]: source }.
  lua_createtable(L, 0, modules.length);
  for (const m of modules) {
    lua_pushstring(L, m.source);
    lua_setfield(L, -2, to_luastring(m.name));
  }
  lua_setfield(L, LUA_REGISTRYINDEX, to_luastring(REGISTRY_MODULE_SOURCES));

  // Module cache so `require("x")` returns the same table on subsequent calls.
  lua_createtable(L, 0, 0);
  lua_setfield(L, LUA_REGISTRYINDEX, to_luastring(REGISTRY_MODULE_CACHE));

  const requireFn: LuaCFunction = (state) => {
    if (lua_type(state, 1) !== LUA_TSTRING) {
      luaL_error(state, to_luastring("bad argument #1 to 'require' (string expected)"));
      return 0;
    }
    const name = lua_tojsstring(state, 1);

    // Cache hit?
    lua_getfield(state, LUA_REGISTRYINDEX, to_luastring(REGISTRY_MODULE_CACHE));
    lua_getfield(state, -1, to_luastring(name));
    if (lua_type(state, -1) !== LUA_TNIL) {
      // Stack: ..., cache, value. Drop the cache from beneath the value.
      lua_remove(state, -2);
      return 1;
    }
    lua_pop(state, 2); // pop nil + cache table

    // Source lookup.
    lua_getfield(state, LUA_REGISTRYINDEX, to_luastring(REGISTRY_MODULE_SOURCES));
    lua_getfield(state, -1, to_luastring(name));
    if (lua_type(state, -1) !== LUA_TSTRING) {
      lua_pop(state, 2); // pop nil + sources table
      // Beatoraja host-provided modules (`main_state`, `event_command`, …) live inside the Java runtime, not as
      // `.lua` files alongside the skin. We can't satisfy them, but failing the `require()` outright would prevent
      // the skin from even returning its `header` (the parser path most callers want). Return an empty table
      // instead — the skin author's call sites read it and either get nil/0 back (harmless during header
      // discovery) or branch on `if main_state then …` (the table is truthy so the branch runs but the actual
      // values are unavailable, which the renderer side will handle). Cache the stub so all `require()` calls for
      // the same name return the same table.
      lua_createtable(state, 0, 0);
      lua_getfield(state, LUA_REGISTRYINDEX, to_luastring(REGISTRY_MODULE_CACHE));
      lua_pushvalue(state, -2); // duplicate stub
      lua_setfield(state, -2, to_luastring(name));
      lua_pop(state, 1); // pop cache table; stub remains on top
      return 1;
    }
    const sourceBytes = readBytesFromTop(state);
    lua_pop(state, 2); // pop string + sources table

    const loadStatus = luaL_loadbufferx(
      state,
      sourceBytes,
      sourceBytes.length,
      to_luastring(`@${name}`),
      to_luastring('t'),
    );
    if (loadStatus !== LUA_OK) {
      // Error message already on top of stack.
      luaL_error(state, to_luastring(`failed to load '${name}': ${lua_tojsstring(state, -1)}`));
      return 0;
    }
    lua_call(state, 0, 1);

    // Cache the result and leave a copy on top to return.
    lua_getfield(state, LUA_REGISTRYINDEX, to_luastring(REGISTRY_MODULE_CACHE));
    lua_pushvalue(state, -2); // duplicate result above cache table
    lua_setfield(state, -2, to_luastring(name));
    lua_pop(state, 1); // pop cache table; result remains on top.

    return 1;
  };

  lua_pushjsfunction(L, requireFn);
  lua_setglobal(L, to_luastring('require'));
}

function setupSkinConfig(L: lua_State, config: BeatorajaLuaSkinConfig | undefined): void {
  if (config === undefined) {
    lua_pushnil(L);
    lua_setglobal(L, to_luastring('skin_config'));
    return;
  }
  pushJsValueAsLua(L, sanitizeSkinConfig(config));
  lua_setglobal(L, to_luastring('skin_config'));
}

function sanitizeSkinConfig(config: BeatorajaLuaSkinConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {
    offset: typeof config.offset === 'number' ? config.offset : 0,
    option: config.option ?? {},
    file: config.file ?? {},
  };
  return result;
}

function pushJsValueAsLua(L: lua_State, value: unknown): void {
  if (value === null || value === undefined) {
    lua_pushnil(L);
    return;
  }
  if (typeof value === 'boolean') {
    lua_pushboolean(L, value ? 1 : 0);
    return;
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      lua_pushinteger(L, value);
    } else {
      lua_pushnumber(L, value);
    }
    return;
  }
  if (typeof value === 'string') {
    lua_pushstring(L, to_luastring(value));
    return;
  }
  if (Array.isArray(value)) {
    lua_createtable(L, value.length, 0);
    for (let i = 0; i < value.length; i += 1) {
      pushJsValueAsLua(L, value[i]);
      lua_rawseti(L, -2, i + 1);
    }
    return;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    lua_createtable(L, 0, entries.length);
    for (const [key, v] of entries) {
      pushJsValueAsLua(L, v);
      lua_setfield(L, -2, to_luastring(key));
    }
    return;
  }
  lua_pushnil(L);
}

function popLuaValue(L: lua_State): LuaValue {
  if (lua_type(L, -1) === LUA_TNIL) {
    lua_pop(L, 1);
    return null;
  }
  const value = readLuaValueAt(L, -1);
  lua_pop(L, 1);
  return value;
}

function readLuaValueAt(L: lua_State, idx: number): LuaValue {
  const t = lua_type(L, idx);
  switch (t) {
    case LUA_TNIL:
      return null;
    case LUA_TBOOLEAN:
      return lua_toboolean(L, idx);
    case LUA_TNUMBER:
      // Both integer and float Lua numbers fit in JS Number for the magnitudes skin authors use.
      return lua_tonumber(L, idx);
    case LUA_TSTRING:
      return lua_tojsstring(L, idx);
    case LUA_TTABLE:
      return readLuaTableAt(L, idx);
    case LUA_TFUNCTION:
      // Skin tables shouldn't carry functions; if they do, drop them rather than crashing.
      return null;
    default:
      return null;
  }
}

function readLuaTableAt(L: lua_State, idx: number): LuaValue[] | { [key: string]: LuaValue } {
  // Decide array vs record. A table is an array iff every key is a positive integer and they form a contiguous
  // [1..N] sequence with N == #t.
  const arrayLen = lua_rawlen(L, idx);
  if (arrayLen > 0 && tableHasOnlyArrayKeys(L, idx, arrayLen)) {
    const arr: LuaValue[] = Array.from<LuaValue>({ length: arrayLen });
    for (let i = 1; i <= arrayLen; i += 1) {
      lua_rawgeti(L, idx, i);
      arr[i - 1] = readLuaValueAt(L, -1);
      lua_pop(L, 1);
    }
    return arr;
  }

  const obj: { [key: string]: LuaValue } = {};
  const absIdx = absoluteIndex(L, idx);
  lua_pushnil(L);
  while (lua_next(L, absIdx) !== 0) {
    const keyType = lua_type(L, -2);
    let key: string | undefined;
    if (keyType === LUA_TSTRING) {
      key = lua_tojsstring(L, -2);
    } else if (keyType === LUA_TNUMBER) {
      key = String(lua_tonumber(L, -2));
    }
    if (key !== undefined) {
      obj[key] = readLuaValueAt(L, -1);
    }
    lua_pop(L, 1); // pop value, keep key for next iteration
  }
  return obj;
}

function tableHasOnlyArrayKeys(L: lua_State, idx: number, expectedLen: number): boolean {
  const absIdx = absoluteIndex(L, idx);
  let count = 0;
  lua_pushnil(L);
  while (lua_next(L, absIdx) !== 0) {
    count += 1;
    const keyType = lua_type(L, -2);
    if (keyType !== LUA_TNUMBER || !lua_isinteger(L, -2)) {
      lua_pop(L, 2);
      return false;
    }
    const key = lua_tonumber(L, -2);
    if (key < 1 || key > expectedLen || !Number.isInteger(key)) {
      lua_pop(L, 2);
      return false;
    }
    lua_pop(L, 1);
  }
  return count === expectedLen;
}

function absoluteIndex(L: lua_State, relIdx: number): number {
  if (relIdx > 0 || relIdx <= LUA_REGISTRYINDEX) return relIdx;
  return lua_gettop(L) + relIdx + 1;
}

function readBytesFromTop(L: lua_State): Uint8Array {
  // `lua_tostring` returns a fengari-internal byte view that may be reused; copy before further stack mutations.
  const view = lua_tostring(L, -1);
  return new Uint8Array(view);
}

function errorResultFromTop(L: lua_State): BeatorajaLuaEvaluationResult {
  const message = lua_tojsstring(L, -1);
  lua_pop(L, 1);
  return { ok: false, error: { message } };
}

export function describeBeatorajaLuaError(error: BeatorajaLuaEvaluationError): string {
  return error.message;
}

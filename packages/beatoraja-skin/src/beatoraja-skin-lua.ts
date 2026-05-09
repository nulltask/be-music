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

import { normalizePath } from '@be-music/utils/core';
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
  lua_settop,
  lua_setfield,
  lua_setglobal,
  lua_setmetatable,
  lua_toboolean,
  lua_tojsstring,
  lua_tonumber,
  lua_tostring,
  lua_type,
} = lua;
const { luaL_error, luaL_loadbufferx, luaL_newstate, luaL_ref, luaL_unref } = lauxlib;
const { luaL_openlibs } = lualib;

export interface BeatorajaLuaOffsetValue {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  a: number;
}

export interface BeatorajaLuaRuntimeContext {
  option?: (id: number) => boolean;
  number?: (id: number) => number | undefined;
  floatNumber?: (id: number) => number | undefined;
  text?: (id: number) => string | undefined;
  offset?: (id: number) => Readonly<Partial<BeatorajaLuaOffsetValue>> | undefined;
  timer?: (id: number) => number | undefined;
  time?: () => number | undefined;
  eventIndex?: (id: number) => number | undefined;
  setTimer?: (id: number, value: number) => boolean | undefined;
  eventExec?: (id: number, args: ReadonlyArray<number>) => boolean | undefined;
  rate?: () => number | undefined;
  exscore?: () => number | undefined;
  rateBest?: () => number | undefined;
  exscoreBest?: () => number | undefined;
  rateRival?: () => number | undefined;
  exscoreRival?: () => number | undefined;
  volumeSys?: () => number | undefined;
  setVolumeSys?: (value: number) => boolean | undefined;
  volumeKey?: () => number | undefined;
  setVolumeKey?: (value: number) => boolean | undefined;
  volumeBg?: () => number | undefined;
  setVolumeBg?: (value: number) => boolean | undefined;
  judge?: (judge: number) => number | undefined;
  gauge?: () => number | undefined;
  gaugeType?: () => number | undefined;
  /**
   * Play a one-shot SFX at `path` at the given volume (0..1, default 1). Mirrors beatoraja's
   * {@code main_state.audio_play(path, volume)}. ModernChic uses this for menu-confirm clicks
   * and panel-toggle SE (`Root/customsound.lua` calls 80+ times across panels and song moves).
   * The path is the resolved absolute or skin-relative URL from the skin bundle. Hosts that
   * don't wire audio simply leave this undefined; the runtime falls through to a no-op so the
   * Lua call site doesn't raise `attempt to call a nil value`. Returns `true` when the play
   * was scheduled, `false` when the host couldn't resolve the path or the audio system was
   * unavailable.
   */
  audioPlay?: (path: string, volume: number) => boolean | undefined;
  /**
   * Same shape as {@link audioPlay}, but loops the clip until {@link audioStop} is called for
   * the same path. Used for ambient loops (e.g. a result-scene background hum). Few skins use
   * this in practice, but the API surface needs to exist so calls don't crash.
   */
  audioLoop?: (path: string, volume: number) => boolean | undefined;
  /**
   * Stop playback of `path` (matches both one-shot and looped instances scheduled previously
   * for that path). Returns `true` when at least one instance was stopped. Hosts that don't
   * track per-path handles can no-op and return `false`.
   */
  audioStop?: (path: string) => boolean | undefined;
}

export interface BeatorajaLuaFunctionValue {
  readonly kind: 'beatoraja-lua-function';
  evaluate(context?: BeatorajaLuaRuntimeContext, args?: ReadonlyArray<unknown>): LuaValue | undefined;
  dispose(): void;
}

/**
 * Plain-JS shape Lua tables get converted into. Lua doesn't distinguish list-from-record so we have to pick one
 * shape per table; the converter promotes `{ [1]=…, [2]=…, … }` into a JS array and everything else into an object.
 *
 * Keys are normalized to JS strings; numeric keys on records are stringified the same way `JSON.parse` does.
 */
export type LuaValue =
  | null
  | boolean
  | number
  | string
  | BeatorajaLuaFunctionValue
  | LuaValue[]
  | { [key: string]: LuaValue };

/**
 * `skin_config` table the host injects into the global environment between the two evaluation passes. Keys mirror
 * beatoraja's Java side (`SkinHeader.CustomOption`).
 */
export interface BeatorajaLuaSkinConfig {
  /**
   * Custom offset values. Two shapes accepted for backward compatibility:
   *
   * - **Number** — chart timing offset in ms (the historic `BeatorajaSkinConfig.offset`
   *   convention). Lua doesn't read this; the host applies it directly to the engine.
   * - **Record\<string, Partial\<OffsetValue\>\>** — per-name custom offset map keyed by
   *   `header.offset[].name`. Beatoraja's Lua bridge exposes this as a TABLE; theme code
   *   accesses `skin_config.offset[name].x` / `.y` / `.w` / `.h` / `.r` / `.a` (typically
   *   inside deferred property closures evaluated at draw time).
   *
   * When the number form is supplied, the Lua-side `skin_config.offset` falls through to a
   * empty table (with the auto-zero `__index` metatable still attached). When the record form
   * is supplied, its entries pre-populate the table. Either way, theme closures that reach
   * into `skin_config.offset[<unknown name>]` get a default zero record back via `__index`.
   */
  offset?: number | Readonly<Record<string, Partial<BeatorajaLuaOffsetValue>>>;
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
  /**
   * Resolver for `dofile(path)` and `skin_config:get_path(rel)`. Beatoraja themes (e.g. ModernChic) split
   * their layout into per-section `.lua` files that the entry script loads at runtime via
   * `dofile(skin_config.get_path("Play/lua/sp/info.lua"))`. We can't go through a real
   * filesystem in the browser; this callback bridges the gap by returning the bytes for any
   * path the skin requests. Returning `undefined` triggers a Lua error from `dofile`. Optional —
   * skins that only use `require()` (e.g. the bundled reference theme) work without it.
   */
  dofileResolver?: (path: string) => Uint8Array | undefined;
  /**
   * Base directory for relative-path resolution inside the Lua sandbox. `skin_config:get_path(rel)`
   * concatenates `${skinBaseDir}/${rel}` so the returned string can later be passed straight back
   * to `dofile`. Defaults to an empty string (then `get_path` returns `rel` verbatim).
   */
  skinBaseDir?: string;
  /**
   * Optional runtime context for `main_state.option(opcode)` / `main_state.number(...)` etc.
   * called from the entry script's TOP-LEVEL or from `main()` during the second-pass eval.
   *
   * Beatoraja themes commonly compute values at skin-load time using these accessors — e.g.
   * ModernChic's decide skin pre-resolves a per-difficulty RGB triple via
   * `CUSTOM.NUM.diffRGB()` which calls `main_state.option(MAIN.OP.DIFFICULTY1..)` and returns
   * `nil` when none of the DIFFICULTY ops are active. Without a host-supplied context the
   * accessors return `false` / `0`, the Lua function falls through to `nil`, and the next
   * `RGB[1]` indexing crashes the entire `main()` evaluation. The skin then fails to load
   * silently (the demo's show-X helper just falls through to the next scene).
   *
   * Hosts that know the chart's classification (difficulty, judge rank, BPM, etc.) should
   * pass a context whose `option` returns `true` for the matching `BEATORAJA_OP.DIFFICULTY_*`
   * / `LEVEL_*` / `JUDGE_*` codes. Other accessors can be left `undefined` — the stub falls
   * back to safe defaults (`0` for numbers, `''` for strings).
   *
   * Optional — themes that don't compute anything dynamic at load time (the reference theme,
   * GdbG_Skin's decide / select) work fine without it.
   */
  runtimeContext?: BeatorajaLuaRuntimeContext;
}

export interface BeatorajaLuaEvaluationError {
  /** Human-readable Lua error including `chunkname:line:` prefix. */
  message: string;
}

export type BeatorajaLuaEvaluationResult =
  | { ok: true; value: LuaValue }
  | { ok: false; error: BeatorajaLuaEvaluationError };

export const BEATORAJA_LUA_TIMER_OFF_VALUE = -9223372036854775808;

const ZERO_LUA_OFFSET: Readonly<BeatorajaLuaOffsetValue> = Object.freeze({
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  r: 0,
  a: 255,
});

class LuaRuntimeOwner {
  private refs = 0;
  private closed = false;
  context: BeatorajaLuaRuntimeContext | undefined;

  constructor(readonly L: lua_State) {}

  makeFunction(ref: number): BeatorajaLuaFunctionValue {
    this.refs += 1;
    let disposed = false;
    return {
      kind: 'beatoraja-lua-function',
      evaluate: (context, args) => {
        if (disposed || this.closed) return undefined;
        return this.evaluateFunction(ref, context, args ?? []);
      },
      dispose: () => {
        if (disposed || this.closed) return;
        disposed = true;
        luaL_unref(this.L, LUA_REGISTRYINDEX, ref);
        this.refs -= 1;
        if (this.refs <= 0) this.close();
      },
    };
  }

  hasRetainedFunctions(): boolean {
    return this.refs > 0;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    lua_close(this.L);
  }

  private evaluateFunction(
    ref: number,
    context: BeatorajaLuaRuntimeContext | undefined,
    args: ReadonlyArray<unknown>,
  ): LuaValue | undefined {
    const top = lua_gettop(this.L);
    const previousContext = this.context;
    this.context = context;
    try {
      lua_rawgeti(this.L, LUA_REGISTRYINDEX, ref);
      for (const arg of args) pushJsValueAsLua(this.L, arg);
      const status = lua_pcall(this.L, args.length, 1, 0);
      if (status !== LUA_OK) {
        lua_settop(this.L, top);
        return undefined;
      }
      const value = readLuaValueAt(this.L, -1, this);
      lua_settop(this.L, top);
      return value;
    } finally {
      this.context = previousContext;
      lua_settop(this.L, top);
    }
  }
}

export function isBeatorajaLuaFunctionValue(value: unknown): value is BeatorajaLuaFunctionValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { kind?: unknown }).kind === 'beatoraja-lua-function' &&
    typeof (value as { evaluate?: unknown }).evaluate === 'function'
  );
}

export function evaluateBeatorajaLuaBoolean(
  value: BeatorajaLuaFunctionValue,
  context?: BeatorajaLuaRuntimeContext,
): boolean | undefined {
  const result = value.evaluate(context);
  if (typeof result === 'boolean') return result;
  if (typeof result === 'number') return result !== 0;
  return undefined;
}

export function evaluateBeatorajaLuaNumber(
  value: BeatorajaLuaFunctionValue,
  context?: BeatorajaLuaRuntimeContext,
): number | undefined {
  const result = value.evaluate(context);
  return typeof result === 'number' && Number.isFinite(result) ? result : undefined;
}

export function evaluateBeatorajaLuaString(
  value: BeatorajaLuaFunctionValue,
  context?: BeatorajaLuaRuntimeContext,
): string | undefined {
  const result = value.evaluate(context);
  return typeof result === 'string' ? result : undefined;
}

/**
 * Evaluate a beatoraja `.luaskin` entry script and convert the returned Lua table into plain JS. Returns a Result
 * union rather than throwing so the caller can handle "skin had a syntax error" without try/catch ceremony — most
 * call sites want to surface the error to the user as a load failure.
 */
export function evaluateBeatorajaLuaSkin(options: EvaluateBeatorajaLuaSkinOptions): BeatorajaLuaEvaluationResult {
  const L = luaL_newstate();
  const owner = new LuaRuntimeOwner(L);
  let retainedByReturnValue = false;
  try {
    openSkinSandbox(L);
    setupCustomRequire(L, options.modules, owner, options.skinConfig !== undefined);
    setupSkinConfig(L, options.skinConfig, options.skinBaseDir ?? '');
    setupDofile(L, owner, options.dofileResolver);
    setupCompatStubs(L);

    // Wire the host's runtime context (if any) so `main_state.option(...)` / `.number(...)` /
    // etc. invoked at skin-load time see chart-aware values rather than the stub fallbacks.
    // Theme code like ModernChic decide's `CUSTOM.NUM.diffRGB()` reads difficulty ops at the
    // top level of `main()` to pre-compute per-difficulty colors — without a context the
    // accessor returns `false`, the function falls through to `nil`, and downstream indexing
    // (`RGB[1]`) crashes the entire eval.
    owner.context = options.runtimeContext;

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

    const value = popLuaValue(L, owner);
    retainedByReturnValue = owner.hasRetainedFunctions();
    return { ok: true, value };
  } finally {
    if (!retainedByReturnValue) owner.close();
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

/**
 * Built-in Lua sources for beatoraja's `timer_util` / `event_util` helper modules. The reference
 * player exposes these as JVM classes (`bms.player.beatoraja.skin.lua.{TimerUtility,EventUtility}`)
 * registered at runtime. Community Lua skins call into them WITHOUT bundling a fallback `.lua`,
 * so a host without these baked in fails on `require("timer_util")` (returns nil → indexing
 * `timer_util.timer_observe_boolean` crashes).
 *
 * `timer_util` is the heaviest user — ModernChic's Result/Select scenes call
 * `timer_util.timer_observe_boolean(boolFn)` 80+ times to gate destination animations on
 * Lua-evaluated booleans (e.g. "is the IR ranking visible right now?", "did the section's
 * win/loss flag flip?"). Without it the Result info-menu tab switching is dead.
 *
 * `event_util` returns table descriptors that the engine pairs with `customEvents` (audit 2.2)
 * to fire actions when conditions change. We don't yet wire `customEvents` — these helpers
 * still return well-formed descriptors so call sites don't crash; the actual side effect is
 * deferred until the customEvents pipeline lands.
 */
const TIMER_UTIL_LUA_SOURCE = `
local main_state = require("main_state")
local M = {}

-- timer_observe_boolean(boolFn): a TimerProperty driven by a boolean.
-- Returns a closure that the destination renderer calls each frame. When boolFn() flips
-- false → true, the closure stamps "now" as the timer start and returns it for as long
-- as boolFn stays true. When it flips back, the start resets and the closure returns
-- timer_off_value (= "timer not started" sentinel — destinations gate on this).
function M.timer_observe_boolean(boolFn)
  local startMicros = nil
  return function()
    if boolFn() then
      if startMicros == nil then startMicros = main_state.time() end
      return startMicros
    else
      startMicros = nil
      return main_state.timer_off_value
    end
  end
end

-- now_timer(): a TimerProperty fixed at the current time. Used by skins that want a
-- one-shot baseline (e.g. "the moment a panel was created").
function M.now_timer()
  local stamp = main_state.time()
  return function() return stamp end
end

-- is_timer_on(id) / is_timer_off(id): convenience predicates wrapping main_state.timer.
function M.is_timer_on(id)
  return main_state.timer(id) ~= main_state.timer_off_value
end
function M.is_timer_off(id)
  return main_state.timer(id) == main_state.timer_off_value
end

-- timer_function(fn): adopts an arbitrary Lua function as a TimerProperty. Beatoraja's
-- impl is a passthrough — the function is expected to return microsecond timestamps
-- itself. We do the same; identity helps Lua skins that pre-build TimerProperty wrappers
-- via this helper for consistency with the boolean/timer variants.
function M.timer_function(fn)
  return fn
end

-- new_passive_timer(): creates a manually-managed timer the script can stamp. Returns
-- four closures matching beatoraja's signature: (read, set, get, reset).
function M.new_passive_timer()
  local t = main_state.timer_off_value
  local read = function() return t end
  local set = function(v) t = v or main_state.time() end
  local get = function() return t end
  local reset = function() t = main_state.timer_off_value end
  return read, set, get, reset
end

return M
`;

const EVENT_UTIL_LUA_SOURCE = `
local M = {}

-- event_observe_turn_true(boolFn, action): fires action() when boolFn flips false → true.
-- Beatoraja's pipeline iterates the 'customEvents' table each frame, calling action when
-- the condition just turned true. We return a descriptor table that customEvents
-- consumers (audit 2.2 — not yet wired) can pick up.
function M.event_observe_turn_true(boolFn, action)
  local last = false
  return {
    condition = function()
      local now = boolFn() and true or false
      local fire = now and not last
      last = now
      return fire
    end,
    action = action,
  }
end

-- event_observe_timer(timerId, action): fires when the engine timer changes state. We
-- can't observe arbitrary timer transitions without engine cooperation, so the descriptor
-- delegates to event_observe_turn_true keyed on "timer is currently on".
local main_state = require("main_state")
function M.event_observe_timer_on(timerId, action)
  return M.event_observe_turn_true(function()
    return main_state.timer(timerId) ~= main_state.timer_off_value
  end, action)
end
function M.event_observe_timer_off(timerId, action)
  return M.event_observe_turn_true(function()
    return main_state.timer(timerId) == main_state.timer_off_value
  end, action)
end
function M.event_observe_timer(timerId, action)
  -- Fires on EITHER edge — return both descriptors so customEvents iteration sees them.
  return {
    M.event_observe_timer_on(timerId, action),
    M.event_observe_timer_off(timerId, action),
  }
end

-- event_min_interval(action, minIntervalMs): rate-limits action so it fires at most once
-- per interval. Implemented as a wrapper that compares against the last invocation time.
function M.event_min_interval(action, minIntervalMs)
  local lastFireMicros = nil
  local intervalMicros = (minIntervalMs or 0) * 1000
  return function(...)
    local now = main_state.time()
    if lastFireMicros == nil or now - lastFireMicros >= intervalMicros then
      lastFireMicros = now
      return action(...)
    end
  end
end

return M
`;

/** UTF-8-encode a Lua source string for fengari's byte-oriented loader. */
function encodeLuaSource(src: string): Uint8Array {
  return new TextEncoder().encode(src);
}

const TIMER_UTIL_BYTES = encodeLuaSource(TIMER_UTIL_LUA_SOURCE);
const EVENT_UTIL_BYTES = encodeLuaSource(EVENT_UTIL_LUA_SOURCE);

function setupCustomRequire(
  L: lua_State,
  modules: ReadonlyArray<BeatorajaLuaModuleSource>,
  owner: LuaRuntimeOwner,
  exposeMainState: boolean,
): void {
  // Registry sources table: { [name]: source }. Seeded with the bundled theme modules first,
  // then the built-in `timer_util` / `event_util` helpers — bundled modules win on collision so
  // a theme that ships its own `timer_util.lua` overrides ours.
  lua_createtable(L, 0, modules.length + 2);
  const seenModules = new Set<string>();
  for (const m of modules) {
    lua_pushstring(L, m.source);
    lua_setfield(L, -2, to_luastring(m.name));
    seenModules.add(m.name);
  }
  if (!seenModules.has('timer_util')) {
    lua_pushstring(L, TIMER_UTIL_BYTES);
    lua_setfield(L, -2, to_luastring('timer_util'));
  }
  if (!seenModules.has('event_util')) {
    lua_pushstring(L, EVENT_UTIL_BYTES);
    lua_setfield(L, -2, to_luastring('event_util'));
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
    // Beatoraja's Lua loader accepts both `/` and `.` as path separators (`require("result.util")` and
    // `require("result/util")` are equivalent). Normalize to `/` so the module table lookup hits the
    // collector's canonical key. Also lowercase to match the collector's case-insensitive convention
    // — `collectBeatorajaLuaModules` keys everything by lowercased path so a Windows-authored skin
    // that uses `require("Root.customfunction")` (case-mixed) still resolves to
    // `root/customfunction.lua` on every host (Linux file-name case is identity, macOS HFS+ may
    // preserve, Windows is insensitive — normalising both sides removes the ambiguity).
    const rawName = lua_tojsstring(state, 1);
    const name = rawName.replace(/\./g, '/').toLowerCase();

    // Cache hit?
    lua_getfield(state, LUA_REGISTRYINDEX, to_luastring(REGISTRY_MODULE_CACHE));
    lua_getfield(state, -1, to_luastring(name));
    if (lua_type(state, -1) !== LUA_TNIL) {
      // Stack: ..., cache, value. Drop the cache from beneath the value.
      lua_remove(state, -2);
      return 1;
    }
    lua_pop(state, 2); // pop nil + cache table

    // Built-in module check — `main_state` and friends. These are emulated host-provided tables; if the
    // module name matches one we synthesize, push the table and cache it.
    if (pushBuiltinLuaModule(state, name, owner, exposeMainState)) {
      lua_getfield(state, LUA_REGISTRYINDEX, to_luastring(REGISTRY_MODULE_CACHE));
      lua_pushvalue(state, -2); // duplicate the synthesized table
      lua_setfield(state, -2, to_luastring(name));
      lua_pop(state, 1); // pop cache table; module remains on top
      logRequire(name, 'builtin');
      return 1;
    }

    // Source lookup.
    lua_getfield(state, LUA_REGISTRYINDEX, to_luastring(REGISTRY_MODULE_SOURCES));
    lua_getfield(state, -1, to_luastring(name));
    if (lua_type(state, -1) !== LUA_TSTRING) {
      lua_pop(state, 2); // pop nil + sources table
      // Unknown module — return an empty table stub. Rare in well-formed skins; mostly happens when an
      // author imports an experimental utility that didn't ship in the bundle. Cache the stub so all
      // `require()` calls for the same name return the same table. We log a warning so the host can
      // surface "missing module" diagnostics without crashing the eval — beatoraja itself raises
      // `module 'X' not found` (audit 3.12), but a hard throw breaks pcall'd discovery patterns
      // (`if pcall(require, "optional") then ... end`) that some skins use to gate experimental
      // features. The empty-stub-with-warning compromise keeps both paths working.
      console.warn(`[beatoraja-lua] require("${name}") -> stub (module not found, returning empty table)`);
      lua_createtable(state, 0, 0);
      lua_getfield(state, LUA_REGISTRYINDEX, to_luastring(REGISTRY_MODULE_CACHE));
      lua_pushvalue(state, -2); // duplicate stub
      lua_setfield(state, -2, to_luastring(name));
      lua_pop(state, 1); // pop cache table; stub remains on top
      logRequire(name, 'stub');
      return 1;
    }
    const sourceBytes = readBytesFromTop(state);
    lua_pop(state, 2); // pop string + sources table
    logRequire(name, 'module');

    // Cycle-detection sentinel (audit 3.11). Beatoraja's PackageLib stores a placeholder in
    // `package.loaded[name]` BEFORE running the module body so that re-entrant `require()`
    // calls during execution see a value (the placeholder) rather than re-entering the loader
    // and infinite-recursing. We do the same: cache an empty table at this name now; replace
    // it with the real return value once the chunk runs. Cyclic skins observe the placeholder
    // table on the second `require` — fields populated AFTER the cycle-back resolve too,
    // matching beatoraja's circular-import semantics.
    lua_createtable(state, 0, 0);
    lua_getfield(state, LUA_REGISTRYINDEX, to_luastring(REGISTRY_MODULE_CACHE));
    lua_pushvalue(state, -2); // duplicate placeholder above cache table
    lua_setfield(state, -2, to_luastring(name));
    lua_pop(state, 1); // pop cache table; placeholder still on top under the byte source we'll load
    lua_pop(state, 1); // pop the placeholder — we no longer need it on the stack

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

    // Replace the placeholder cache entry with the real return value; leave a copy on top to
    // return. If the chunk happens to return the placeholder table itself (e.g. modules that
    // build up their export by mutating the table that re-entrant `require` calls observed),
    // the assignment is a no-op.
    lua_getfield(state, LUA_REGISTRYINDEX, to_luastring(REGISTRY_MODULE_CACHE));
    lua_pushvalue(state, -2); // duplicate result above cache table
    lua_setfield(state, -2, to_luastring(name));
    lua_pop(state, 1); // pop cache table; result remains on top.

    return 1;
  };

  lua_pushjsfunction(L, requireFn);
  lua_setglobal(L, to_luastring('require'));
}

const REGISTRY_DOFILE_CACHE = '__be_music_beatoraja_dofile_cache';

/**
 * Wire `dofile(path)` against the bundle. Beatoraja's reference theme rarely uses `dofile` —
 * but elaborate community skins (ModernChic, etc.) split their layout into per-section
 * `.lua` files and load them at runtime via:
 *
 *     dofile(skin_config.get_path("Play/lua/sp/info.lua"))
 *
 * The resolver maps the requested path to bundle bytes; we then compile + execute the chunk
 * and cache the return value so subsequent `dofile(samePath)` calls are cheap. When no
 * resolver is supplied (or the resolver returns `undefined`) we surface a Lua error matching
 * the standard `dofile`'s "cannot open" diagnostic so skin authors can tell their require
 * failed.
 */
function setupDofile(
  L: lua_State,
  owner: LuaRuntimeOwner,
  resolver: ((path: string) => Uint8Array | undefined) | undefined,
): void {
  void owner; // Reserved for future Lua-function retention bookkeeping if dofile returns one.
  // Per-evaluation cache keyed by path string.
  lua_createtable(L, 0, 0);
  lua_setfield(L, LUA_REGISTRYINDEX, to_luastring(REGISTRY_DOFILE_CACHE));

  const dofileFn: LuaCFunction = (state) => {
    if (lua_type(state, 1) !== LUA_TSTRING) {
      luaL_error(state, to_luastring("bad argument #1 to 'dofile' (string expected)"));
      return 0;
    }
    const rawPath = lua_tojsstring(state, 1);
    // Normalize the cache key (audit 3.10) so `dofile("Play/x.lua")` and
    // `dofile("./Play/x.lua")` hit the same cache entry. Without this, equivalent paths
    // re-execute the chunk each time — module-level state (e.g. one-shot init flags) gets
    // re-run, breaking module identity. Beatoraja's `dofile` keys against the resolved
    // `Path` for the same reason; `normalizePath` produces the equivalent canonical form
    // by collapsing `.` / `..` segments and converting `\` to `/`.
    const path = normalizePath(rawPath);

    // Cache hit?
    lua_getfield(state, LUA_REGISTRYINDEX, to_luastring(REGISTRY_DOFILE_CACHE));
    lua_getfield(state, -1, to_luastring(path));
    if (lua_type(state, -1) !== LUA_TNIL) {
      lua_remove(state, -2); // drop cache table
      return 1;
    }
    lua_pop(state, 2);

    if (resolver === undefined) {
      // eslint-disable-next-line no-console
      console.warn(`[beatoraja-lua] dofile(${JSON.stringify(path)}) FAILED: no resolver wired`);
      luaL_error(state, to_luastring(`cannot open '${path}': dofile is not wired (no resolver)`));
      return 0;
    }
    const bytes = resolver(path);
    if (bytes === undefined) {
      // eslint-disable-next-line no-console
      console.warn(`[beatoraja-lua] dofile(${JSON.stringify(path)}) FAILED: file not in skin bundle`);
      luaL_error(state, to_luastring(`cannot open '${path}': not found in skin bundle`));
      return 0;
    }
    const loadStatus = luaL_loadbufferx(state, bytes, bytes.length, to_luastring(`@${path}`), to_luastring('t'));
    if (loadStatus !== LUA_OK) {
      const msg = lua_tojsstring(state, -1);
      // eslint-disable-next-line no-console
      console.warn(`[beatoraja-lua] dofile(${JSON.stringify(path)}) FAILED to compile: ${msg}`);
      luaL_error(state, to_luastring(`failed to load '${path}': ${msg}`));
      return 0;
    }
    // pcall the actual chunk execution so a runtime error inside the loaded module surfaces with
    // its own filename in the diagnostic, not the calling site's. Themes wrap their dofile
    // invocations in their own pcall (the ModernChic pattern) — without our pcall here the
    // runtime error message would be the OUTER chunk's prefix, which makes triage harder.
    const callStatus = lua_pcall(state, 0, 1, 0);
    if (callStatus !== LUA_OK) {
      const msg = lua_tojsstring(state, -1);
      // eslint-disable-next-line no-console
      console.warn(`[beatoraja-lua] dofile(${JSON.stringify(path)}) THREW at runtime: ${msg}`);
      luaL_error(state, to_luastring(`error executing '${path}': ${msg}`));
      return 0;
    }

    // Cache + return.
    lua_getfield(state, LUA_REGISTRYINDEX, to_luastring(REGISTRY_DOFILE_CACHE));
    lua_pushvalue(state, -2);
    lua_setfield(state, -2, to_luastring(path));
    lua_pop(state, 1);
    // eslint-disable-next-line no-console
    console.log(`[beatoraja-lua] dofile(${JSON.stringify(path)}) -> ok (${bytes.length}B)`);
    return 1;
  };
  lua_pushjsfunction(L, dofileFn);
  lua_setglobal(L, to_luastring('dofile'));
}

/**
 * Restore stripped globals as inert stubs so theme code that touches `io`, `os`, or
 * `luajava` (typically inside utility modules that use them for "rotation" features —
 * picking a random background image, persisting state across runs) loads without
 * crashing. The stubs satisfy the Lua surface but do nothing useful — features built on
 * top either silently no-op (file persistence) or fall back to time-based defaults
 * (`os.time()`, `os.date(...)`).
 *
 * Without these, `customfunction.lua` modules in community skins crash at module-load
 * time because `local luajava = require("luajava")` followed by
 * `luajava.bindClass("java.io.File")` raises before any rendering helper has a chance to
 * pcall around it.
 */
function setupCompatStubs(L: lua_State): void {
  // ── `os` ────────────────────────────────────────────────────────────────────────
  // Tiny shim covering `os.time()` and `os.date()` which themes use for log file naming
  // and "today's banner" effects. Other `os.*` calls (`execute`, `remove`, `rename`)
  // return safe defaults — most just need to not throw.
  lua_createtable(L, 0, 4);
  const osTimeFn: LuaCFunction = (state) => {
    lua_pushnumber(state, Math.floor(Date.now() / 1000));
    return 1;
  };
  const osDateFn: LuaCFunction = (state) => {
    const fmt = lua_type(state, 1) === LUA_TSTRING ? lua_tojsstring(state, 1) : '%c';
    const t = lua_type(state, 2) === LUA_TNUMBER ? lua_tonumber(state, 2) * 1000 : Date.now();
    if (fmt === '*t' || fmt === '!*t') {
      const d = new Date(t);
      const useUtc = fmt.startsWith('!');
      lua_createtable(state, 0, 8);
      pushNumberField(state, 'year', useUtc ? d.getUTCFullYear() : d.getFullYear());
      pushNumberField(state, 'month', (useUtc ? d.getUTCMonth() : d.getMonth()) + 1);
      pushNumberField(state, 'day', useUtc ? d.getUTCDate() : d.getDate());
      pushNumberField(state, 'hour', useUtc ? d.getUTCHours() : d.getHours());
      pushNumberField(state, 'min', useUtc ? d.getUTCMinutes() : d.getMinutes());
      pushNumberField(state, 'sec', useUtc ? d.getUTCSeconds() : d.getSeconds());
      pushNumberField(state, 'wday', (useUtc ? d.getUTCDay() : d.getDay()) + 1);
      pushNumberField(state, 'yday', dayOfYear(d, useUtc));
      return 1;
    }
    lua_pushstring(state, to_luastring(formatLuaDate(fmt, new Date(t))));
    return 1;
  };
  const noOpReturnNil: LuaCFunction = () => 0;
  pushClosureField(L, 'time', osTimeFn);
  pushClosureField(L, 'date', osDateFn);
  pushClosureField(L, 'execute', noOpReturnNil);
  pushClosureField(L, 'remove', noOpReturnNil);
  pushClosureField(L, 'rename', noOpReturnNil);
  pushClosureField(L, 'getenv', noOpReturnNil);
  lua_setglobal(L, to_luastring('os'));

  // ── `io` ────────────────────────────────────────────────────────────────────────
  // `io.open` returns a fake file handle whose methods are no-ops — themes use this for
  // log persistence (history files, "rotation" exclude lists). The handle's `:lines()`
  // returns an empty iterator so loops over its lines simply terminate; `:read` returns
  // nil; `:write` chains to itself; `:close` returns true.
  lua_createtable(L, 0, 4);
  const ioOpenFn: LuaCFunction = (state) => {
    pushFakeFileHandle(state);
    return 1;
  };
  const ioLinesFn: LuaCFunction = (state) => {
    lua_pushjsfunction(state, () => {
      lua_pushnil(state);
      return 1;
    });
    return 1;
  };
  pushClosureField(L, 'open', ioOpenFn);
  pushClosureField(L, 'lines', ioLinesFn);
  pushClosureField(L, 'read', noOpReturnNil);
  pushClosureField(L, 'write', noOpReturnNil);
  pushClosureField(L, 'close', noOpReturnNil);
  lua_setglobal(L, to_luastring('io'));

  // ── `luajava` ───────────────────────────────────────────────────────────────────
  // Common in Java-side beatoraja themes that bind `java.io.File` for filesystem
  // walks. We return a deeply-stubbed object so chained calls
  // (`luajava.new(File, path):isDirectory()`) keep returning safe defaults instead of
  // raising. The stubs are exposed both as a global AND as a require-able module to
  // match how beatoraja's Lua bridge surfaces it.
  pushLuajavaStub(L);
  lua_setglobal(L, to_luastring('luajava'));
}

function pushFakeFileHandle(L: lua_State): void {
  lua_createtable(L, 0, 5);
  pushClosureField(L, 'close', () => {
    lua_pushboolean(L, 1);
    return 1;
  });
  pushClosureField(L, 'read', () => 0);
  pushClosureField(L, 'write', (state) => {
    lua_pushvalue(state, 1); // chain to self for `f:write(a):write(b)`
    return 1;
  });
  pushClosureField(L, 'lines', (state) => {
    lua_pushjsfunction(state, () => {
      lua_pushnil(state);
      return 1;
    });
    return 1;
  });
  pushClosureField(L, 'seek', () => {
    lua_pushinteger(L, 0);
    return 1;
  });
}

function pushLuajavaStub(L: lua_State): void {
  lua_createtable(L, 0, 2);
  // bindClass(name) → opaque table that lua_new can use as a "class" handle. The name
  // is captured for diagnostics but doesn't affect behaviour — every method call on
  // the resulting instance returns nil.
  pushClosureField(L, 'bindClass', () => {
    lua_createtable(L, 0, 0);
    return 1;
  });
  pushClosureField(L, 'new', () => {
    // Return a deeply-stubbed instance: every method call returns nil; `tostring`
    // returns a placeholder. The fengari surface doesn't let us trap arbitrary
    // method names cheaply, so we just hand back an empty table — most theme code
    // chains via `pcall` so a "method missing" error gets swallowed.
    lua_createtable(L, 0, 0);
    return 1;
  });
}

function pushClosureField(L: lua_State, key: string, fn: LuaCFunction): void {
  lua_pushjsfunction(L, fn);
  lua_setfield(L, -2, to_luastring(key));
}

function pushNumberField(L: lua_State, key: string, value: number): void {
  lua_pushnumber(L, value);
  lua_setfield(L, -2, to_luastring(key));
}

/**
 * Format a `Date` against Lua's `os.date` format directives. Covers the directives
 * actually used by community skins (`%y`, `%Y`, `%m`, `%d`, `%H`, `%M`, `%S`, `%c`,
 * `%T`, `%R`); other directives pass through verbatim. Time zone follows JS local time
 * unless the format starts with `!` (UTC).
 */
function formatLuaDate(fmt: string, date: Date): string {
  const useUtc = fmt.startsWith('!');
  const f = useUtc ? fmt.slice(1) : fmt;
  const get = (utc: () => number, local: () => number): number => (useUtc ? utc.call(date) : local.call(date));
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  const year = get(date.getUTCFullYear, date.getFullYear);
  const month = get(date.getUTCMonth, date.getMonth) + 1;
  const day = get(date.getUTCDate, date.getDate);
  const hour = get(date.getUTCHours, date.getHours);
  const minute = get(date.getUTCMinutes, date.getMinutes);
  const second = get(date.getUTCSeconds, date.getSeconds);
  return f.replace(/%(.)/g, (_match, dir) => {
    switch (dir) {
      case 'Y':
        return String(year);
      case 'y':
        return pad(year % 100);
      case 'm':
        return pad(month);
      case 'd':
        return pad(day);
      case 'H':
        return pad(hour);
      case 'M':
        return pad(minute);
      case 'S':
        return pad(second);
      case 'T':
        return `${pad(hour)}:${pad(minute)}:${pad(second)}`;
      case 'R':
        return `${pad(hour)}:${pad(minute)}`;
      case 'c':
        return `${pad(year)}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
      case '%':
        return '%';
      default:
        return `%${dir}`;
    }
  });
}

function dayOfYear(d: Date, useUtc: boolean): number {
  const start = useUtc
    ? Date.UTC(d.getUTCFullYear(), 0, 1)
    : new Date(d.getFullYear(), 0, 1).getTime();
  const cur = useUtc ? d.getTime() : d.getTime() - d.getTimezoneOffset() * 60000;
  return Math.floor((cur - start) / 86400000) + 1;
}

/**
 * Push a beatoraja built-in Lua module onto the stack, returning `true` if `name` matches a known one.
 *
 * The Java reference player provides several modules that don't exist as `.lua` files inside themes:
 *
 * - `main_state` (`MainStateAccessor.java`) — runtime state accessors: `option`, `number`,
 *   `float_number`, `text`, `offset`, `timer`, `time`, `set_timer`, `event_exec`, `event_index`,
 *   `timer_off_value`, plus convenience wrappers (`rate`, `exscore`, `exscore_best`, `volume_sys`, …).
 * - `event_command` / `event_index` / `timer_id` — namespaces enumerating known event / timer codes.
 *
 * Without these, third-party themes that `require("main_state")` blow up at the first
 * `main_state.exscore()` call since our prior fallback returned an empty table. We synthesize a stub that
 * covers the API surface with sensible defaults (numbers → 0, strings → '', booleans → false) so the
 * skin's `main()` can complete and emit destinations even when no real engine state is wired. A future
 * patch will let the host inject real implementations for runtime data.
 */
function pushBuiltinLuaModule(
  L: lua_State,
  name: string,
  owner: LuaRuntimeOwner,
  exposeMainState: boolean,
): boolean {
  switch (name) {
    case 'main_state':
      pushMainStateStub(L, owner, exposeMainState);
      return true;
    case 'luajava':
      // Same stub `setupCompatStubs` exposes as a global. Themes commonly do
      // `local luajava = require("luajava")` (the canonical access pattern in
      // beatoraja's Java bridge), so we hand back the same surface here too.
      pushLuajavaStub(L);
      return true;
    default:
      // `timer_util` and `event_util` are seeded as Lua-source modules in
      // `setupCustomRequire` — the regular require path handles them, no special case here.
      return false;
  }
}

function pushMainStateStub(L: lua_State, owner: LuaRuntimeOwner, exposeMainState: boolean): void {
  if (!exposeMainState) {
    lua_createtable(L, 0, 0);
    return;
  }
  // Method names from `MainStateAccessor.export()`. Each is a JS callback that pops its arguments and
  // pushes a default value matching the original Java return type. Stubs are pure — no side effects on
  // engine state — which is the right behavior for skin-render purposes (the skin's `main()` typically
  // calls these to materialize defaults at evaluation time, not to drive runtime).
  lua_createtable(L, 0, 32);

  const numberArg = (state: lua_State, index = 1): number => {
    const value = lua_tonumber(state, index);
    return Number.isFinite(value) ? Math.trunc(value) : 0;
  };
  const numberOrZero = (value: number | undefined): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

  const setNumberAccessor = (key: string, resolve: (ctx: BeatorajaLuaRuntimeContext, state: lua_State) => number | undefined): void => {
    lua_pushjsfunction(L, (state) => {
      lua_pushnumber(state, numberOrZero(resolve(owner.context ?? {}, state)));
      return 1;
    });
    lua_setfield(L, -2, to_luastring(key));
  };
  const setBooleanAccessor = (
    key: string,
    resolve: (ctx: BeatorajaLuaRuntimeContext, state: lua_State) => boolean | undefined,
  ): void => {
    lua_pushjsfunction(L, (state) => {
      lua_pushboolean(state, resolve(owner.context ?? {}, state) ? 1 : 0);
      return 1;
    });
    lua_setfield(L, -2, to_luastring(key));
  };
  const setStringAccessor = (
    key: string,
    resolve: (ctx: BeatorajaLuaRuntimeContext, state: lua_State) => string | undefined,
  ): void => {
    lua_pushjsfunction(L, (state) => {
      lua_pushstring(state, to_luastring(resolve(owner.context ?? {}, state) ?? ''));
      return 1;
    });
    lua_setfield(L, -2, to_luastring(key));
  };
  const setBooleanCommand = (
    key: string,
    run: (ctx: BeatorajaLuaRuntimeContext, state: lua_State) => boolean | undefined,
  ): void => {
    lua_pushjsfunction(L, (state) => {
      lua_pushboolean(state, run(owner.context ?? {}, state) === false ? 0 : 1);
      return 1;
    });
    lua_setfield(L, -2, to_luastring(key));
  };

  // Generic accessors.
  setBooleanAccessor('option', (ctx, state) => ctx.option?.(numberArg(state)) ?? false);
  setNumberAccessor('number', (ctx, state) => ctx.number?.(numberArg(state)));
  setNumberAccessor('float_number', (ctx, state) => ctx.floatNumber?.(numberArg(state)));
  setStringAccessor('text', (ctx, state) => ctx.text?.(numberArg(state)));
  lua_pushjsfunction(L, (state) => {
    const offset = owner.context?.offset?.(numberArg(state)) ?? ZERO_LUA_OFFSET;
    pushJsValueAsLua(state, {
      x: numberOrZero(offset.x),
      y: numberOrZero(offset.y),
      w: numberOrZero(offset.w),
      h: numberOrZero(offset.h),
      r: numberOrZero(offset.r),
      a: numberOrZero(offset.a ?? ZERO_LUA_OFFSET.a),
    });
    return 1;
  });
  lua_setfield(L, -2, to_luastring('offset'));
  setNumberAccessor('timer', (ctx, state) => ctx.timer?.(numberArg(state)) ?? BEATORAJA_LUA_TIMER_OFF_VALUE);
  setNumberAccessor('time', (ctx) => ctx.time?.());
  setNumberAccessor('event_index', (ctx, state) => ctx.eventIndex?.(numberArg(state)));

  // Setters / commands — no return value.
  setBooleanCommand('set_timer', (ctx, state) => ctx.setTimer?.(numberArg(state, 1), lua_tonumber(state, 2)));
  setBooleanCommand('event_exec', (ctx, state) => {
    const id = numberArg(state, 1);
    const top = lua_gettop(state);
    const args: number[] = [];
    for (let i = 2; i <= top; i += 1) args.push(numberArg(state, i));
    return ctx.eventExec?.(id, args);
  });

  // (audit 3.13) `is_event_active` was a phantom binding — never present in beatoraja's
  // `MainStateAccessor`. Skins that wrote against it would behave one way in our runtime
  // (always false) and crash with `attempt to call a nil value` in real beatoraja, encouraging
  // a non-portable surface. Drop the binding so portability tests catch the issue early.

  // Constant: the "timer not started" sentinel beatoraja uses (`Long.MIN_VALUE` on the Java side).
  lua_pushnumber(L, BEATORAJA_LUA_TIMER_OFF_VALUE);
  lua_setfield(L, -2, to_luastring('timer_off_value'));

  // Convenience numeric accessors — same default as `number`.
  setNumberAccessor('rate', (ctx) => ctx.rate?.());
  setNumberAccessor('exscore', (ctx) => ctx.exscore?.());
  setNumberAccessor('rate_best', (ctx) => ctx.rateBest?.());
  setNumberAccessor('exscore_best', (ctx) => ctx.exscoreBest?.());
  setNumberAccessor('rate_rival', (ctx) => ctx.rateRival?.());
  setNumberAccessor('exscore_rival', (ctx) => ctx.exscoreRival?.());
  setNumberAccessor('volume_sys', (ctx) => ctx.volumeSys?.());
  setBooleanCommand('set_volume_sys', (ctx, state) => ctx.setVolumeSys?.(lua_tonumber(state, 1)));
  setNumberAccessor('volume_key', (ctx) => ctx.volumeKey?.());
  setBooleanCommand('set_volume_key', (ctx, state) => ctx.setVolumeKey?.(lua_tonumber(state, 1)));
  setNumberAccessor('volume_bg', (ctx) => ctx.volumeBg?.());
  // (audit 3.13) `volume_bgm` was a phantom alias — beatoraja's `MainStateAccessor` only
  // exposes `volume_bg`. The alias encouraged skin authors to write against a non-portable
  // surface that would crash in real beatoraja. Removed.
  setBooleanCommand('set_volume_bg', (ctx, state) => ctx.setVolumeBg?.(lua_tonumber(state, 1)));
  setNumberAccessor('judge', (ctx, state) => ctx.judge?.(numberArg(state)));
  setNumberAccessor('gauge', (ctx) => ctx.gauge?.());
  setNumberAccessor('gauge_type', (ctx) => ctx.gaugeType?.());

  // Audio API (`audio_play`, `audio_loop`, `audio_stop`). Beatoraja's
  // `MainStateAccessor.audio_*` is the most-called Lua surface in ModernChic — every panel
  // open / close / song change triggers an `audio_play` (`Root/customsound.lua` 80+ sites).
  // Without these defined, the Lua call site hits `attempt to call a nil value` and either
  // crashes the eval (when not pcall'd) or silently disables the panel (when pcall'd). The
  // runtime defines the functions unconditionally even when the host hasn't wired audio so
  // the call returns false instead of crashing; hosts that DO want SE patch in the
  // `audioPlay/Loop/Stop` callbacks via `runtimeContext`.
  const stringArg = (state: lua_State, idx = 1): string => {
    if (lua_type(state, idx) !== LUA_TSTRING) return '';
    return lua_tojsstring(state, idx);
  };
  const optionalNumberArg = (state: lua_State, idx: number, fallback: number): number => {
    if (lua_type(state, idx) !== LUA_TNUMBER) return fallback;
    const v = lua_tonumber(state, idx);
    return Number.isFinite(v) ? v : fallback;
  };
  lua_pushjsfunction(L, (state) => {
    const path = stringArg(state, 1);
    const vol = optionalNumberArg(state, 2, 1);
    const ok = path.length > 0 ? owner.context?.audioPlay?.(path, vol) : false;
    lua_pushboolean(state, ok ? 1 : 0);
    return 1;
  });
  lua_setfield(L, -2, to_luastring('audio_play'));
  lua_pushjsfunction(L, (state) => {
    const path = stringArg(state, 1);
    const vol = optionalNumberArg(state, 2, 1);
    const ok = path.length > 0 ? owner.context?.audioLoop?.(path, vol) : false;
    lua_pushboolean(state, ok ? 1 : 0);
    return 1;
  });
  lua_setfield(L, -2, to_luastring('audio_loop'));
  lua_pushjsfunction(L, (state) => {
    const path = stringArg(state, 1);
    const ok = path.length > 0 ? owner.context?.audioStop?.(path) : false;
    lua_pushboolean(state, ok ? 1 : 0);
    return 1;
  });
  lua_setfield(L, -2, to_luastring('audio_stop'));
}

function setupSkinConfig(L: lua_State, config: BeatorajaLuaSkinConfig | undefined, skinBaseDir: string): void {
  if (config === undefined) {
    lua_pushnil(L);
    lua_setglobal(L, to_luastring('skin_config'));
    return;
  }

  // Build `skin_config` as a fresh Lua table directly (instead of going through
  // `pushJsValueAsLua`) so we can attach a metatable to `skin_config.offset`. Beatoraja's
  // Lua bridge exposes `skin_config.offset` as a NAME-KEYED TABLE — `skin_config.offset[name]`
  // returns an `{x, y, w, h, r, a}` record per declared custom offset. ModernChic and other
  // sophisticated skins access this in deferred property closures:
  //
  //     alpha = function() return skin_config.offset[name].a end
  //     height = function() return skin_config.offset[name].h end
  //
  // Earlier we exposed `skin_config.offset` as a NUMBER (the chart timing offset), which
  // crashed the entire load chain — `skin_config.offset[name]` on a number throws "attempt
  // to index a number value". The chart timing offset stays accessible to the host through
  // the JS-side `BeatorajaLuaSkinConfig.offset` field; nothing on the Lua side reads it.
  lua_createtable(L, 0, 4);

  // option / file tables — pre-populated with the user's confirmed picks.
  pushJsValueAsLua(L, config.option ?? {});
  lua_setfield(L, -2, to_luastring('option'));

  pushJsValueAsLua(L, config.file ?? {});
  lua_setfield(L, -2, to_luastring('file'));

  // offset table with __index → default-zero record.
  // Pre-populate with anything the host already provided (e.g. from the user's slider
  // adjustments); auto-vivify defaults via __index for unknown keys so theme code that
  // reaches into a not-yet-adjusted offset always gets a sensible zero record back.
  pushOffsetTable(L, config.offset);
  lua_setfield(L, -2, to_luastring('offset'));

  // Attach `get_path(rel)` so `dofile(skin_config.get_path("Play/lua/sp/info.lua"))` works.
  // Beatoraja's actual `SkinConfig.get_path` returns the absolute filesystem path; we return
  // `${skinBaseDir}/${rel}` — a logical path string that `dofile` knows how to look up
  // against the bundle's file map. Some skins also use the colon-call form
  // (`skin_config:get_path(rel)`) which Lua passes the table as the first argument; the
  // closure ignores any `self` argument so both call styles work.
  const getPathFn: LuaCFunction = (state) => {
    const argTop = lua_gettop(state);
    let rel = '';
    for (let i = argTop; i >= 1; i -= 1) {
      if (lua_type(state, i) === LUA_TSTRING) {
        rel = lua_tojsstring(state, i);
        break;
      }
    }
    const joined = skinBaseDir.length > 0 && rel.length > 0 ? `${skinBaseDir}/${rel}` : rel;
    lua_pushstring(state, to_luastring(joined));
    return 1;
  };
  lua_pushjsfunction(L, getPathFn);
  lua_setfield(L, -2, to_luastring('get_path'));

  lua_setglobal(L, to_luastring('skin_config'));
}

/**
 * Push a Lua table that acts as the per-name custom-offset map. Pre-populated with whatever
 * the host supplied; missing keys auto-vivify via __index to a default zero record
 * (`{x=0, y=0, w=0, h=0, r=0, a=0}`). Theme closures like
 * `function() return skin_config.offset[name].a end` therefore always succeed even when no
 * explicit value was registered for that name.
 */
function pushOffsetTable(L: lua_State, populated: BeatorajaLuaSkinConfig['offset']): void {
  lua_createtable(L, 0, 0);
  // Only the record form contributes pre-populated entries. The number form (chart timing
  // offset) doesn't surface to Lua — see the field-level docstring. Any unknown name
  // auto-vivifies to a default zero record via the metatable below.
  if (populated && typeof populated === 'object' && !Array.isArray(populated)) {
    for (const [name, value] of Object.entries(populated as Readonly<Record<string, Partial<BeatorajaLuaOffsetValue>>>)) {
      if (value === null || typeof value !== 'object') continue;
      pushJsValueAsLua(L, sanitizeOffsetValue(value));
      lua_setfield(L, -2, to_luastring(name));
    }
  }
  // Metatable: any unknown key returns a default zero record so theme code always sees
  // a `.a` / `.x` etc. accessor without raising. The default record is allocated fresh on
  // each access (Lua's __index isn't allowed to return a global cached table without
  // potential aliasing surprises if the theme mutates it; theme code is read-only against
  // these records but cheap-to-recreate is safer).
  lua_createtable(L, 0, 1);
  const indexFn: LuaCFunction = (state) => {
    pushJsValueAsLua(state, { x: 0, y: 0, w: 0, h: 0, r: 0, a: 0 });
    return 1;
  };
  lua_pushjsfunction(L, indexFn);
  lua_setfield(L, -2, to_luastring('__index'));
  lua_setmetatable(L, -2);
}

function sanitizeOffsetValue(value: Partial<BeatorajaLuaOffsetValue>): BeatorajaLuaOffsetValue {
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    x: num(value.x, 0),
    y: num(value.y, 0),
    w: num(value.w, 0),
    h: num(value.h, 0),
    r: num(value.r, 0),
    a: num(value.a, 0),
  };
}

/**
 * Diagnostic for `require()` resolutions. Direct `console.log` (not via the player-web logger
 * wrapper) so devtools resolves source-line clicks to this file rather than to a logger module.
 */
function logRequire(name: string, kind: 'builtin' | 'module' | 'stub'): void {
  // eslint-disable-next-line no-console
  console.log(`[beatoraja-lua] require(${JSON.stringify(name)}) -> ${kind}`);
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

function popLuaValue(L: lua_State, owner: LuaRuntimeOwner): LuaValue {
  if (lua_type(L, -1) === LUA_TNIL) {
    lua_pop(L, 1);
    return null;
  }
  const value = readLuaValueAt(L, -1, owner);
  lua_pop(L, 1);
  return value;
}

function readLuaValueAt(L: lua_State, idx: number, owner: LuaRuntimeOwner): LuaValue {
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
      return readLuaTableAt(L, idx, owner);
    case LUA_TFUNCTION:
      lua_pushvalue(L, idx);
      return owner.makeFunction(luaL_ref(L, LUA_REGISTRYINDEX));
    default:
      return null;
  }
}

function readLuaTableAt(L: lua_State, idx: number, owner: LuaRuntimeOwner): LuaValue[] | { [key: string]: LuaValue } {
  // Decide array vs record. A table is an array iff every key is a positive integer and they form a contiguous
  // [1..N] sequence with N == #t.
  const arrayLen = lua_rawlen(L, idx);
  if (arrayLen > 0 && tableHasOnlyArrayKeys(L, idx, arrayLen)) {
    const arr: LuaValue[] = Array.from<LuaValue>({ length: arrayLen });
    for (let i = 1; i <= arrayLen; i += 1) {
      lua_rawgeti(L, idx, i);
      arr[i - 1] = readLuaValueAt(L, -1, owner);
      lua_pop(L, 1);
    }
    return arr;
  }

  const obj: { [key: string]: LuaValue } = {};
  let entries = 0;
  const absIdx = absoluteIndex(L, idx);
  lua_pushnil(L);
  while (lua_next(L, absIdx) !== 0) {
    entries += 1;
    const keyType = lua_type(L, -2);
    let key: string | undefined;
    if (keyType === LUA_TSTRING) {
      key = lua_tojsstring(L, -2);
    } else if (keyType === LUA_TNUMBER) {
      key = String(lua_tonumber(L, -2));
    }
    if (key !== undefined) {
      obj[key] = readLuaValueAt(L, -1, owner);
    }
    lua_pop(L, 1); // pop value, keep key for next iteration
  }
  // An empty Lua table (`{}`) is ambiguous — it could be an empty array or an empty record. The
  // reference theme overwhelmingly uses the array reading: `filepath = {}`, `property = {}`,
  // `image = {}` etc. all expect array semantics downstream (`for _, v in ipairs(...)`, JS-side
  // `Array.isArray()` / `for..of` iteration). Returning `{}` here forces every consumer to
  // double-check `Array.isArray(...)` before iterating, which we frequently miss — and the
  // gdbg_bms_package_2022 decide skin trips this exact bug (`filepath = {}` → JS `{}` → consumers
  // try to spread / iterate it → TypeError). Default empty tables to `[]` so the common case
  // works; record-typed tables always populate at least one entry, so this only changes the
  // ambiguous case.
  if (entries === 0) return [];
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

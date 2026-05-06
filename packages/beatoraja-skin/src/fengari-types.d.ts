// Minimal Fengari type surface. Fengari ships no declaration files, so we hand-roll only the bindings the Lua
// evaluator (`beatoraja-skin-lua.ts`) actually touches. Each typed field corresponds 1:1 to a runtime field.

declare module 'fengari' {
  // `lua_State` is opaque from our perspective — we only ever pass it back to fengari APIs.
  // Using a distinct branded type keeps it out of accidental shape-compatible spots.
  export interface lua_State {
    readonly __luaStateBrand: unique symbol;
  }

  export type LuaCFunction = (L: lua_State) => number;

  export const lua: {
    LUA_OK: number;
    LUA_ERRRUN: number;
    LUA_ERRSYNTAX: number;
    LUA_ERRMEM: number;
    LUA_TNIL: number;
    LUA_TBOOLEAN: number;
    LUA_TNUMBER: number;
    LUA_TSTRING: number;
    LUA_TTABLE: number;
    LUA_TFUNCTION: number;
    LUA_TUSERDATA: number;
    LUA_TTHREAD: number;
    LUA_REGISTRYINDEX: number;
    LUA_MULTRET: number;

    lua_call: (L: lua_State, nargs: number, nresults: number) => void;
    lua_pcall: (L: lua_State, nargs: number, nresults: number, errfunc: number) => number;
    lua_createtable: (L: lua_State, narr: number, nrec: number) => void;
    lua_newtable: (L: lua_State) => void;
    lua_pushvalue: (L: lua_State, idx: number) => void;
    lua_pushnil: (L: lua_State) => void;
    lua_pushboolean: (L: lua_State, b: boolean | number) => void;
    lua_pushnumber: (L: lua_State, n: number) => void;
    lua_pushinteger: (L: lua_State, n: number) => void;
    lua_pushstring: (L: lua_State, s: Uint8Array | string | null) => void;
    lua_pushjsfunction: (L: lua_State, fn: LuaCFunction) => void;
    lua_pushcfunction: (L: lua_State, fn: LuaCFunction) => void;
    lua_setfield: (L: lua_State, idx: number, k: Uint8Array | string) => void;
    lua_getfield: (L: lua_State, idx: number, k: Uint8Array | string) => number;
    lua_setglobal: (L: lua_State, name: Uint8Array | string) => void;
    lua_getglobal: (L: lua_State, name: Uint8Array | string) => number;
    lua_settop: (L: lua_State, idx: number) => void;
    lua_gettop: (L: lua_State) => number;
    lua_pop: (L: lua_State, n: number) => void;
    lua_remove: (L: lua_State, idx: number) => void;
    lua_insert: (L: lua_State, idx: number) => void;
    lua_replace: (L: lua_State, idx: number) => void;
    lua_copy: (L: lua_State, fromidx: number, toidx: number) => void;
    lua_type: (L: lua_State, idx: number) => number;
    lua_typename: (L: lua_State, t: number) => Uint8Array;
    lua_isnil: (L: lua_State, idx: number) => boolean;
    lua_isinteger: (L: lua_State, idx: number) => boolean;
    lua_tointeger: (L: lua_State, idx: number) => number;
    lua_tonumber: (L: lua_State, idx: number) => number;
    lua_tostring: (L: lua_State, idx: number) => Uint8Array;
    lua_tojsstring: (L: lua_State, idx: number) => string;
    lua_toboolean: (L: lua_State, idx: number) => boolean;
    lua_next: (L: lua_State, idx: number) => number;
    lua_rawlen: (L: lua_State, idx: number) => number;
    lua_rawget: (L: lua_State, idx: number) => number;
    lua_rawgeti: (L: lua_State, idx: number, n: number) => number;
    lua_rawseti: (L: lua_State, idx: number, n: number) => void;
    lua_settable: (L: lua_State, idx: number) => void;
    lua_concat: (L: lua_State, n: number) => void;
    lua_close: (L: lua_State) => void;
  };

  export const lauxlib: {
    luaL_newstate: () => lua_State;
    luaL_loadbuffer: (L: lua_State, buff: Uint8Array, sz: number, name: Uint8Array | string) => number;
    luaL_loadbufferx: (
      L: lua_State,
      buff: Uint8Array,
      sz: number,
      name: Uint8Array | string,
      mode: Uint8Array | string | null,
    ) => number;
    luaL_loadstring: (L: lua_State, s: Uint8Array | string) => number;
    luaL_requiref: (L: lua_State, modname: Uint8Array | string, openf: LuaCFunction, glb: number) => void;
    luaL_error: (L: lua_State, fmt: Uint8Array | string, ...args: unknown[]) => number;
    luaL_checklstring: (L: lua_State, narg: number) => Uint8Array;
    luaL_checkstring: (L: lua_State, narg: number) => Uint8Array;
    luaL_checknumber: (L: lua_State, narg: number) => number;
    luaL_checkinteger: (L: lua_State, narg: number) => number;
    luaL_checkany: (L: lua_State, narg: number) => void;
    luaL_optstring: (L: lua_State, narg: number, def: Uint8Array | string) => Uint8Array;
    luaL_optnumber: (L: lua_State, narg: number, def: number) => number;
    luaL_optinteger: (L: lua_State, narg: number, def: number) => number;
    luaL_dostring: (L: lua_State, s: Uint8Array | string) => number;
  };

  export const lualib: {
    luaL_openlibs: (L: lua_State) => void;
  };

  export function to_luastring(s: string): Uint8Array;
  export function to_jsstring(s: Uint8Array | string): string;
  export function luastring_of(...bytes: number[]): Uint8Array;
}

// `fengari-web` re-exports the same `lua` / `lauxlib` / `lualib` / `to_luastring` shapes as `fengari` itself, so we
// declare it as the same module surface.
declare module 'fengari-web' {
  export {
    lua_State,
    LuaCFunction,
    lua,
    lauxlib,
    lualib,
    to_luastring,
    to_jsstring,
    luastring_of,
  } from 'fengari';
}

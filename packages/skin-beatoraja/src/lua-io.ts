// The `io` library and the file half of `os` that a beatoraja Lua skin sees.
//
// beatoraja gives a skin real files: `io.open` reads and writes through `RandomAccessFile`, and opening a missing file
// for reading fails (`SkinLuaAccessor`). Be-Music runs skins in a browser sandbox with no file system, so it cannot
// keep what a skin writes. It must not pretend to either: a handle that accepts every write and reads back nothing
// sends a skin down its success path while its state disappears (#1196).
//
// This module gives the sandbox a file store that lives in memory for one Lua runtime, which is one evaluation of
// one skin scene:
//
// - A file exists once the skin has written it, and reads back what was written.
// - Opening a file that was never written for reading fails as Lua specifies: `nil`, a message and an error number,
//   so a skin's own existence check (`io.open(path, "r") == nil`) and its `pcall` paths see the truth.
// - Nothing outlives the runtime. No read ever reaches a real file, and no write ever leaves memory.
//
// Community skins write to files without checking `io.open`'s result (ModernChic's result screen appends its play
// history that way), so failing every write would raise Lua errors in skins that work in beatoraja. Keeping writes for
// the runtime's lifetime keeps those skins running, and what they read back is what they wrote.

import fengariWeb from 'fengari-web';
import type { lua_State, LuaCFunction } from 'fengari-web';

const { lauxlib, lua, to_luastring } = fengariWeb;
const {
  LUA_TNUMBER,
  LUA_TSTRING,
  lua_createtable,
  lua_gettop,
  lua_pushboolean,
  lua_pushinteger,
  lua_pushjsfunction,
  lua_pushnil,
  lua_pushnumber,
  lua_pushstring,
  lua_pushvalue,
  lua_setfield,
  lua_tojsstring,
  lua_tonumber,
  lua_type,
} = lua;
const { luaL_error } = lauxlib;

/** `ENOENT`, the error number Lua reports with a missing file. */
const LUA_ERRNO_NO_ENTRY = 2;
/** `EBADF`, the error number Lua reports for a handle used against its mode. */
const LUA_ERRNO_BAD_FILE = 9;

/** The files one Lua runtime has written, by the path the skin used. Contents are text; nothing is persisted. */
export type LuaVirtualFiles = Map<string, string>;

/** An empty store for one Lua runtime. */
export function createLuaVirtualFiles(): LuaVirtualFiles {
  return new Map();
}

/** How `io.open`'s mode string opens a file, or `undefined` for a mode Lua rejects. */
export interface LuaFileMode {
  readable: boolean;
  writable: boolean;
  /** Every write goes to the end (`a`). */
  append: boolean;
  /** The file is emptied on open (`w`). */
  truncate: boolean;
  /** The file must already exist (`r`). */
  mustExist: boolean;
}

/** Parses an `io.open` mode (`r`, `w`, `a`, each optionally with `+` and `b`), as Lua's `l_checkmode` accepts them. */
export function parseLuaFileMode(mode: string): LuaFileMode | undefined {
  const match = /^([rwa])(\+?)b?$/.exec(mode);
  if (match === null) return undefined;
  const [, kind, plus] = match;
  const update = plus === '+';
  return {
    readable: kind === 'r' || update,
    writable: kind !== 'r' || update,
    append: kind === 'a',
    truncate: kind === 'w',
    mustExist: kind === 'r',
  };
}

/** One `read` format's result from `text` at `position`: the value (`undefined` at end of file) and the next position. */
export function readLuaFileFormat(
  text: string,
  position: number,
  format: string | number,
): { value: string | number | undefined; position: number } {
  if (typeof format === 'number') {
    const count = Math.max(0, Math.trunc(format));
    // A count, even 0, reads nil at end of file.
    if (position >= text.length) return { value: undefined, position };
    return { value: text.slice(position, position + count), position: Math.min(text.length, position + count) };
  }
  const name = format.startsWith('*') ? format.slice(1) : format;
  switch (name.charAt(0)) {
    case 'a':
      // The whole rest of the file; an empty string, never nil, at end of file.
      return { value: text.slice(position), position: text.length };
    case 'n': {
      const match = /^\s*[-+]?(?:0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)/.exec(
        text.slice(position),
      );
      if (match === null) return { value: undefined, position };
      return { value: Number(match[0]), position: position + match[0].length };
    }
    case 'L':
    case 'l': {
      if (position >= text.length) return { value: undefined, position };
      const end = text.indexOf('\n', position);
      const stop = end < 0 ? text.length : end + 1;
      const line = text.slice(position, name.charAt(0) === 'L' || end < 0 ? stop : end);
      return { value: line, position: stop };
    }
    default:
      return { value: undefined, position };
  }
}

function pushFailure(L: lua_State, message: string, errno: number): number {
  lua_pushnil(L);
  lua_pushstring(L, to_luastring(message));
  lua_pushinteger(L, errno);
  return 3;
}

function pushField(L: lua_State, key: string, fn: LuaCFunction): void {
  lua_pushjsfunction(L, fn);
  lua_setfield(L, -2, to_luastring(key));
}

function pushReadValue(L: lua_State, value: string | number | undefined): void {
  if (value === undefined) lua_pushnil(L);
  else if (typeof value === 'number') lua_pushnumber(L, value);
  else lua_pushstring(L, to_luastring(value));
}

/** The argument at `index` as a `read` format: a count, a format name, or `l` when it is neither. */
function readFormatAt(L: lua_State, index: number): string | number {
  if (lua_type(L, index) === LUA_TNUMBER) return lua_tonumber(L, index);
  return lua_type(L, index) === LUA_TSTRING ? lua_tojsstring(L, index) : 'l';
}

/** Pushes an open handle on `path`: a table of methods over the store, called as `f:read()`, `f:write()`, ... */
function pushFileHandle(L: lua_State, files: LuaVirtualFiles, path: string, mode: LuaFileMode): void {
  let position = mode.append ? (files.get(path) ?? '').length : 0;
  let closed = false;
  const text = (): string => files.get(path) ?? '';
  const closedFailure = (state: lua_State): number =>
    pushFailure(state, 'attempt to use a closed file', LUA_ERRNO_BAD_FILE);

  lua_createtable(L, 0, 7);
  pushField(L, 'read', (state) => {
    if (closed) return closedFailure(state);
    if (!mode.readable) return pushFailure(state, `${path}: file is not open for reading`, LUA_ERRNO_BAD_FILE);
    const count = Math.max(1, lua_gettop(state) - 1);
    for (let index = 0; index < count; index += 1) {
      const result = readLuaFileFormat(
        text(),
        position,
        lua_gettop(state) >= index + 2 ? readFormatAt(state, index + 2) : 'l',
      );
      position = result.position;
      pushReadValue(state, result.value);
      // Lua stops at the first format that fails, returning nil for it.
      if (result.value === undefined) return index + 1;
    }
    return count;
  });
  pushField(L, 'lines', (state) => {
    const format = lua_gettop(state) >= 2 ? readFormatAt(state, 2) : 'l';
    lua_pushjsfunction(state, (inner) => {
      if (closed || !mode.readable) {
        lua_pushnil(inner);
        return 1;
      }
      const result = readLuaFileFormat(text(), position, format);
      position = result.position;
      pushReadValue(inner, result.value);
      return 1;
    });
    return 1;
  });
  pushField(L, 'write', (state) => {
    if (closed) return closedFailure(state);
    if (!mode.writable) return pushFailure(state, `${path}: file is not open for writing`, LUA_ERRNO_BAD_FILE);
    let written = '';
    for (let index = 2; index <= lua_gettop(state); index += 1) {
      const type = lua_type(state, index);
      if (type !== LUA_TSTRING && type !== LUA_TNUMBER)
        return luaL_error(state, to_luastring(`bad argument #${index - 1} to 'write' (string expected)`));
      written += lua_tojsstring(state, index);
    }
    const current = text();
    const at = mode.append ? current.length : Math.min(position, current.length);
    files.set(path, current.slice(0, at) + written + current.slice(at + written.length));
    position = at + written.length;
    // The handle itself, so `f:write(a):write(b)` chains.
    lua_pushvalue(state, 1);
    return 1;
  });
  pushField(L, 'seek', (state) => {
    if (closed) return closedFailure(state);
    const whence = lua_type(state, 2) === LUA_TSTRING ? lua_tojsstring(state, 2) : 'cur';
    const offset = lua_type(state, 3) === LUA_TNUMBER ? Math.trunc(lua_tonumber(state, 3)) : 0;
    const base = whence === 'set' ? 0 : whence === 'end' ? text().length : position;
    if (base + offset < 0) return pushFailure(state, 'Invalid argument', 22);
    position = base + offset;
    lua_pushinteger(state, position);
    return 1;
  });
  const succeed: LuaCFunction = (state) => {
    if (closed) return closedFailure(state);
    lua_pushboolean(state, 1);
    return 1;
  };
  pushField(L, 'flush', succeed);
  pushField(L, 'setvbuf', succeed);
  pushField(L, 'close', (state) => {
    if (closed) return closedFailure(state);
    closed = true;
    lua_pushboolean(state, 1);
    return 1;
  });
}

function pathAt(L: lua_State, index: number): string | undefined {
  return lua_type(L, index) === LUA_TSTRING ? lua_tojsstring(L, index) : undefined;
}

/** Pushes the `io` table over `files`: `open`, `lines`, `type`, and the standard streams as empty ones. */
export function pushLuaVirtualIO(L: lua_State, files: LuaVirtualFiles): void {
  lua_createtable(L, 0, 6);
  pushField(L, 'open', (state) => {
    const path = pathAt(state, 1);
    if (path === undefined) return luaL_error(state, to_luastring("bad argument #1 to 'open' (string expected)"));
    const modeText = lua_type(state, 2) === LUA_TSTRING ? lua_tojsstring(state, 2) : 'r';
    const mode = parseLuaFileMode(modeText);
    if (mode === undefined) return luaL_error(state, to_luastring("bad argument #2 to 'open' (invalid mode)"));
    if (!files.has(path)) {
      // Be-Music reads no real file: one the skin never wrote does not exist.
      if (mode.mustExist) return pushFailure(state, `${path}: No such file or directory`, LUA_ERRNO_NO_ENTRY);
      files.set(path, '');
    } else if (mode.truncate) {
      files.set(path, '');
    }
    pushFileHandle(state, files, path, mode);
    return 1;
  });
  pushField(L, 'lines', (state) => {
    const path = pathAt(state, 1);
    // Without a name it reads the standard input, which is empty here.
    if (path === undefined) {
      lua_pushjsfunction(state, (inner) => {
        lua_pushnil(inner);
        return 1;
      });
      return 1;
    }
    // Lua raises an error here instead of returning one.
    if (!files.has(path)) return luaL_error(state, to_luastring(`${path}: No such file or directory`));
    let position = 0;
    lua_pushjsfunction(state, (inner) => {
      const result = readLuaFileFormat(files.get(path) ?? '', position, 'l');
      position = result.position;
      pushReadValue(inner, result.value);
      return 1;
    });
    return 1;
  });
  // The standard streams: nothing to read, and a write goes nowhere. They are not files a skin can keep state in.
  const nothing: LuaCFunction = () => 0;
  pushField(L, 'read', nothing);
  pushField(L, 'write', nothing);
  pushField(L, 'close', nothing);
}

/** Adds `remove` and `rename` over `files` to the `os` table on top of the stack. */
export function pushLuaVirtualFileOps(L: lua_State, files: LuaVirtualFiles): void {
  pushField(L, 'remove', (state) => {
    const path = pathAt(state, 1);
    if (path === undefined || !files.delete(path))
      return pushFailure(state, `${path ?? ''}: No such file or directory`, LUA_ERRNO_NO_ENTRY);
    lua_pushboolean(state, 1);
    return 1;
  });
  pushField(L, 'rename', (state) => {
    const from = pathAt(state, 1);
    const to = pathAt(state, 2);
    const content = from === undefined ? undefined : files.get(from);
    if (from === undefined || to === undefined || content === undefined)
      return pushFailure(state, `${from ?? ''}: No such file or directory`, LUA_ERRNO_NO_ENTRY);
    files.delete(from);
    files.set(to, content);
    lua_pushboolean(state, 1);
    return 1;
  });
}

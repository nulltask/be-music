/**
 * Whether the Lua sandbox logs each `require()` and `dofile()` it resolves, to trace a skin's load. Off, so a player's
 * console stays quiet: a skin's load resolves dozens of them. Turn it on in source while debugging a skin, as
 * player-web's `BEATORAJA_VIEW_DIAGNOSTICS`. A module that is not found and a `dofile` that fails warn either way.
 */
const BEATORAJA_LUA_DIAGNOSTICS = false;

/**
 * Logs how a `require()` resolved, behind {@link BEATORAJA_LUA_DIAGNOSTICS}. Direct `console.log` (not via the
 * player-web logger wrapper) so devtools resolves source-line clicks to the sandbox rather than to a logger module.
 */
export function logLuaRequire(name: string, kind: 'builtin' | 'module' | 'stub'): void {
  if (!BEATORAJA_LUA_DIAGNOSTICS) return;
  // eslint-disable-next-line no-console
  console.log(`[beatoraja-lua] require(${JSON.stringify(name)}) -> ${kind}`);
}

/** Logs a `dofile()` that loaded, behind {@link BEATORAJA_LUA_DIAGNOSTICS}. */
export function logLuaDofile(path: string, byteLength: number): void {
  if (!BEATORAJA_LUA_DIAGNOSTICS) return;
  // eslint-disable-next-line no-console
  console.log(`[beatoraja-lua] dofile(${JSON.stringify(path)}) -> ok (${byteLength}B)`);
}

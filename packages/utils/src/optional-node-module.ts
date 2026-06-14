// Lazy-load Node built-ins so the module remains importable from a browser bundle (same pattern as
// `./log.ts`); the fallback only runs after the caller's own dynamic import already failed.

/**
 * Environment variable naming an extra base directory whose `node_modules` is consulted by
 * {@link loadOptionalNodeModule}. SEA binaries point it at the directory where their embedded modules were
 * extracted (see `player-tui/src/node/sea-embedded-modules.ts`); it propagates to worker threads through
 * the inherited environment.
 */
export const OPTIONAL_NODE_MODULE_DIR_ENV = 'BE_MUSIC_OPTIONAL_NODE_MODULE_DIR';

/**
 * Load an optional dependency that may be missing at runtime (native addons, large wasm packages).
 *
 * In a Node single executable application (SEA), `import()` of a bare specifier always fails with
 * `ERR_UNKNOWN_BUILTIN_MODULE` — the SEA module system never consults the filesystem. When the caller's
 * import fails, retry through `createRequire` anchored next to the executable, then the directory named by
 * {@link OPTIONAL_NODE_MODULE_DIR_ENV}, then the working directory, so a SEA binary can load these modules
 * from a `node_modules` directory shipped alongside it or extracted from its embedded assets.
 *
 * Returns `undefined` when the module cannot be loaded from any location.
 */
export async function loadOptionalNodeModule<T>(
  specifier: string,
  importModule: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await importModule();
  } catch {
    return await requireFromRuntimeDirectories<T>(specifier);
  }
}

async function requireFromRuntimeDirectories<T>(specifier: string): Promise<T | undefined> {
  try {
    const [{ createRequire }, { dirname, join }] = await Promise.all([import('node:module'), import('node:path')]);
    const envBaseDir = process.env[OPTIONAL_NODE_MODULE_DIR_ENV];
    const baseDirs = [dirname(process.execPath), ...(envBaseDir ? [envBaseDir] : []), process.cwd()];
    for (const baseDir of baseDirs) {
      try {
        const requireFromBase = createRequire(join(baseDir, '__optional-node-module-resolver__.cjs'));
        return requireFromBase(specifier) as T;
      } catch {
        // Keep probing the remaining base directories.
      }
    }
  } catch {
    // node:module / node:path are unavailable (non-Node runtime); report the module as missing.
  }
  return undefined;
}

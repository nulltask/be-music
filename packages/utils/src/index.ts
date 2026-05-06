export * from './core.ts';
export * from './log.ts';
export * from './path.ts';
export * from './pcm.ts';
// `./workerize.ts` is intentionally NOT re-exported here — it statically imports `node:sea`, which Vite
// externalises and crashes the browser bundle on first load. Node-only callers (the TUI / CLI) reach the
// helpers directly via the `@be-music/utils/workerize` sub-path export instead.

/**
 * Resolves a CLI-supplied path string against `cwd`. CLI callers feed real file paths through here; the
 * function falls into a `node:path.resolve` slow path only when the input contains parent traversal (`..`) or
 * a Windows-style separator, which CLI invocations frequently produce on Windows. The fast paths (relative
 * without traversal) are pure string concatenation and run unchanged in browsers.
 *
 * The slow path defers to `node:path` via a synchronous Node-only `require`. Browser bundles never reach the
 * slow path under normal usage (CLI helpers aren't on the web call graph), and even if they did, the function
 * returns `cwd` unchanged when running outside Node so a stray import doesn't crash the bundle.
 *
 * `process.env.INIT_CWD` / `process.cwd()` are read off `globalThis` so this module's static type signature
 * doesn't pin it to a Node-only `process` global.
 */
export function resolveCliPath(path: string, cwd: string = resolveDefaultCwd()): string {
  if (path.length === 0 || path === '.') {
    return cwd;
  }

  // Absolute paths return as-is. POSIX absolute paths begin with '/'; Windows drive paths (`C:\foo`,
  // `C:/foo`) start with a letter followed by `:`. Without this fast-path branch the absolute-path case
  // fell through to the `node:path` slow path below, which silently returned `cwd` whenever the lazy
  // `require` lookup failed (= every pure-ESM Node runtime, e.g. `tsx` / `node --import tsx/esm`) — turning
  // every CLI invocation with an absolute argument into "scan cwd as a directory."
  const firstCode = path.charCodeAt(0);
  if (firstCode === 0x2f) {
    return path;
  }
  if (path.length >= 3 && isWindowsDrivePath(path)) {
    return path;
  }

  // Most CLI paths are simple relative paths without parent traversal. After the absolute-path branches
  // above rule out POSIX / Windows absolute inputs, any string that doesn't contain `..` or a backslash
  // is a plain relative path that just needs `cwd` prepended.
  if (!path.includes('..') && !path.includes('\\')) {
    if (path.startsWith('./')) {
      const relativePath = path.slice(2);
      if (relativePath.length === 0) {
        return cwd;
      }
      return cwd.endsWith('/') ? `${cwd}${relativePath}` : `${cwd}/${relativePath}`;
    }
    return cwd.endsWith('/') ? `${cwd}${path}` : `${cwd}/${path}`;
  }
  // `node:path` slow path — only needed for parent-traversal / Windows-separator inputs. Loaded synchronously
  // through Node's built-in `require` so the import doesn't sit at module scope (which Vite would externalise
  // and crash a browser bundle on first load). Browser bundles fall back to returning `cwd` unchanged, which
  // is sufficient because the slow path isn't on the web's call graph.
  const nodeRequire = resolveNodeRequire();
  if (!nodeRequire) {
    return cwd;
  }
  const { resolve } = nodeRequire('node:path') as typeof import('node:path');
  return resolve(cwd, path);
}

/**
 * Returns true for Windows drive-relative paths like `C:\foo`, `C:/foo`, or just `C:` (current dir on
 * drive C). The CLI receives these from PowerShell / cmd users on Windows.
 */
function isWindowsDrivePath(path: string): boolean {
  const driveLetter = path.charCodeAt(0);
  if (
    !(
      (
        (driveLetter >= 0x41 && driveLetter <= 0x5a) || // A..Z
        (driveLetter >= 0x61 && driveLetter <= 0x7a)
      ) // a..z
    )
  ) {
    return false;
  }
  if (path.charCodeAt(1) !== 0x3a) return false;
  const sep = path.charCodeAt(2);
  return sep === 0x2f || sep === 0x5c;
}

function resolveDefaultCwd(): string {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined>; cwd?: () => string } }).process;
  return proc?.env?.INIT_CWD ?? proc?.cwd?.() ?? '.';
}

type NodeRequire = (id: string) => unknown;

function resolveNodeRequire(): NodeRequire | undefined {
  const globalRequire = (globalThis as { require?: NodeRequire }).require;
  if (typeof globalRequire === 'function') {
    return globalRequire;
  }
  // ESM-only Node runtime — `require` isn't on the global, but the builtin can be resolved via `eval('require')`.
  // Wrapped in a guard so non-Node environments (browsers) skip the eval entirely.
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
  if (typeof proc?.versions?.node !== 'string') {
    return undefined;
  }
  try {
    // eslint-disable-next-line no-eval
    return (0, eval)('require') as NodeRequire;
  } catch {
    return undefined;
  }
}

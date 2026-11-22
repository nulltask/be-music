/**
 * Resolves a CLI-supplied path string against `cwd`. CLI callers feed real file paths through here; the
 * function falls into a `node:path.resolve` slow path only when the input contains parent traversal (`..`) or
 * a Windows-style separator, which CLI invocations frequently produce on Windows. The fast paths (relative
 * without traversal) are pure string concatenation and run unchanged in browsers.
 *
 * Node's process.getBuiltinModule loads the resolver synchronously in both ESM and CommonJS.
 * Outside Node, the slow path returns `cwd`.
 */
export function resolveCLIPath(path: string, cwd: string = resolveDefaultCwd()): string {
  if (path.length === 0 || path === '.') {
    return cwd;
  }

  // Keep absolute POSIX and Windows paths verbatim.
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
  const proc = (globalThis as { process?: typeof process }).process;
  const nodePath = proc?.getBuiltinModule?.('node:path');
  return nodePath ? nodePath.resolve(cwd, path) : cwd;
}

/**
 * Returns true for Windows drive-relative paths like `C:\foo`, `C:/foo`, or just `C:` (current dir on
 * drive C). The CLI receives these from PowerShell / cmd users on Windows.
 */
function isWindowsDrivePath(path: string): boolean {
  const driveLetter = path.charCodeAt(0);
  const isUpperDriveLetter = driveLetter >= 0x41 && driveLetter <= 0x5a; // A..Z
  const isLowerDriveLetter = driveLetter >= 0x61 && driveLetter <= 0x7a; // a..z
  if (!isUpperDriveLetter && !isLowerDriveLetter) {
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

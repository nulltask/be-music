import { isAbortError, throwIfAborted } from './abort.ts';
import { isMaliciousAssetPath } from './core.ts';

// `node:fs/promises` and `node:path` are loaded lazily inside `resolveFirstExistingPath` / `pathExists` so this
// module can be re-exported from `@be-music/utils` (the package root) without dragging the Node built-ins into a
// browser bundle. Vite externalises `node:`-prefixed imports for browser targets, but only emits a runtime error
// if the externalised symbol is actually accessed; keeping these lazy confines that to the Node-specific call
// paths the browser never exercises.
type NodeFsPromises = typeof import('node:fs/promises');
type NodePath = typeof import('node:path');
let nodeFsPromisesPromise: Promise<NodeFsPromises> | undefined;
let nodePathPromise: Promise<NodePath> | undefined;
const loadNodeFsPromises = (): Promise<NodeFsPromises> => (nodeFsPromisesPromise ??= import('node:fs/promises'));
const loadNodePath = (): Promise<NodePath> => (nodePathPromise ??= import('node:path'));

/**
 * Resolves the first existing path among `candidates`, interpreted relative to `baseDir`. Each candidate is vetted
 * against the bmson 1.0.0 spec's malicious-path constraints before any filesystem access:
 *
 * - Absolute paths (`/etc/passwd`, `C:\\passwords.txt`), parent-directory traversals (`../../config.php`), and null
 *   bytes are rejected by `isMaliciousAssetPath` and never touch \`fs.access\`.
 * - The resolved absolute path is additionally pinned to `baseDir` — even if a candidate slipped through the per-string
 *   check, the post-resolve containment guard refuses to return paths outside the chart bundle.
 *
 * Both layers are defense-in-depth — the per-string predicate catches the obvious shapes before we even spawn a
 * syscall; the containment check catches anything subtle (symlinks, platform-specific path quirks, future additions to
 * the candidate generator).
 */
export async function resolveFirstExistingPath(
  baseDir: string,
  candidates: Iterable<string>,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const { resolve, sep } = await loadNodePath();
  const baseAbsolute = resolve(baseDir);
  // Trailing-separator normalized form lets the containment check work regardless of whether `baseDir` was passed with
  // or without a slash — `/foo` vs `/foo/` both produce `/foo/` for the prefix comparison.
  const baseAbsoluteWithSep = baseAbsolute.endsWith(sep) ? baseAbsolute : baseAbsolute + sep;
  for (const candidate of candidates) {
    throwIfAborted(signal);
    if (isMaliciousAssetPath(candidate)) {
      continue;
    }
    const absolute = resolve(baseDir, candidate);
    // Containment guard — the resolved path must either be `baseDir` itself or sit underneath it. Anything outside
    // (e.g. via symlinks the caller already followed, or via exotic candidate shapes that escaped the string check) is
    // treated as not-found.
    if (absolute !== baseAbsolute && !absolute.startsWith(baseAbsoluteWithSep)) {
      continue;
    }
    if (await pathExists(absolute, signal)) {
      return absolute;
    }
  }
  return undefined;
}

async function pathExists(path: string, signal?: AbortSignal): Promise<boolean> {
  try {
    throwIfAborted(signal);
    const { access } = await loadNodeFsPromises();
    await access(path);
    throwIfAborted(signal);
    return true;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return false;
  }
}

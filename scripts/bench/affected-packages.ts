// Picks the benchmarked packages a pull request can have changed the speed of, so the PR benchmark measures only those:
// the packages whose files it touches and every benchmarked package that depends on them, directly or through other
// workspace packages. A change outside `packages/` (the benchmark itself, the lockfile, the root config) can move any
// number, so it measures them all.
//
//   git diff --name-only BASE HEAD | node --conditions=source scripts/bench/affected-packages.ts
//
// prints the comma-separated list `pnpm run bench --packages` takes.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PACKAGE_NAMES, type PackageName } from './exports.types.ts';

const SCOPE = '@be-music/';

/**
 * The benchmarked packages `changedFiles` (repository-relative paths) can affect, in {@link PACKAGE_NAMES} order.
 * `dependencies` maps each workspace package directory name to the workspace packages it depends on (by directory
 * name). All of them when a file outside `packages/` changed, or when nothing benchmarked is affected (a PR that runs the
 * benchmark at all touched something the filter counts).
 */
export function resolveAffectedBenchPackages(
  changedFiles: readonly string[],
  dependencies: Readonly<Record<string, readonly string[]>>,
): PackageName[] {
  const changed = new Set<string>();
  for (const file of changedFiles) {
    const match = /^packages\/([^/]+)\//.exec(file.trim());
    if (match === null) {
      if (file.trim() !== '') return [...PACKAGE_NAMES];
      continue;
    }
    changed.add(match[1]!);
  }
  // Walk the reverse dependencies until nothing new is reached.
  const affected = new Set(changed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, deps] of Object.entries(dependencies)) {
      if (!affected.has(name) && deps.some((dep) => affected.has(dep))) {
        affected.add(name);
        grew = true;
      }
    }
  }
  const benchmarked = PACKAGE_NAMES.filter((name) => affected.has(name));
  return benchmarked.length > 0 ? benchmarked : [...PACKAGE_NAMES];
}

/** Each workspace package's workspace dependencies, read from `packages/<name>/package.json`. */
export function readWorkspaceDependencies(rootDir: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const name of readdirSync(join(rootDir, 'packages'))) {
    let manifest: { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
    try {
      manifest = JSON.parse(readFileSync(join(rootDir, 'packages', name, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    result[name] = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })
      .filter((dependency) => dependency.startsWith(SCOPE))
      .map((dependency) => dependency.slice(SCOPE.length));
  }
  return result;
}

if (import.meta.main) {
  const changedFiles = readFileSync(0, 'utf8').split('\n');
  const rootDir = resolve(import.meta.dirname, '../..');
  process.stdout.write(resolveAffectedBenchPackages(changedFiles, readWorkspaceDependencies(rootDir)).join(','));
}

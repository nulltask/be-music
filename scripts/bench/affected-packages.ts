// Select changed packages and their transitive benchmarked dependents for both PR and push comparisons.
// Documentation, test-only and other workflow changes need no measurement. Shared tooling, dependency manifests and
// the CI workflow that runs the benchmark measure all.
// Usage: git diff --name-only BASE HEAD | node --conditions=source scripts/bench/affected-packages.ts
// Prints a comma-separated --packages list; an empty result means CI must skip measurement.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PACKAGE_NAMES, type PackageName } from './exports.types.ts';

const SCOPE = '@be-music/';

/** Resolve measurement scope in inventory order, including dependencies through unmeasured packages. */
export function resolveAffectedBenchPackages(
  changedFiles: readonly string[],
  dependencies: Readonly<Record<string, readonly string[]>>,
): PackageName[] {
  const changed = new Set<string>();
  for (const file of changedFiles) {
    const path = file.trim();
    if (
      path === '' ||
      path.endsWith('.md') ||
      /^(docs|\.changeset)\//.test(path) ||
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
      // Workflows, issue templates and the like run no package code; `ci.yml` holds the benchmark steps themselves.
      (path.startsWith('.github/') && path !== '.github/workflows/ci.yml')
    )
      continue;
    // A removed dependency edge is absent from the head graph. Measuring all manifest changes also covers its
    // former dependents without needing the base checkout's graph.
    if (/^packages\/[^/]+\/package\.json$/.test(path)) return [...PACKAGE_NAMES];
    const match = /^packages\/([^/]+)\//.exec(path);
    if (match === null) {
      return [...PACKAGE_NAMES];
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
  return PACKAGE_NAMES.filter((name) => affected.has(name));
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

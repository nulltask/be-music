// Select the changed packages for both PR and push comparisons: only the packages whose files changed, not what
// depends on them. Documentation, test-only and other workflow changes need no measurement. Shared tooling, the root
// dependency manifests and the CI workflow that runs the benchmark measure all.
// Usage: git diff --name-only BASE HEAD | node --conditions=source scripts/bench/affected-packages.ts
// Prints a comma-separated --packages list; an empty result means CI must skip measurement.
import { readFileSync } from 'node:fs';
import { PACKAGE_NAMES, type PackageName } from './exports.types.ts';

/** Resolve measurement scope in inventory order: the measured packages among those whose files changed. */
export function resolveAffectedBenchPackages(changedFiles: readonly string[]): PackageName[] {
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
    const match = /^packages\/([^/]+)\//.exec(path);
    if (match === null) {
      return [...PACKAGE_NAMES];
    }
    changed.add(match[1]!);
  }
  return PACKAGE_NAMES.filter((name) => changed.has(name));
}

if (import.meta.main) {
  const changedFiles = readFileSync(0, 'utf8').split('\n');
  process.stdout.write(resolveAffectedBenchPackages(changedFiles).join(','));
}

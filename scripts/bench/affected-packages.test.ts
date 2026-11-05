import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vite-plus/test';
import { PACKAGE_NAMES } from './exports.types.ts';
import { resolveAffectedBenchPackages } from './affected-packages.ts';

describe('resolveAffectedBenchPackages', () => {
  test('measures only the changed packages, not what depends on them, in benchmark order', () => {
    expect(resolveAffectedBenchPackages(['packages/player-engine/src/core/engine.ts'])).toEqual(['player-engine']);
    expect(
      resolveAffectedBenchPackages(['packages/player-browser/src/a.ts', 'packages/chart-model/src/b.ts', '']),
    ).toEqual(PACKAGE_NAMES.filter((name) => name === 'chart-model' || name === 'player-browser'));
  });

  test('measures a package whose own manifest changed, and nothing else', () => {
    expect(resolveAffectedBenchPackages(['packages/player-engine/package.json'])).toEqual(['player-engine']);
  });

  test('measures shared tooling and the root manifests in full', () => {
    expect(resolveAffectedBenchPackages(['packages/player-engine/src/a.ts', 'pnpm-lock.yaml'])).toEqual([
      ...PACKAGE_NAMES,
    ]);
    expect(resolveAffectedBenchPackages(['scripts/bench/exports.ts'])).toEqual([...PACKAGE_NAMES]);
    expect(resolveAffectedBenchPackages(['vite.config.ts'])).toEqual([...PACKAGE_NAMES]);
  });

  test('ignores documentation and test changes without broadening a runtime change', () => {
    const ignored = [
      'README.md',
      'docs/architecture.ja.md',
      '.changeset/player-fix.md',
      'packages/player-engine/README.md',
      'packages/player-engine/src/core/engine.test.ts',
      'packages/player-browser/src/example.spec.tsx',
      '',
    ];
    expect(resolveAffectedBenchPackages(ignored)).toEqual([]);
    expect(resolveAffectedBenchPackages([...ignored, 'packages/player-browser/src/a.ts'])).toEqual(['player-browser']);
  });

  test('measures nothing for other workflow changes, and everything for the benchmark workflow', () => {
    expect(resolveAffectedBenchPackages(['.github/workflows/e2e.yml', '.github/dependabot.yml'])).toEqual([]);
    expect(resolveAffectedBenchPackages(['.github/workflows/ci.yml'])).toEqual([...PACKAGE_NAMES]);
  });

  test('skips changes to packages the benchmark does not measure, including an empty change list', () => {
    expect(resolveAffectedBenchPackages(['packages/app-leaderboard/src/app.ts'])).toEqual([]);
    expect(resolveAffectedBenchPackages([])).toEqual([]);
  });

  test('keeps fixtures and deleted runtime paths in scope', () => {
    expect(resolveAffectedBenchPackages(['packages/player-browser/fixtures/chart.bms'])).toEqual(['player-browser']);
    expect(resolveAffectedBenchPackages(['packages/player-engine/src/deleted.ts'])).toEqual(['player-engine']);
  });
});

describe('the CI benchmark path filter', () => {
  test('includes every workspace package', () => {
    const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const filter = /^ +bench:\n((?: +- '[^']*'\n)+)/m.exec(ci)?.[1];
    expect(filter).toBeDefined();
    expect(filter).toContain("- 'packages/**'");
  });
});

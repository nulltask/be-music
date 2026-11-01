import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vite-plus/test';
import { PACKAGE_NAMES } from './exports.types.ts';
import { resolveAffectedBenchPackages } from './affected-packages.ts';

const DEPENDENCIES = {
  'shared-utils': [],
  'chart-source': ['shared-utils'],
  'chart-model': ['chart-source', 'shared-utils'],
  'player-engine': ['chart-model', 'chart-source', 'shared-utils'],
  'player-skin-sdk': ['chart-model', 'chart-source', 'player-engine'],
  'skin-beatoraja': ['chart-model'],
  'theme-kit': ['chart-model'],
  'player-browser': ['skin-beatoraja', 'theme-kit', 'player-engine', 'player-skin-sdk'],
  'app-leaderboard': ['player-engine'],
};

describe('resolveAffectedBenchPackages', () => {
  test('measures a changed package and what depends on it, in benchmark order', () => {
    expect(resolveAffectedBenchPackages(['packages/player-engine/src/core/engine.ts'], DEPENDENCIES)).toEqual([
      'player-engine',
      'player-skin-sdk',
      'player-browser',
    ]);
  });

  test('follows dependencies through packages the benchmark does not measure', () => {
    expect(resolveAffectedBenchPackages(['packages/theme-kit/src/skin.ts'], DEPENDENCIES)).toEqual(['player-browser']);
    expect(resolveAffectedBenchPackages(['packages/skin-beatoraja/src/skin.ts'], DEPENDENCIES)).toEqual([
      'skin-beatoraja',
      'player-browser',
    ]);
  });

  test('a leaf package measures only itself', () => {
    expect(resolveAffectedBenchPackages(['packages/player-browser/src/a.ts', ''], DEPENDENCIES)).toEqual([
      'player-browser',
    ]);
  });

  test('measures shared tooling and dependency manifests in full', () => {
    expect(resolveAffectedBenchPackages(['packages/player-engine/src/a.ts', 'pnpm-lock.yaml'], DEPENDENCIES)).toEqual([
      ...PACKAGE_NAMES,
    ]);
    expect(resolveAffectedBenchPackages(['scripts/bench/exports.ts'], DEPENDENCIES)).toEqual([...PACKAGE_NAMES]);
    expect(resolveAffectedBenchPackages(['packages/player-engine/package.json'], DEPENDENCIES)).toEqual([
      ...PACKAGE_NAMES,
    ]);
    expect(resolveAffectedBenchPackages(['vite.config.ts'], DEPENDENCIES)).toEqual([...PACKAGE_NAMES]);
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
    expect(resolveAffectedBenchPackages(ignored, DEPENDENCIES)).toEqual([]);
    expect(resolveAffectedBenchPackages([...ignored, 'packages/player-browser/src/a.ts'], DEPENDENCIES)).toEqual([
      'player-browser',
    ]);
  });

  test('measures nothing for other workflow changes, and everything for the benchmark workflow', () => {
    expect(resolveAffectedBenchPackages(['.github/workflows/e2e.yml', '.github/dependabot.yml'], DEPENDENCIES)).toEqual(
      [],
    );
    expect(resolveAffectedBenchPackages(['.github/workflows/ci.yml'], DEPENDENCIES)).toEqual([...PACKAGE_NAMES]);
  });

  test('skips changes that reach no measured package, including an empty change list', () => {
    expect(resolveAffectedBenchPackages(['packages/app-leaderboard/src/app.ts'], DEPENDENCIES)).toEqual([]);
    expect(resolveAffectedBenchPackages([], DEPENDENCIES)).toEqual([]);
  });

  test('keeps fixtures and deleted runtime paths in scope', () => {
    expect(resolveAffectedBenchPackages(['packages/player-browser/fixtures/chart.bms'], DEPENDENCIES)).toEqual([
      'player-browser',
    ]);
    expect(resolveAffectedBenchPackages(['packages/player-engine/src/deleted.ts'], DEPENDENCIES)).toEqual([
      'player-engine',
      'player-skin-sdk',
      'player-browser',
    ]);
  });
});

describe('the CI benchmark path filter', () => {
  test('includes every workspace package, including unmeasured dependency intermediaries', () => {
    const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const filter = /^ +bench:\n((?: +- '[^']*'\n)+)/m.exec(ci)?.[1];
    expect(filter).toBeDefined();
    expect(filter).toContain("- 'packages/**'");
  });
});

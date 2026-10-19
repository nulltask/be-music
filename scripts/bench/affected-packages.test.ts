import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vite-plus/test';
import { PACKAGE_NAMES } from './exports.types.ts';
import { resolveAffectedBenchPackages } from './affected-packages.ts';

const DEPENDENCIES = {
  utils: [],
  json: ['utils'],
  chart: ['json', 'utils'],
  player: ['chart', 'json', 'utils'],
  'skin-sdk': ['chart', 'json', 'player'],
  'beatoraja-skin': ['chart'],
  'theme-kit': ['chart'],
  'player-web': ['beatoraja-skin', 'theme-kit', 'player', 'skin-sdk'],
  'leaderboard-api': ['player'],
};

describe('resolveAffectedBenchPackages', () => {
  test('measures a changed package and what depends on it, in benchmark order', () => {
    expect(resolveAffectedBenchPackages(['packages/player/src/core/engine.ts'], DEPENDENCIES)).toEqual([
      'player',
      'skin-sdk',
      'player-web',
    ]);
  });

  test('follows dependencies through packages the benchmark does not measure', () => {
    expect(resolveAffectedBenchPackages(['packages/theme-kit/src/skin.ts'], DEPENDENCIES)).toEqual(['player-web']);
    expect(resolveAffectedBenchPackages(['packages/beatoraja-skin/src/skin.ts'], DEPENDENCIES)).toEqual([
      'beatoraja-skin',
      'player-web',
    ]);
  });

  test('a leaf package measures only itself', () => {
    expect(resolveAffectedBenchPackages(['packages/player-web/src/a.ts', ''], DEPENDENCIES)).toEqual(['player-web']);
  });

  test('measures everything for a change outside packages/, or one that reaches nothing measured', () => {
    expect(resolveAffectedBenchPackages(['packages/player/src/a.ts', 'pnpm-lock.yaml'], DEPENDENCIES)).toEqual([
      ...PACKAGE_NAMES,
    ]);
    expect(resolveAffectedBenchPackages(['scripts/bench/exports.ts'], DEPENDENCIES)).toEqual([...PACKAGE_NAMES]);
    expect(resolveAffectedBenchPackages(['packages/leaderboard-api/src/app.ts'], DEPENDENCIES)).toEqual([
      ...PACKAGE_NAMES,
    ]);
  });
});

describe('the CI benchmark path filter', () => {
  test('lists every benchmarked package, so a change to any of them runs the PR benchmark', () => {
    const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const filter = /^ +bench:\n((?: +- '[^']*'\n)+)/m.exec(ci)?.[1];
    expect(filter).toBeDefined();
    const missing = PACKAGE_NAMES.filter((name) => !filter!.includes(`- 'packages/${name}/**'`));
    expect(missing).toEqual([]);
  });
});

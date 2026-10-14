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
  'player-web': ['beatoraja-skin', 'player', 'skin-sdk'],
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
    expect(resolveAffectedBenchPackages(['packages/beatoraja-skin/src/skin.ts'], DEPENDENCIES)).toEqual(['player-web']);
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

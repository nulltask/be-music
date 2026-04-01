import { describe, expect, it } from 'vitest';
import { aggregateBenchmarkSnapshots } from './aggregate-results.ts';
import type { ExportsBenchmarkSnapshot } from './exports.types.ts';

function createSnapshot(
  hz: number,
  meanMs: number,
  overrides: Partial<ExportsBenchmarkSnapshot> = {},
): ExportsBenchmarkSnapshot {
  return {
    schemaVersion: 1,
    createdAt: '2026-03-09T00:00:00.000Z',
    gitSha: 'abc123',
    nodeVersion: 'v22.0.0',
    platform: 'linux',
    options: {
      timeMs: 200,
      warmupTimeMs: 100,
      packages: ['utils'],
      includeInteractive: false,
    },
    exports: {
      utils: ['clamp'],
      json: [],
      parser: [],
      stringifier: [],
      editor: [],
      'audio-renderer': [],
      player: [],
    },
    totals: {
      exported: 1,
      benchmarked: 1,
      skipped: 0,
      filteredOut: 0,
    },
    skipped: {},
    results: {
      'utils.clamp': {
        hz,
        meanMs,
        p75Ms: meanMs + 1,
        p99Ms: meanMs + 2,
        minMs: meanMs - 1,
        maxMs: meanMs + 3,
        rmePercent: 1,
        sampleCount: 100,
        totalTimeMs: 200,
      },
    },
    ...overrides,
  };
}

describe('aggregateBenchmarkSnapshots', () => {
  it('aggregates benchmark task stats by median', () => {
    const aggregated = aggregateBenchmarkSnapshots([
      createSnapshot(100, 10),
      createSnapshot(140, 8),
      createSnapshot(120, 9),
    ]);

    expect(aggregated.aggregation).toEqual({
      strategy: 'median',
      runCount: 3,
    });
    expect(aggregated.results['utils.clamp'].hz).toBe(120);
    expect(aggregated.results['utils.clamp'].meanMs).toBe(9);
    expect(aggregated.results['utils.clamp'].p99Ms).toBe(11);
  });

  it('rejects incompatible snapshots', () => {
    expect(() =>
      aggregateBenchmarkSnapshots([
        createSnapshot(100, 10),
        createSnapshot(120, 9, {
          options: {
            timeMs: 500,
            warmupTimeMs: 100,
            packages: ['utils'],
            includeInteractive: false,
          },
        }),
      ]),
    ).toThrow('Benchmark snapshots are incompatible');
  });
});

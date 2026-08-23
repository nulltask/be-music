import { describe, expect, it } from 'vitest';
import {
  buildDiffMarkdown,
  compareSnapshots,
  resolveOverallVerdict,
  summarizeComparison,
  summarizeRows,
} from './compare-results.ts';
import type { ExportsBenchmarkSnapshot } from './exports.types.ts';

function createSnapshot(
  results: Record<string, number>,
  overrides: Partial<ExportsBenchmarkSnapshot> = {},
): ExportsBenchmarkSnapshot {
  return {
    schemaVersion: 1,
    createdAt: '2026-03-09T00:00:00.000Z',
    gitSha: 'abc123',
    nodeVersion: 'v25.0.0',
    platform: 'darwin',
    options: {
      timeMs: 30,
      warmupTimeMs: 15,
      packages: ['utils'],
      includeInteractive: false,
    },
    exports: {
      utils: Object.keys(results),
      json: [],
      chart: [],
      parser: [],
      stringifier: [],
      editor: [],
      'audio-renderer': [],
      player: [],
      'player-tui': [],
      'lr2-skin': [],
      'player-web': [],
    },
    totals: {
      exported: Object.keys(results).length,
      benchmarked: Object.keys(results).length,
      skipped: 0,
      filteredOut: 0,
    },
    skipped: {},
    results: Object.fromEntries(
      Object.entries(results).map(([key, hz]) => [
        key,
        {
          hz,
          meanMs: hz === 0 ? 0 : 1000 / hz,
          p75Ms: 11,
          p99Ms: 12,
          minMs: 9,
          maxMs: 13,
          rmePercent: 1,
          sampleCount: 100,
          totalTimeMs: 200,
        },
      ]),
    ),
    ...overrides,
  };
}

describe('resolveOverallVerdict', () => {
  it('uses the median threshold, not isolated case counts', () => {
    expect(resolveOverallVerdict(8, 8)).toBe('improved');
    expect(resolveOverallVerdict(-8, 8)).toBe('regressed');
    expect(resolveOverallVerdict(7.99, 8)).toBe('unchanged');
    expect(resolveOverallVerdict(-7.99, 8)).toBe('unchanged');
  });
});

describe('compareSnapshots', () => {
  it('computes ops/s deltas and skips non-positive base hz', () => {
    const rows = compareSnapshots(
      createSnapshot({
        'utils.fast': 100,
        'utils.dead': 0,
      }),
      createSnapshot({
        'utils.fast': 110,
        'utils.dead': 50,
        'utils.new': 80,
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe('utils.fast');
    expect(rows[0]?.baseHz).toBe(100);
    expect(rows[0]?.headHz).toBe(110);
    expect(rows[0]?.deltaPercent).toBeCloseTo(10);
  });
});

describe('summarizeRows', () => {
  it('keeps overall unchanged when only a minority of cases cross the threshold', () => {
    const summary = summarizeRows(
      [
        { key: 'a', baseHz: 100, headHz: 80, deltaPercent: -20 },
        { key: 'b', baseHz: 100, headHz: 80, deltaPercent: -20 },
        { key: 'c', baseHz: 100, headHz: 80, deltaPercent: -20 },
        { key: 'd', baseHz: 100, headHz: 101, deltaPercent: 1 },
        { key: 'e', baseHz: 100, headHz: 101, deltaPercent: 1 },
        { key: 'f', baseHz: 100, headHz: 101, deltaPercent: 1 },
        { key: 'g', baseHz: 100, headHz: 101, deltaPercent: 1 },
        { key: 'h', baseHz: 100, headHz: 101, deltaPercent: 1 },
        { key: 'i', baseHz: 100, headHz: 101, deltaPercent: 1 },
        { key: 'j', baseHz: 100, headHz: 101, deltaPercent: 1 },
      ],
      8,
    );

    expect(summary.regressedCount).toBe(3);
    expect(summary.improvedCount).toBe(0);
    expect(summary.medianDeltaPercent).toBe(1);
    expect(summary.overallVerdict).toBe('unchanged');
  });

  it('marks overall regressed when the median itself crosses the threshold', () => {
    const summary = summarizeComparison(
      createSnapshot({
        'utils.a': 100,
        'utils.b': 100,
        'utils.c': 100,
        'utils.d': 100,
        'utils.e': 100,
      }),
      createSnapshot({
        'utils.a': 89,
        'utils.b': 89,
        'utils.c': 89,
        'utils.d': 89,
        'utils.e': 89,
      }),
      8,
    );

    expect(summary.overallVerdict).toBe('regressed');
    expect(summary.medianDeltaPercent).toBeCloseTo(-11);
    expect(summary.regressedCount).toBe(5);
  });
});

describe('buildDiffMarkdown', () => {
  it('leads the summary with the median verdict', () => {
    const markdown = buildDiffMarkdown(
      createSnapshot({
        'utils.noisy': 100,
        'utils.stable': 100,
        'utils.other': 100,
      }),
      createSnapshot({
        'utils.noisy': 70,
        'utils.stable': 101,
        'utils.other': 101,
      }),
      8,
      12,
    );

    expect(markdown).toContain('| Overall | unchanged |');
    expect(markdown).toContain('| Median change | +1.00% |');
    expect(markdown).toContain('| Cases regressed (<= -threshold) | 1 |');
    expect(markdown).toContain('Overall verdict uses the median change');
    expect(markdown).toContain('`utils.noisy`');
  });
});

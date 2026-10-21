import { describe, expect, it } from 'vite-plus/test';
import {
  buildDiffMarkdown,
  classifyRow,
  compareSnapshots,
  countUnreliableCases,
  formatDuration,
  formatHeadline,
  formatTimeChange,
  packageOf,
  resolveOverallVerdict,
  runsAreApart,
  runSpreadPercent,
  summarizeComparison,
  summarizeRows,
  type ComparedRow,
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
      packages: ['shared-utils'],
      includeInteractive: false,
    },
    exports: {
      'shared-utils': Object.keys(results),
      'chart-source': [],
      'chart-model': [],
      'chart-parser': [],
      'chart-writer': [],
      'chart-editor': [],
      'chart-audio-renderer': [],
      'player-engine': [],
      'player-node-audio': [],
      'player-terminal': [],
      'player-scene-model': [],
      'skin-lr2': [],
      'skin-beatoraja': [],
      'player-skin-sdk': [],
      'player-browser': [],
      'player-ui': [],
      'player-ui-react': [],
      'player-ui-vue': [],
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
          medianHz: hz,
          meanMs: hz === 0 ? 0 : 1000 / hz,
          p50Ms: hz === 0 ? 0 : 1000 / hz,
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
        'shared-utils.fast': 100,
        'shared-utils.dead': 0,
      }),
      createSnapshot({
        'shared-utils.fast': 110,
        'shared-utils.dead': 50,
        'shared-utils.new': 80,
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe('shared-utils.fast');
    expect(rows[0]?.baseHz).toBe(100);
    expect(rows[0]?.headHz).toBe(110);
    expect(rows[0]?.deltaPercent).toBeCloseTo(10);
  });

  it('compares median ops/s when mean hz disagrees', () => {
    const rows = compareSnapshots(
      createSnapshot({ 'shared-utils.case': 100 }),
      createSnapshot(
        { 'shared-utils.case': 100 },
        {
          results: {
            'shared-utils.case': {
              hz: 50,
              medianHz: 110,
              meanMs: 20,
              p50Ms: 9.091,
              p75Ms: 11,
              p99Ms: 12,
              minMs: 9,
              maxMs: 40,
              rmePercent: 1,
              sampleCount: 100,
              totalTimeMs: 200,
            },
          },
        },
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.baseHz).toBe(100);
    expect(rows[0]?.headHz).toBe(110);
    expect(rows[0]?.deltaPercent).toBeCloseTo(10);
  });

  it('excludes a case whose head p50 latency is at/below the reliability floor, however large its hz delta', () => {
    // A case this cheap (p50 <= 0.001ms) is timer-resolution noise, not a real 10,000% speedup — issue #202.
    const rows = compareSnapshots(
      createSnapshot({ 'chart-model.createBeatResolver': 1_000_000 }),
      createSnapshot({ 'chart-model.createBeatResolver': 100_000_000 }),
    );

    expect(rows).toHaveLength(0);
  });

  it('excludes a case whose base p50 latency is at/below the reliability floor', () => {
    const rows = compareSnapshots(
      createSnapshot({ 'chart-model.createBeatResolver': 100_000_000 }),
      createSnapshot({ 'chart-model.createBeatResolver': 1_000_000 }),
    );

    expect(rows).toHaveLength(0);
  });

  it('keeps a case whose p50 latency sits just above the reliability floor', () => {
    const rows = compareSnapshots(
      createSnapshot({ 'shared-utils.stable': 1000 }),
      createSnapshot({ 'shared-utils.stable': 1000 }),
    );

    expect(rows).toHaveLength(1);
  });
});

describe('countUnreliableCases', () => {
  it('counts only comparable keys excluded for sub-timer-resolution latency', () => {
    const count = countUnreliableCases(
      createSnapshot({
        'chart-model.createBeatResolver': 1_000_000,
        'shared-utils.stable': 1000,
        'shared-utils.baseOnly': 500,
      }),
      createSnapshot({
        'chart-model.createBeatResolver': 100_000_000,
        'shared-utils.stable': 1000,
        'shared-utils.headOnly': 500,
      }),
    );

    expect(count).toBe(1);
  });
});

function row(key: string, deltaPercent: number, significant = true): ComparedRow {
  return {
    key,
    baseHz: 100,
    headHz: 100 * (1 + deltaPercent / 100),
    deltaPercent,
    baseSpreadPercent: 0,
    headSpreadPercent: 0,
    significant,
    ioBound: false,
  };
}

describe('summarizeRows', () => {
  it('keeps overall unchanged when only a minority of cases cross the threshold', () => {
    const summary = summarizeRows(
      [
        row('a', -20),
        row('b', -20),
        row('c', -20),
        row('d', 1),
        row('e', 1),
        row('f', 1),
        row('g', 1),
        row('h', 1),
        row('i', 1),
        row('j', 1),
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
        'shared-utils.a': 100,
        'shared-utils.b': 100,
        'shared-utils.c': 100,
        'shared-utils.d': 100,
        'shared-utils.e': 100,
      }),
      createSnapshot({
        'shared-utils.a': 89,
        'shared-utils.b': 89,
        'shared-utils.c': 89,
        'shared-utils.d': 89,
        'shared-utils.e': 89,
      }),
      8,
    );

    expect(summary.overallVerdict).toBe('regressed');
    expect(summary.medianDeltaPercent).toBeCloseTo(-11);
    expect(summary.regressedCount).toBe(5);
  });
});

describe('run spread and significance', () => {
  it('measures the spread of the runs against the median', () => {
    expect(runSpreadPercent([90, 100, 110], 100)).toBeCloseTo(20);
    expect(runSpreadPercent([100], 100)).toBe(0);
    expect(runSpreadPercent(undefined, 100)).toBe(0);
  });

  it('calls a change significant only when the two sides do not overlap', () => {
    expect(runsAreApart([100, 102, 104], [80, 82, 84], -20)).toBe(true);
    expect(runsAreApart([100, 102, 104], [80, 82, 101], -20)).toBe(false);
    expect(runsAreApart([100, 102, 104], [110, 112, 114], 10)).toBe(true);
    expect(runsAreApart([100, 102, 104], [103, 112, 114], 10)).toBe(false);
    // A single run has no spread to judge by.
    expect(runsAreApart([100], [80], -20)).toBe(true);
  });

  it('classifies a change past the threshold with overlapping runs as noise', () => {
    expect(classifyRow(row('a', -12), 8)).toBe('regressed');
    expect(classifyRow(row('a', 12), 8)).toBe('improved');
    expect(classifyRow(row('a', -12, false), 8)).toBe('noisy');
    expect(classifyRow(row('a', -3, false), 8)).toBe('unchanged');
    expect(classifyRow({ ...row('a', -55), ioBound: true }, 8)).toBe('io');
  });

  it('never judges a case the head marks I/O-bound', () => {
    const base = createSnapshot({ 'shared-utils.readFile': 100 });
    const head = createSnapshot({ 'shared-utils.readFile': 50 }, { ioBound: ['shared-utils.readFile'] });
    const summary = summarizeComparison(base, head, 8);
    expect(summary.regressedCount).toBe(0);
    expect(summary.ioBoundCount).toBe(1);
    expect(buildDiffMarkdown(base, head, 8, 12)).toContain('I/O-bound, not judged (1)');
  });

  it('reads the runs from aggregated snapshots', () => {
    const base = createSnapshot({ 'shared-utils.a': 100, 'shared-utils.b': 100 });
    const head = createSnapshot({ 'shared-utils.a': 80, 'shared-utils.b': 80 });
    base.results['shared-utils.a']!.runMedianHz = [98, 100, 102];
    head.results['shared-utils.a']!.runMedianHz = [79, 80, 81];
    base.results['shared-utils.b']!.runMedianHz = [70, 100, 130];
    head.results['shared-utils.b']!.runMedianHz = [60, 80, 101];
    const summary = summarizeComparison(base, head, 8);
    expect(summary.regressedCount).toBe(1);
    expect(summary.noisyCount).toBe(1);
  });
});

describe('formatting', () => {
  it('formats per-call times with three significant figures', () => {
    expect(formatDuration(0.0000412)).toBe('41.2 ns');
    expect(formatDuration(0.00308)).toBe('3.08 µs');
    expect(formatDuration(12.5)).toBe('12.5 ms');
    expect(formatDuration(2500)).toBe('2.50 s');
    expect(formatDuration(0)).toBe('n/a');
  });

  it('puts an ops/s change as time per call', () => {
    // Half the ops/s is twice the time.
    expect(formatTimeChange(-50)).toBe('100.0% slower');
    expect(formatTimeChange(25)).toBe('20.0% faster');
    expect(formatTimeChange(0)).toBe('±0.0%');
  });

  it('names a case by its package', () => {
    expect(packageOf('player-engine.replay.parseReplay')).toBe('player-engine');
    expect(packageOf('player-browser.serializeReplay')).toBe('player-browser');
  });

  it('opens with the verdict', () => {
    const summary = summarizeRows([row('a', -20), row('b', 1)], 8);
    expect(formatHeadline(summary)).toBe('**🔴 1 regression** · 0 improvements · 0 within noise · 2 compared');
    expect(formatHeadline(summarizeRows([row('a', 1)], 8))).toBe(
      '**✅ No significant change** · 0 within noise · 1 compared',
    );
    expect(formatHeadline(summarizeRows([row('a', 20)], 8))).toBe(
      '**🟢 1 improvement, no regression** · 0 within noise · 1 compared',
    );
  });
});

describe('buildDiffMarkdown', () => {
  it('leads with the verdict and lists regressions in time per call', () => {
    const markdown = buildDiffMarkdown(
      createSnapshot({ 'shared-utils.noisy': 100, 'shared-utils.stable': 100, 'shared-utils.other': 100 }),
      createSnapshot({ 'shared-utils.noisy': 70, 'shared-utils.stable': 101, 'shared-utils.other': 101 }),
      8,
      12,
    );

    expect(markdown.split('\n')[3]).toBe('**🔴 1 regression** · 0 improvements · 0 within noise · 3 compared');
    expect(markdown).toContain('### Regressions (1)');
    expect(markdown).toContain('| `shared-utils.noisy` | 10.0 ms | 14.3 ms | 42.9% slower | ±0.0% / ±0.0% |');
    expect(markdown).toContain('<details><summary>Run details</summary>');
    // The table names its columns rather than leaving an empty header row.
    expect(markdown).toContain('| Measure | Value |');
    expect(markdown).not.toContain('| | |');
    expect(markdown).toContain('| Median change (all compared cases) | +1.00% |');
  });

  it('ranks by median ops/s, not mean hz', () => {
    const head = createSnapshot({
      'shared-utils.meanOnly': 100,
      'shared-utils.medianReal': 100,
      'shared-utils.stable': 100,
    });
    head.results['shared-utils.meanOnly'] = { ...head.results['shared-utils.meanOnly']!, hz: 50, medianHz: 99 };
    head.results['shared-utils.medianReal'] = {
      ...head.results['shared-utils.medianReal']!,
      hz: 99,
      medianHz: 50,
      p50Ms: 20,
    };
    const markdown = buildDiffMarkdown(
      createSnapshot({ 'shared-utils.meanOnly': 100, 'shared-utils.medianReal': 100, 'shared-utils.stable': 100 }),
      head,
      8,
      12,
    );

    expect(markdown).toContain('| `shared-utils.medianReal` | 10.0 ms | 20.0 ms | 100.0% slower |');
    expect(markdown).not.toContain('`shared-utils.meanOnly` |');
  });

  it('links the commits, lists the changed packages first, and names new and removed exports', () => {
    const markdown = buildDiffMarkdown(
      createSnapshot({ 'shared-utils.kept': 100, 'shared-utils.gone': 100 }, { gitSha: 'aaaaaaaa1111' }),
      createSnapshot({ 'shared-utils.kept': 100, 'shared-utils.added': 100 }, { gitSha: 'bbbbbbbb2222' }),
      8,
      12,
      { repositoryURL: 'https://github.com/o/r', changedPackages: ['shared-utils'] },
    );

    expect(markdown).toContain('[`aaaaaaaa`](https://github.com/o/r/commit/aaaaaaaa1111)');
    expect(markdown).toContain('`shared-utils`: 1 case compared, median ±0.0%.');
    expect(markdown).toContain('### New exports (1)');
    expect(markdown).toContain('| `shared-utils.added` | 10.0 ms |');
    expect(markdown).toContain('### Removed exports (1)');
    expect(markdown).toContain('- `shared-utils.gone`');
  });
});

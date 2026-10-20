import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
  isExecutedAsScript,
  loadExportsBenchmarkSnapshot,
  loadExportsBenchmarkSnapshotOrUndefined,
  parseNonNegativeCLINumber,
  parsePositiveCLIInteger,
  parsePositiveCLINumber,
  resolveCLIValue,
  runCLIMain,
} from './cli-utils.ts';
import type { ExportsBenchmarkSnapshot } from './exports.types.ts';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function createSnapshot(overrides: Partial<ExportsBenchmarkSnapshot> = {}): ExportsBenchmarkSnapshot {
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
      'shared-utils': ['clamp'],
      'chart-source': [],
      'chart-model': [],
      'chart-parser': [],
      'chart-writer': [],
      'chart-editor': [],
      'chart-audio-renderer': [],
      'player-engine': [],
      'player-terminal': [],
      'player-scene-model': [],
      'skin-lr2': [],
      'skin-beatoraja': [],
      'player-skin-sdk': [],
      'player-browser': [],
    },
    totals: {
      exported: 1,
      benchmarked: 1,
      skipped: 0,
      filteredOut: 0,
    },
    skipped: {},
    results: {
      'shared-utils.clamp': {
        hz: 100,
        medianHz: 100,
        meanMs: 10,
        p50Ms: 10,
        p75Ms: 11,
        p99Ms: 12,
        minMs: 9,
        maxMs: 13,
        rmePercent: 1,
        sampleCount: 100,
        totalTimeMs: 200,
      },
    },
    ...overrides,
  };
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'be-music-bench-'));
  tempDirs.push(dir);
  return dir;
}

describe('bench CLI value helpers', () => {
  it('resolves required option values', () => {
    expect(resolveCLIValue('out.json', '--output')).toBe('out.json');
    expect(() => resolveCLIValue(undefined, '--output')).toThrow('Missing value for --output');
  });

  it('parses numeric option values', () => {
    expect(parsePositiveCLINumber('1.5', '--time')).toBe(1.5);
    expect(parseNonNegativeCLINumber('0', '--warmup-time')).toBe(0);
    expect(parsePositiveCLIInteger('3', '--top')).toBe(3);

    expect(() => parsePositiveCLINumber('0', '--time')).toThrow('--time must be a positive number');
    expect(() => parseNonNegativeCLINumber('-1', '--threshold')).toThrow('--threshold must be a non-negative number');
    expect(() => parsePositiveCLIInteger('0', '--top')).toThrow('--top must be a positive integer');
  });
});

describe('bench CLI entrypoint helpers', () => {
  it('checks whether an import URL matches the process entry path', () => {
    const entryPath = '/tmp/bench-entry.ts';
    expect(isExecutedAsScript(pathToFileURL(entryPath).href, entryPath)).toBe(true);
    expect(isExecutedAsScript(pathToFileURL('/tmp/other.ts').href, entryPath)).toBe(false);
    expect(isExecutedAsScript(pathToFileURL(entryPath).href, undefined)).toBe(false);
  });

  it('does not run a CLI main function for non-entry imports', async () => {
    let called = false;
    runCLIMain(pathToFileURL('/tmp/not-entry.ts').href, async () => {
      called = true;
    });
    await Promise.resolve();
    expect(called).toBe(false);
  });
});

describe('loadExportsBenchmarkSnapshot', () => {
  it('loads a valid exports benchmark snapshot', async () => {
    const dir = await createTempDir();
    const path = join(dir, 'snapshot.json');
    await writeFile(path, `${JSON.stringify(createSnapshot())}\n`, 'utf8');

    await expect(loadExportsBenchmarkSnapshot(path)).resolves.toMatchObject({
      schemaVersion: 1,
      totals: { benchmarked: 1 },
    });
  });

  it('rejects invalid snapshot shapes', async () => {
    const dir = await createTempDir();
    const path = join(dir, 'snapshot.json');
    await writeFile(path, JSON.stringify({ schemaVersion: 1, totals: {} }), 'utf8');

    await expect(loadExportsBenchmarkSnapshot(path)).rejects.toThrow('results is missing');
  });

  it('returns undefined only for missing optional snapshots', async () => {
    const dir = await createTempDir();
    const missingPath = join(dir, 'missing.json');
    await expect(loadExportsBenchmarkSnapshotOrUndefined(missingPath)).resolves.toBeUndefined();

    const invalidPath = join(dir, 'invalid.json');
    await writeFile(invalidPath, JSON.stringify({ schemaVersion: 0 }), 'utf8');
    await expect(loadExportsBenchmarkSnapshotOrUndefined(invalidPath)).rejects.toThrow('Unsupported snapshot schema');
  });
});

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BenchmarkTaskStats, ExportsBenchmarkSnapshot } from './exports.types.ts';

interface CliDefaults {
  outputPath: string;
}

interface CliOptions {
  inputPaths: string[];
  outputPath: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryDir = resolve(scriptDir, '../..');

const DEFAULTS: CliDefaults = {
  outputPath: resolve(repositoryDir, 'tmp/bench/exports-aggregated.json'),
};

const BENCHMARK_RESULT_FIELDS = [
  'hz',
  'meanMs',
  'p75Ms',
  'p99Ms',
  'minMs',
  'maxMs',
  'rmePercent',
  'sampleCount',
  'totalTimeMs',
] as const satisfies readonly (keyof BenchmarkTaskStats)[];

export async function aggregateBenchmarkSnapshotsFromFiles(
  inputPaths: readonly string[],
): Promise<ExportsBenchmarkSnapshot> {
  const snapshots = await Promise.all(inputPaths.map((inputPath) => loadSnapshot(inputPath)));
  return aggregateBenchmarkSnapshots(snapshots);
}

export function aggregateBenchmarkSnapshots(snapshots: readonly ExportsBenchmarkSnapshot[]): ExportsBenchmarkSnapshot {
  if (snapshots.length === 0) {
    throw new Error('At least one benchmark snapshot is required.');
  }

  const [firstSnapshot, ...remainingSnapshots] = snapshots;
  for (const snapshot of remainingSnapshots) {
    assertCompatibleSnapshot(firstSnapshot, snapshot);
  }

  const aggregatedResults: Record<string, BenchmarkTaskStats> = {};
  const resultKeys = Object.keys(firstSnapshot.results).sort((left, right) => left.localeCompare(right));

  for (const key of resultKeys) {
    const values = snapshots.map((snapshot) => snapshot.results[key]);
    aggregatedResults[key] = aggregateTaskStats(values);
  }

  return {
    ...firstSnapshot,
    createdAt: new Date().toISOString(),
    aggregation: {
      strategy: 'median',
      runCount: snapshots.length,
    },
    results: aggregatedResults,
  };
}

export async function runAggregateBenchmarkSnapshotsCli(
  args: readonly string[] = process.argv.slice(2),
): Promise<ExportsBenchmarkSnapshot> {
  const options = parseArgs([...args], DEFAULTS);
  const snapshot = await aggregateBenchmarkSnapshotsFromFiles(options.inputPaths);

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  process.stdout.write(`Aggregated ${options.inputPaths.length} benchmark snapshots into ${options.outputPath}\n`);
  if (snapshot.aggregation) {
    process.stdout.write(`Strategy=${snapshot.aggregation.strategy} runCount=${snapshot.aggregation.runCount}\n`);
  }
  return snapshot;
}

async function loadSnapshot(pathValue: string): Promise<ExportsBenchmarkSnapshot> {
  const raw = await readFile(pathValue, 'utf8');
  const parsed = JSON.parse(raw) as Partial<ExportsBenchmarkSnapshot>;
  if (parsed.schemaVersion !== 1) {
    throw new Error(`Unsupported snapshot schema at ${pathValue}`);
  }
  if (!parsed.results || typeof parsed.results !== 'object') {
    throw new Error(`Invalid snapshot (results is missing): ${pathValue}`);
  }
  if (!parsed.totals || typeof parsed.totals !== 'object') {
    throw new Error(`Invalid snapshot (totals is missing): ${pathValue}`);
  }
  return parsed as ExportsBenchmarkSnapshot;
}

function assertCompatibleSnapshot(expected: ExportsBenchmarkSnapshot, actual: ExportsBenchmarkSnapshot): void {
  const checks = [
    ['gitSha', expected.gitSha ?? '', actual.gitSha ?? ''],
    ['nodeVersion', expected.nodeVersion, actual.nodeVersion],
    ['platform', expected.platform, actual.platform],
    ['options', stableStringify(expected.options), stableStringify(actual.options)],
    ['exports', stableStringify(expected.exports), stableStringify(actual.exports)],
    ['totals', stableStringify(expected.totals), stableStringify(actual.totals)],
    ['skipped', stableStringify(expected.skipped), stableStringify(actual.skipped)],
    [
      'resultKeys',
      stableStringify(Object.keys(expected.results).sort((left, right) => left.localeCompare(right))),
      stableStringify(Object.keys(actual.results).sort((left, right) => left.localeCompare(right))),
    ],
  ] as const;

  for (const [label, expectedValue, actualValue] of checks) {
    if (expectedValue !== actualValue) {
      throw new Error(`Benchmark snapshots are incompatible: ${label} does not match.`);
    }
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function aggregateTaskStats(values: readonly BenchmarkTaskStats[]): BenchmarkTaskStats {
  const aggregated = {} as BenchmarkTaskStats;
  for (const field of BENCHMARK_RESULT_FIELDS) {
    const aggregatedValue = median(values.map((value) => value[field]));
    aggregated[field] = field === 'sampleCount' ? Math.round(aggregatedValue) : aggregatedValue;
  }
  return aggregated;
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middleIndex];
  }
  return (sorted[middleIndex - 1] + sorted[middleIndex]) / 2;
}

function parseArgs(args: string[], defaults: CliDefaults): CliOptions {
  const options: CliOptions = {
    inputPaths: [],
    outputPath: defaults.outputPath,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--') {
      continue;
    }
    if (token === '--help' || token === '-h') {
      printUsage(defaults);
      process.exit(0);
    }

    if (token === '--output') {
      options.outputPath = resolveValue(args[index + 1], '--output');
      index += 1;
      continue;
    }

    if (token === '--input') {
      options.inputPaths.push(resolveValue(args[index + 1], '--input'));
      index += 1;
      continue;
    }

    if (token.startsWith('-')) {
      throw new Error(`Unknown option: ${token}`);
    }

    options.inputPaths.push(token);
  }

  if (options.inputPaths.length === 0) {
    throw new Error('At least one benchmark snapshot input path is required.');
  }

  return options;
}

function printUsage(defaults: CliDefaults): void {
  const lines = [
    'Usage: pnpm run bench:aggregate -- [options] <input...>',
    '',
    'Essential options:',
    '  <input...>               Benchmark snapshot paths to aggregate',
    `  --output <path>          Output snapshot path (default: ${defaults.outputPath})`,
    '',
    'Advanced options:',
    '  --input <path>           Add an input snapshot path (can be repeated)',
    '',
    'Developer options:',
    '  -h, --help               Show this help',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function resolveValue(value: string | undefined, optionName: string): string {
  if (!value) {
    throw new Error(`Missing value for ${optionName}`);
  }
  return value;
}

function isExecutedAsScript(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }
  return import.meta.url === pathToFileURL(entryPath).href;
}

if (isExecutedAsScript()) {
  void runAggregateBenchmarkSnapshotsCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}

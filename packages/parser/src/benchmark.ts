#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { decodeBmsText, parseChart, parseChartFile } from './index.ts';

type BenchmarkMode = 'parse' | 'file' | 'both';
type BenchmarkMetricKey = 'parseChart' | 'parseChartFile';

interface BenchmarkCliDefaults {
  datasetDir: string;
  baselinePath: string;
  limit: number;
  warmup: number;
  iterations: number;
  mode: BenchmarkMode;
  maxRegressionRatio: number;
}

interface BenchmarkCliOptions {
  datasetDir: string;
  baselinePath: string;
  file?: string;
  limit: number;
  warmup: number;
  iterations: number;
  mode: BenchmarkMode;
  maxRegressionRatio: number;
  check: boolean;
  writeBaseline: boolean;
}

interface ChartFileCandidate {
  absolutePath: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
}

interface PreloadedChart {
  text: string;
  formatHint?: string;
}

interface BenchmarkMetric {
  iterations: number;
  warmup: number;
  filesPerIteration: number;
  totalBytesPerIteration: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  filesPerSecond: number;
  mibPerSecond: number;
}

interface ParserBenchmarkSnapshot {
  schemaVersion: 1;
  createdAt: string;
  nodeVersion: string;
  platform: string;
  dataset: {
    rootDir: string;
    signature: string;
    files: Array<{ relativePath: string; sizeBytes: number }>;
    totalBytes: number;
  };
  options: {
    file?: string;
    limit: number;
    warmup: number;
    iterations: number;
    mode: BenchmarkMode;
  };
  metrics: Partial<Record<BenchmarkMetricKey, BenchmarkMetric>>;
}

interface BenchmarkComparisonItem {
  key: BenchmarkMetricKey;
  baselineMeanMs: number;
  currentMeanMs: number;
  regressionRatio: number;
  passed: boolean;
}

interface BenchmarkComparisonResult {
  datasetMatches: boolean;
  missingMetrics: BenchmarkMetricKey[];
  items: BenchmarkComparisonItem[];
}

const CHART_EXTENSIONS = new Set(['.bms', '.bme', '.bml', '.pms', '.bmson', '.json']);
const DEFAULT_LIMIT = 32;
const DEFAULT_WARMUP = 2;
const DEFAULT_ITERATIONS = 8;
const DEFAULT_MODE: BenchmarkMode = 'both';
const DEFAULT_MAX_REGRESSION_RATIO = 0.5;

async function main(): Promise<void> {
  const defaults = createBenchmarkCliDefaults();

  let options: BenchmarkCliOptions;
  try {
    options = parseBenchmarkCliArgs(process.argv.slice(2), defaults);
  } catch (error) {
    process.stderr.write(`${formatErrorMessage(error)}\n\n`);
    printUsage(defaults);
    process.exitCode = 1;
    return;
  }

  const candidates = await collectChartFileCandidates(options.datasetDir);
  if (candidates.length === 0) {
    process.stderr.write(`No chart files found: ${options.datasetDir}\n`);
    process.exitCode = 1;
    return;
  }

  const selected = options.file
    ? [resolveBenchmarkFileCandidate(candidates, options.datasetDir, options.file)]
    : selectBenchmarkFiles(candidates, options.limit);
  const totalBytes = sumTotalBytes(selected);
  const metrics: Partial<Record<BenchmarkMetricKey, BenchmarkMetric>> = {};

  if (options.mode === 'parse' || options.mode === 'both') {
    const preloaded = await preloadChartsForParse(selected);
    metrics.parseChart = await runBenchmarkMetric({
      iterations: options.iterations,
      warmup: options.warmup,
      filesPerIteration: preloaded.length,
      totalBytesPerIteration: totalBytes,
      task: () => {
        for (const entry of preloaded) {
          parseChart(entry.text, entry.formatHint);
        }
      },
    });
  }

  if (options.mode === 'file' || options.mode === 'both') {
    metrics.parseChartFile = await runBenchmarkMetric({
      iterations: options.iterations,
      warmup: options.warmup,
      filesPerIteration: selected.length,
      totalBytesPerIteration: totalBytes,
      task: async () => {
        for (const entry of selected) {
          await parseChartFile(entry.absolutePath);
        }
      },
    });
  }

  const snapshot: ParserBenchmarkSnapshot = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    dataset: {
      rootDir: options.datasetDir,
      signature: createDatasetSignature(selected),
      files: selected.map((entry) => ({
        relativePath: entry.relativePath,
        sizeBytes: entry.sizeBytes,
      })),
      totalBytes,
    },
    options: {
      file: options.file,
      limit: options.limit,
      warmup: options.warmup,
      iterations: options.iterations,
      mode: options.mode,
    },
    metrics,
  };

  printSnapshotSummary(snapshot, options);

  const baseline = await loadBaselineSnapshot(options.baselinePath);
  let checkFailed = false;
  if (baseline) {
    const comparison = compareWithBaseline(snapshot, baseline, options.maxRegressionRatio);
    printComparisonSummary(comparison, options.maxRegressionRatio);
    if (options.check) {
      checkFailed =
        !comparison.datasetMatches ||
        comparison.missingMetrics.length > 0 ||
        comparison.items.some((item) => !item.passed);
    }
  } else if (options.check) {
    process.stderr.write(
      `Baseline file is missing: ${options.baselinePath}\nRun with --write-baseline once before --check.\n`,
    );
    checkFailed = true;
  }

  if (options.writeBaseline) {
    await writeBaselineSnapshot(options.baselinePath, snapshot);
    process.stdout.write(`\nBaseline updated: ${options.baselinePath}\n`);
  }

  if (checkFailed) {
    process.exitCode = 1;
  }
}

function createBenchmarkCliDefaults(): BenchmarkCliDefaults {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return {
    datasetDir: resolve(packageRoot, '../../examples'),
    baselinePath: resolve(packageRoot, '../../tmp/parser-benchmark-baseline.json'),
    limit: DEFAULT_LIMIT,
    warmup: DEFAULT_WARMUP,
    iterations: DEFAULT_ITERATIONS,
    mode: DEFAULT_MODE,
    maxRegressionRatio: DEFAULT_MAX_REGRESSION_RATIO,
  };
}

function parseBenchmarkCliArgs(args: string[], defaults: BenchmarkCliDefaults): BenchmarkCliOptions {
  const options: BenchmarkCliOptions = {
    datasetDir: defaults.datasetDir,
    baselinePath: defaults.baselinePath,
    file: undefined,
    limit: defaults.limit,
    warmup: defaults.warmup,
    iterations: defaults.iterations,
    mode: defaults.mode,
    maxRegressionRatio: defaults.maxRegressionRatio,
    check: false,
    writeBaseline: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--help' || token === '-h') {
      printUsage(defaults);
      process.exit(0);
    }
    if (token === '--dataset') {
      options.datasetDir = resolveCliValue(args[index + 1], '--dataset');
      index += 1;
      continue;
    }
    if (token === '--baseline') {
      options.baselinePath = resolveCliValue(args[index + 1], '--baseline');
      index += 1;
      continue;
    }
    if (token === '--file') {
      options.file = resolveCliValue(args[index + 1], '--file');
      index += 1;
      continue;
    }
    if (token === '--limit') {
      options.limit = parsePositiveInteger(args[index + 1], '--limit');
      index += 1;
      continue;
    }
    if (token === '--warmup') {
      options.warmup = parseNonNegativeInteger(args[index + 1], '--warmup');
      index += 1;
      continue;
    }
    if (token === '--iterations') {
      options.iterations = parsePositiveInteger(args[index + 1], '--iterations');
      index += 1;
      continue;
    }
    if (token === '--mode') {
      const value = resolveCliValue(args[index + 1], '--mode').toLowerCase();
      if (value !== 'parse' && value !== 'file' && value !== 'both') {
        throw new Error(`Invalid --mode value: ${value}`);
      }
      options.mode = value;
      index += 1;
      continue;
    }
    if (token === '--max-regression') {
      options.maxRegressionRatio = parseNonNegativeNumber(args[index + 1], '--max-regression');
      index += 1;
      continue;
    }
    if (token === '--check') {
      options.check = true;
      continue;
    }
    if (token === '--write-baseline') {
      options.writeBaseline = true;
      continue;
    }
    throw new Error(`Unknown option: ${token}`);
  }

  return options;
}

function resolveCliValue(value: string | undefined, optionName: string): string {
  if (!value) {
    throw new Error(`Missing value for ${optionName}`);
  }
  return value;
}

function parsePositiveInteger(value: string | undefined, optionName: string): number {
  const parsed = Number.parseInt(resolveCliValue(value, optionName), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, optionName: string): number {
  const parsed = Number.parseInt(resolveCliValue(value, optionName), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${optionName} must be a non-negative integer`);
  }
  return parsed;
}

function parseNonNegativeNumber(value: string | undefined, optionName: string): number {
  const parsed = Number.parseFloat(resolveCliValue(value, optionName));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${optionName} must be a non-negative number`);
  }
  return parsed;
}

function printUsage(defaults: BenchmarkCliDefaults): void {
  const lines = [
    'Usage: npm run bench --workspace @be-music/parser -- [options]',
    '',
    'Options:',
    `  --dataset <dir>         Chart root directory (default: ${defaults.datasetDir})`,
    `  --baseline <file>       Baseline snapshot path (default: ${defaults.baselinePath})`,
    '  --file <path>           Benchmark only the specified chart file (relative to --dataset or absolute path)',
    `  --limit <n>             Max files to benchmark (default: ${defaults.limit})`,
    `  --warmup <n>            Warmup iterations (default: ${defaults.warmup})`,
    `  --iterations <n>        Measured iterations (default: ${defaults.iterations})`,
    `  --mode <parse|file|both> Benchmark target (default: ${defaults.mode})`,
    `  --max-regression <ratio> Allowed slowdown ratio for --check (default: ${defaults.maxRegressionRatio})`,
    '  --check                 Fail when slowdown exceeds threshold',
    '  --write-baseline        Save current snapshot as baseline',
    '  --help                  Show this help',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function collectChartFileCandidates(rootDir: string): Promise<ChartFileCandidate[]> {
  const queue: string[] = [rootDir];
  const files: ChartFileCandidate[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = extname(entry.name).toLowerCase();
      if (!CHART_EXTENSIONS.has(extension)) {
        continue;
      }
      const fileStat = await stat(absolutePath);
      files.push({
        absolutePath,
        relativePath: relative(rootDir, absolutePath).replaceAll('\\', '/'),
        extension,
        sizeBytes: fileStat.size,
      });
    }
  }

  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'ja'));
  return files;
}

function selectBenchmarkFiles(candidates: ChartFileCandidate[], limit: number): ChartFileCandidate[] {
  const sorted = [...candidates].sort(
    (left, right) => right.sizeBytes - left.sizeBytes || left.relativePath.localeCompare(right.relativePath, 'ja'),
  );
  return sorted.slice(0, Math.max(1, Math.min(limit, sorted.length)));
}

function resolveBenchmarkFileCandidate(
  candidates: ChartFileCandidate[],
  datasetDir: string,
  filePath: string,
): ChartFileCandidate {
  const requestedAbsolute = resolve(filePath);
  const normalizedFilePath = normalizePath(filePath);
  const requestedRelative = normalizePath(relative(datasetDir, requestedAbsolute));
  const matched = candidates.find(
    (entry) =>
      entry.absolutePath === requestedAbsolute ||
      entry.relativePath === normalizedFilePath ||
      entry.relativePath === requestedRelative,
  );
  if (matched) {
    return matched;
  }
  throw new Error(`--file is not found under dataset: ${filePath}`);
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\/+/, '');
}

async function preloadChartsForParse(files: ChartFileCandidate[]): Promise<PreloadedChart[]> {
  const loaded: PreloadedChart[] = [];
  for (const entry of files) {
    const buffer = await readFile(entry.absolutePath);
    const formatHint = resolveFormatHintFromExtension(entry.extension);
    const text =
      entry.extension === '.bmson' || entry.extension === '.json'
        ? buffer.toString('utf8')
        : decodeBmsText(buffer).text;
    loaded.push({ text, formatHint });
  }
  return loaded;
}

function resolveFormatHintFromExtension(extension: string): string | undefined {
  if (extension === '.bmson') {
    return 'bmson';
  }
  if (extension === '.json') {
    return 'json';
  }
  return undefined;
}

interface RunBenchmarkMetricOptions {
  iterations: number;
  warmup: number;
  filesPerIteration: number;
  totalBytesPerIteration: number;
  task: () => void | Promise<void>;
}

async function runBenchmarkMetric(options: RunBenchmarkMetricOptions): Promise<BenchmarkMetric> {
  for (let index = 0; index < options.warmup; index += 1) {
    await options.task();
  }

  const durationsMs: number[] = [];
  for (let index = 0; index < options.iterations; index += 1) {
    const startedAt = performance.now();
    await options.task();
    durationsMs.push(performance.now() - startedAt);
  }

  const sorted = [...durationsMs].sort((left, right) => left - right);
  const meanMs = sorted.reduce((total, value) => total + value, 0) / sorted.length;
  const medianMs = percentile(sorted, 0.5);
  const p95Ms = percentile(sorted, 0.95);
  const minMs = sorted[0];
  const maxMs = sorted[sorted.length - 1];
  const seconds = meanMs / 1000;
  const filesPerSecond = seconds <= 0 ? 0 : options.filesPerIteration / seconds;
  const mibPerSecond = seconds <= 0 ? 0 : options.totalBytesPerIteration / 1024 / 1024 / seconds;

  return {
    iterations: options.iterations,
    warmup: options.warmup,
    filesPerIteration: options.filesPerIteration,
    totalBytesPerIteration: options.totalBytesPerIteration,
    meanMs,
    medianMs,
    p95Ms,
    minMs,
    maxMs,
    filesPerSecond,
    mibPerSecond,
  };
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length === 1) {
    return sorted[0];
  }
  const index = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * ratio));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function createDatasetSignature(files: ChartFileCandidate[]): string {
  const hash = createHash('sha256');
  for (const entry of files) {
    hash.update(entry.relativePath);
    hash.update('\0');
    hash.update(String(entry.sizeBytes));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function loadBaselineSnapshot(baselinePath: string): Promise<ParserBenchmarkSnapshot | undefined> {
  try {
    const raw = await readFile(baselinePath, 'utf8');
    return parseBaselineSnapshot(raw);
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function parseBaselineSnapshot(raw: string): ParserBenchmarkSnapshot {
  const parsed = JSON.parse(raw) as Partial<ParserBenchmarkSnapshot>;
  if (parsed.schemaVersion !== 1) {
    throw new Error('Unsupported benchmark baseline schema version.');
  }
  if (!parsed.dataset || typeof parsed.dataset.signature !== 'string') {
    throw new Error('Invalid benchmark baseline: dataset.signature is required.');
  }
  if (!parsed.metrics || typeof parsed.metrics !== 'object') {
    throw new Error('Invalid benchmark baseline: metrics is required.');
  }
  return parsed as ParserBenchmarkSnapshot;
}

async function writeBaselineSnapshot(baselinePath: string, snapshot: ParserBenchmarkSnapshot): Promise<void> {
  await mkdir(dirname(baselinePath), { recursive: true });
  await writeFile(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

function compareWithBaseline(
  current: ParserBenchmarkSnapshot,
  baseline: ParserBenchmarkSnapshot,
  maxRegressionRatio: number,
): BenchmarkComparisonResult {
  const datasetMatches = current.dataset.signature === baseline.dataset.signature;
  const missingMetrics: BenchmarkMetricKey[] = [];
  const items: BenchmarkComparisonItem[] = [];
  if (!datasetMatches) {
    return {
      datasetMatches,
      missingMetrics,
      items,
    };
  }

  for (const key of getAvailableMetricKeys(current.metrics)) {
    const currentMetric = current.metrics[key];
    const baselineMetric = baseline.metrics[key];
    if (!currentMetric) {
      continue;
    }
    if (!baselineMetric) {
      missingMetrics.push(key);
      continue;
    }
    const regressionRatio = baselineMetric.meanMs <= 0 ? 0 : currentMetric.meanMs / baselineMetric.meanMs - 1;
    items.push({
      key,
      baselineMeanMs: baselineMetric.meanMs,
      currentMeanMs: currentMetric.meanMs,
      regressionRatio,
      passed: regressionRatio <= maxRegressionRatio,
    });
  }

  return {
    datasetMatches,
    missingMetrics,
    items,
  };
}

function getAvailableMetricKeys(metrics: Partial<Record<BenchmarkMetricKey, BenchmarkMetric>>): BenchmarkMetricKey[] {
  const keys: BenchmarkMetricKey[] = [];
  if (metrics.parseChart) {
    keys.push('parseChart');
  }
  if (metrics.parseChartFile) {
    keys.push('parseChartFile');
  }
  return keys;
}

function printSnapshotSummary(snapshot: ParserBenchmarkSnapshot, options: BenchmarkCliOptions): void {
  process.stdout.write('Parser benchmark\n');
  process.stdout.write(`Dataset      : ${snapshot.dataset.rootDir}\n`);
  process.stdout.write(
    `Selected     : ${snapshot.dataset.files.length} files / ${formatMiB(snapshot.dataset.totalBytes)} MiB\n`,
  );
  process.stdout.write(`Signature    : ${snapshot.dataset.signature}\n`);
  process.stdout.write(
    `Config       : mode=${options.mode} warmup=${options.warmup} iterations=${options.iterations} limit=${options.limit}\n`,
  );
  if (options.file) {
    process.stdout.write(`Target file  : ${options.file}\n`);
  }
  process.stdout.write('\n');

  const parseMetric = snapshot.metrics.parseChart;
  if (parseMetric) {
    printMetricSummary('parseChart (in-memory)', parseMetric);
  }
  const parseFileMetric = snapshot.metrics.parseChartFile;
  if (parseFileMetric) {
    printMetricSummary('parseChartFile (read+parse)', parseFileMetric);
  }
}

function printMetricSummary(title: string, metric: BenchmarkMetric): void {
  process.stdout.write(`${title}\n`);
  process.stdout.write(
    `  mean=${formatMs(metric.meanMs)}  median=${formatMs(metric.medianMs)}  p95=${formatMs(metric.p95Ms)}\n`,
  );
  process.stdout.write(
    `  min=${formatMs(metric.minMs)}  max=${formatMs(metric.maxMs)}  throughput=${metric.filesPerSecond.toFixed(2)} files/s (${metric.mibPerSecond.toFixed(2)} MiB/s)\n`,
  );
  process.stdout.write('\n');
}

function printComparisonSummary(result: BenchmarkComparisonResult, maxRegressionRatio: number): void {
  process.stdout.write('Baseline comparison\n');
  if (!result.datasetMatches) {
    process.stdout.write('  Dataset signature mismatch. Update baseline before using --check.\n\n');
    return;
  }

  if (result.missingMetrics.length > 0) {
    process.stdout.write(`  Missing metrics in baseline: ${result.missingMetrics.join(', ')}\n`);
  }
  for (const item of result.items) {
    const diff = `${item.regressionRatio >= 0 ? '+' : ''}${(item.regressionRatio * 100).toFixed(2)}%`;
    const status = item.passed ? 'OK' : 'FAIL';
    process.stdout.write(
      `  ${item.key.padEnd(14)} ${status}  baseline=${formatMs(item.baselineMeanMs)} current=${formatMs(item.currentMeanMs)} diff=${diff} (threshold ${(maxRegressionRatio * 100).toFixed(2)}%)\n`,
    );
  }
  process.stdout.write('\n');
}

function sumTotalBytes(files: ChartFileCandidate[]): number {
  return files.reduce((total, entry) => total + entry.sizeBytes, 0);
}

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

function formatMiB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

void main();

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

/**
 * 非同期でmain に対応する処理を実行します。
 * @returns 戻り値はありません。
 */
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

  const selected = selectBenchmarkFiles(candidates, options.limit);
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

/**
 * デフォルト CLI 設定値を作成します。
 * @returns 処理結果（BenchmarkCliDefaults）。
 */
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

/**
 * 入力データを解析し、内部処理で扱う形式に変換します。
 * @param args - CLI から受け取った引数。
 * @param defaults - 既定値。
 * @returns 処理結果（BenchmarkCliOptions）。
 */
function parseBenchmarkCliArgs(args: string[], defaults: BenchmarkCliDefaults): BenchmarkCliOptions {
  const options: BenchmarkCliOptions = {
    datasetDir: defaults.datasetDir,
    baselinePath: defaults.baselinePath,
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

/**
 * CLI オプション値の存在を検証して返します。
 * @param value - 取得した値。
 * @param optionName - オプション名。
 * @returns 変換後または整形後の文字列。
 */
function resolveCliValue(value: string | undefined, optionName: string): string {
  if (!value) {
    throw new Error(`Missing value for ${optionName}`);
  }
  return value;
}

/**
 * 文字列を正の整数に変換します。
 * @param value - 取得した値。
 * @param optionName - オプション名。
 * @returns 計算結果の数値。
 */
function parsePositiveInteger(value: string | undefined, optionName: string): number {
  const parsed = Number.parseInt(resolveCliValue(value, optionName), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

/**
 * 文字列を 0 以上の整数に変換します。
 * @param value - 取得した値。
 * @param optionName - オプション名。
 * @returns 計算結果の数値。
 */
function parseNonNegativeInteger(value: string | undefined, optionName: string): number {
  const parsed = Number.parseInt(resolveCliValue(value, optionName), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${optionName} must be a non-negative integer`);
  }
  return parsed;
}

/**
 * 文字列を 0 以上の数値に変換します。
 * @param value - 取得した値。
 * @param optionName - オプション名。
 * @returns 計算結果の数値。
 */
function parseNonNegativeNumber(value: string | undefined, optionName: string): number {
  const parsed = Number.parseFloat(resolveCliValue(value, optionName));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${optionName} must be a non-negative number`);
  }
  return parsed;
}

/**
 * ヘルプテキストを出力します。
 * @param defaults - 既定値。
 * @returns 戻り値はありません。
 */
function printUsage(defaults: BenchmarkCliDefaults): void {
  const lines = [
    'Usage: npm run bench --workspace @be-music/parser -- [options]',
    '',
    'Options:',
    `  --dataset <dir>         Chart root directory (default: ${defaults.datasetDir})`,
    `  --baseline <file>       Baseline snapshot path (default: ${defaults.baselinePath})`,
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

/**
 * ディレクトリ配下の譜面ファイルを列挙します。
 * @param rootDir - 探索対象のルートディレクトリ。
 * @returns 非同期処理完了後の結果（ChartFileCandidate[]）を解決する Promise。
 */
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

/**
 * ベンチ対象のファイル集合を選択します。
 * @param candidates - 候補一覧。
 * @param limit - 選択件数上限。
 * @returns 処理結果の配列。
 */
function selectBenchmarkFiles(candidates: ChartFileCandidate[], limit: number): ChartFileCandidate[] {
  const sorted = [...candidates].sort(
    (left, right) => right.sizeBytes - left.sizeBytes || left.relativePath.localeCompare(right.relativePath, 'ja'),
  );
  return sorted.slice(0, Math.max(1, Math.min(limit, sorted.length)));
}

/**
 * in-memory ベンチ用に譜面テキストを読み込みます。
 * @param files - 対象ファイル一覧。
 * @returns 非同期処理完了後の結果（PreloadedChart[]）を解決する Promise。
 */
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

/**
 * 拡張子から `parseChart` 向け formatHint を返します。
 * @param extension - 対象拡張子。
 * @returns formatHint 文字列。不要な場合は `undefined`。
 */
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

/**
 * ベンチ実行を行い統計値を計算します。
 * @param options - 実行オプション。
 * @returns 非同期処理完了後の結果（BenchmarkMetric）を解決する Promise。
 */
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

/**
 * 配列からパーセンタイル値を計算します。
 * @param sorted - 昇順に並べた数値配列。
 * @param ratio - 0.0-1.0 の位置。
 * @returns 計算結果の数値。
 */
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

/**
 * データセットのシグネチャを作成します。
 * @param files - 対象ファイル一覧。
 * @returns 変換後または整形後の文字列。
 */
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

/**
 * 比較に使うベースラインスナップショットを読み込みます。
 * @param baselinePath - ベースラインファイルパス。
 * @returns 非同期処理完了後の結果（ParserBenchmarkSnapshot | undefined）を解決する Promise。
 */
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

/**
 * JSON 文字列をベースラインスナップショットへ変換します。
 * @param raw - JSON 文字列。
 * @returns 処理結果（ParserBenchmarkSnapshot）。
 */
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

/**
 * ベースラインスナップショットを書き込みます。
 * @param baselinePath - 出力先パス。
 * @param snapshot - 保存対象スナップショット。
 * @returns 非同期処理完了後の結果（void）を解決する Promise。
 */
async function writeBaselineSnapshot(baselinePath: string, snapshot: ParserBenchmarkSnapshot): Promise<void> {
  await mkdir(dirname(baselinePath), { recursive: true });
  await writeFile(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

/**
 * ベースラインとの差分を算出します。
 * @param current - 現在の測定結果。
 * @param baseline - ベースライン結果。
 * @param maxRegressionRatio - 許容退行率。
 * @returns 処理結果（BenchmarkComparisonResult）。
 */
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

/**
 * 測定済みメトリクスキーを列挙します。
 * @param metrics - メトリクス辞書。
 * @returns 処理結果の配列。
 */
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

/**
 * 実行結果サマリを表示します。
 * @param snapshot - 測定結果。
 * @param options - CLI オプション。
 * @returns 戻り値はありません。
 */
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

/**
 * 単一メトリクスのサマリを表示します。
 * @param title - 表示タイトル。
 * @param metric - 対象メトリクス。
 * @returns 戻り値はありません。
 */
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

/**
 * ベースライン比較結果を表示します。
 * @param result - 比較結果。
 * @param maxRegressionRatio - 許容退行率。
 * @returns 戻り値はありません。
 */
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

/**
 * ファイルサイズ合計を計算します。
 * @param files - 対象ファイル一覧。
 * @returns 計算結果の数値。
 */
function sumTotalBytes(files: ChartFileCandidate[]): number {
  return files.reduce((total, entry) => total + entry.sizeBytes, 0);
}

/**
 * ミリ秒値を表示文字列へ変換します。
 * @param value - 対象値。
 * @returns 変換後または整形後の文字列。
 */
function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

/**
 * バイト数を MiB へ変換します。
 * @param bytes - 対象値。
 * @returns 計算結果の数値。
 */
function formatMiB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}

/**
 * エラーを表示用メッセージへ変換します。
 * @param error - 例外オブジェクト。
 * @returns 変換後または整形後の文字列。
 */
function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

void main();

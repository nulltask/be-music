import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadExportsBenchmarkSnapshot,
  loadExportsBenchmarkSnapshotOrUndefined,
  parseNonNegativeCliNumber,
  parsePositiveCliInteger,
  resolveCliValue,
  runCliMain,
} from './cli-utils.ts';
import type { ExportsBenchmarkSnapshot } from './exports.types.ts';
import { resolveComparisonHz } from './task-stats.ts';

interface CliDefaults {
  outputPath: string;
  thresholdPercent: number;
  topCount: number;
}

interface CliOptions {
  headPath: string;
  basePath?: string;
  outputPath: string;
  thresholdPercent: number;
  topCount: number;
  summaryPath?: string;
  failOnRegression: boolean;
}

export type BenchmarkOverallVerdict = 'improved' | 'regressed' | 'unchanged';

export interface ComparedRow {
  key: string;
  baseHz: number;
  headHz: number;
  deltaPercent: number;
}

export interface ComparisonSummary {
  comparableCaseCount: number;
  improvedCount: number;
  regressedCount: number;
  unchangedCount: number;
  medianDeltaPercent: number;
  meanDeltaPercent: number;
  thresholdPercent: number;
  overallVerdict: BenchmarkOverallVerdict;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryDir = resolve(scriptDir, '../..');
const COMMENT_MARKER = '<!-- be-music-exports-benchmark -->';

const DEFAULTS: CliDefaults = {
  outputPath: resolve(repositoryDir, 'tmp/bench/exports-pr-comment.md'),
  thresholdPercent: 5,
  topCount: 10,
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2), DEFAULTS);
  const headSnapshot = await loadExportsBenchmarkSnapshot(options.headPath);
  const baseSnapshot = options.basePath ? await loadExportsBenchmarkSnapshotOrUndefined(options.basePath) : undefined;

  const markdown =
    baseSnapshot !== undefined
      ? buildDiffMarkdown(baseSnapshot, headSnapshot, options.thresholdPercent, options.topCount)
      : buildHeadOnlyMarkdown(headSnapshot, options.topCount, options.basePath);

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${markdown}\n`, 'utf8');

  const summary =
    baseSnapshot !== undefined
      ? summarizeComparison(baseSnapshot, headSnapshot, options.thresholdPercent)
      : {
          comparableCaseCount: 0,
          improvedCount: 0,
          regressedCount: 0,
          unchangedCount: 0,
          medianDeltaPercent: 0,
          meanDeltaPercent: 0,
          thresholdPercent: options.thresholdPercent,
          overallVerdict: 'unchanged',
        };

  if (options.summaryPath) {
    await mkdir(dirname(options.summaryPath), { recursive: true });
    await writeFile(options.summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`Benchmark comparison markdown: ${options.outputPath}\n`);
  if (baseSnapshot !== undefined) {
    process.stdout.write(
      `Comparable=${summary.comparableCaseCount} overall=${summary.overallVerdict} median=${formatPercent(summary.medianDeltaPercent)} improved=${summary.improvedCount} regressed=${summary.regressedCount} threshold=${summary.thresholdPercent.toFixed(2)}%\n`,
    );
  } else {
    process.stdout.write('Base snapshot is unavailable. Generated head-only report.\n');
  }

  if (options.failOnRegression && summary.overallVerdict === 'regressed') {
    process.exitCode = 1;
  }
}

export function buildDiffMarkdown(
  baseSnapshot: ExportsBenchmarkSnapshot,
  headSnapshot: ExportsBenchmarkSnapshot,
  thresholdPercent: number,
  topCount: number,
): string {
  const rows = compareSnapshots(baseSnapshot, headSnapshot);
  const summary = summarizeRows(rows, thresholdPercent);

  const regressions = rows
    .filter((row) => row.deltaPercent <= -thresholdPercent)
    .sort((left, right) => left.deltaPercent - right.deltaPercent)
    .slice(0, topCount);

  const improvements = rows
    .filter((row) => row.deltaPercent >= thresholdPercent)
    .sort((left, right) => right.deltaPercent - left.deltaPercent)
    .slice(0, topCount);

  const lines: string[] = [];
  lines.push(COMMENT_MARKER);
  lines.push('## Exports Benchmark');
  lines.push('');
  lines.push(`- Base SHA: \`${formatSha(baseSnapshot.gitSha)}\``);
  lines.push(`- Head SHA: \`${formatSha(headSnapshot.gitSha)}\``);
  lines.push(`- Comparable cases: \`${summary.comparableCaseCount}\``);
  lines.push(`- Regression threshold: \`${thresholdPercent.toFixed(2)}%\``);
  lines.push(`- Overall verdict uses the median change across cases.`);
  lines.push(`- Per-case lists compare median ops/s, not mean.`);
  lines.push(`- Base runs: \`${formatRunCount(baseSnapshot)}\``);
  lines.push(`- Head runs: \`${formatRunCount(headSnapshot)}\``);
  lines.push('');
  lines.push('### Summary');
  lines.push('| Metric | Value |');
  lines.push('| --- | ---: |');
  lines.push(`| Overall | ${summary.overallVerdict} |`);
  lines.push(`| Median change | ${formatPercent(summary.medianDeltaPercent)} |`);
  lines.push(`| Mean change | ${formatPercent(summary.meanDeltaPercent)} |`);
  lines.push(`| Cases improved (>= threshold) | ${summary.improvedCount} |`);
  lines.push(`| Cases regressed (<= -threshold) | ${summary.regressedCount} |`);
  lines.push(`| Cases unchanged | ${summary.unchangedCount} |`);
  lines.push(`| Head benchmarked cases | ${headSnapshot.totals.benchmarked} |`);
  lines.push(`| Head skipped cases | ${headSnapshot.totals.skipped} |`);

  lines.push('');
  lines.push('### Top Regressions');
  if (regressions.length === 0) {
    lines.push('No regression over threshold.');
  } else {
    lines.push('| API | Base median ops/s | Head median ops/s | Change |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const row of regressions) {
      lines.push(
        `| \`${row.key}\` | ${formatOps(row.baseHz)} | ${formatOps(row.headHz)} | ${formatPercent(row.deltaPercent)} |`,
      );
    }
  }

  lines.push('');
  lines.push('### Top Improvements');
  if (improvements.length === 0) {
    lines.push('No improvement over threshold.');
  } else {
    lines.push('| API | Base median ops/s | Head median ops/s | Change |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const row of improvements) {
      lines.push(
        `| \`${row.key}\` | ${formatOps(row.baseHz)} | ${formatOps(row.headHz)} | ${formatPercent(row.deltaPercent)} |`,
      );
    }
  }

  const newlySkipped = resolveNewlySkippedKeys(baseSnapshot, headSnapshot).slice(0, topCount);
  if (newlySkipped.length > 0) {
    lines.push('');
    lines.push('### Newly Skipped');
    for (const key of newlySkipped) {
      lines.push(`- \`${key}\`: ${headSnapshot.skipped[key]}`);
    }
  }

  return lines.join('\n');
}

function buildHeadOnlyMarkdown(headSnapshot: ExportsBenchmarkSnapshot, topCount: number, basePath?: string): string {
  const slowest = Object.entries(headSnapshot.results)
    .map(([key, value]) => ({
      key,
      hz: resolveComparisonHz(value),
      meanMs: value.p50Ms ?? value.meanMs,
    }))
    .sort((left, right) => left.hz - right.hz)
    .slice(0, topCount);

  const lines: string[] = [];
  lines.push(COMMENT_MARKER);
  lines.push('## Exports Benchmark');
  lines.push('');
  lines.push('Baseline snapshot is unavailable, so this report is head-only.');
  if (basePath) {
    lines.push(`Attempted base snapshot path: \`${basePath}\``);
  }
  lines.push(`- Head SHA: \`${formatSha(headSnapshot.gitSha)}\``);
  lines.push(`- Head benchmarked cases: \`${headSnapshot.totals.benchmarked}\``);
  lines.push(`- Head skipped cases: \`${headSnapshot.totals.skipped}\``);
  lines.push(`- Head runs: \`${formatRunCount(headSnapshot)}\``);
  lines.push('');
  lines.push('### Slowest Cases In Head');
  if (slowest.length === 0) {
    lines.push('No benchmark result found.');
  } else {
    lines.push('| API | median ops/s | median (ms) |');
    lines.push('| --- | ---: | ---: |');
    for (const row of slowest) {
      lines.push(`| \`${row.key}\` | ${formatOps(row.hz)} | ${row.meanMs.toFixed(4)} |`);
    }
  }
  return lines.join('\n');
}

export function compareSnapshots(
  baseSnapshot: ExportsBenchmarkSnapshot,
  headSnapshot: ExportsBenchmarkSnapshot,
): ComparedRow[] {
  const rows: ComparedRow[] = [];
  for (const [key, headResult] of Object.entries(headSnapshot.results)) {
    const baseResult = baseSnapshot.results[key];
    if (!baseResult) {
      continue;
    }
    const baseHz = resolveComparisonHz(baseResult);
    const headHz = resolveComparisonHz(headResult);
    if (baseHz <= 0 || headHz <= 0) {
      continue;
    }
    const deltaPercent = (headHz / baseHz - 1) * 100;
    rows.push({
      key,
      baseHz,
      headHz,
      deltaPercent,
    });
  }
  rows.sort((left, right) => left.key.localeCompare(right.key));
  return rows;
}

export function resolveOverallVerdict(medianDeltaPercent: number, thresholdPercent: number): BenchmarkOverallVerdict {
  if (medianDeltaPercent >= thresholdPercent) {
    return 'improved';
  }
  if (medianDeltaPercent <= -thresholdPercent) {
    return 'regressed';
  }
  return 'unchanged';
}

export function summarizeRows(rows: ComparedRow[], thresholdPercent: number): ComparisonSummary {
  const improvedCount = rows.filter((row) => row.deltaPercent >= thresholdPercent).length;
  const regressedCount = rows.filter((row) => row.deltaPercent <= -thresholdPercent).length;
  const unchangedCount = rows.length - improvedCount - regressedCount;
  const deltas = rows.map((row) => row.deltaPercent).sort((left, right) => left - right);
  const medianDeltaPercent = deltas.length === 0 ? 0 : percentile(deltas, 0.5);
  const meanDeltaPercent = deltas.length === 0 ? 0 : deltas.reduce((total, value) => total + value, 0) / deltas.length;

  return {
    comparableCaseCount: rows.length,
    improvedCount,
    regressedCount,
    unchangedCount,
    medianDeltaPercent,
    meanDeltaPercent,
    thresholdPercent,
    overallVerdict: resolveOverallVerdict(medianDeltaPercent, thresholdPercent),
  };
}

export function summarizeComparison(
  baseSnapshot: ExportsBenchmarkSnapshot,
  headSnapshot: ExportsBenchmarkSnapshot,
  thresholdPercent: number,
): ComparisonSummary {
  const rows = compareSnapshots(baseSnapshot, headSnapshot);
  return summarizeRows(rows, thresholdPercent);
}

function resolveNewlySkippedKeys(
  baseSnapshot: ExportsBenchmarkSnapshot,
  headSnapshot: ExportsBenchmarkSnapshot,
): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(headSnapshot.skipped)) {
    if (!(key in baseSnapshot.skipped)) {
      keys.push(key);
    }
  }
  keys.sort((left, right) => left.localeCompare(right));
  return keys;
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

function parseArgs(args: string[], defaults: CliDefaults): CliOptions {
  let headPath: string | undefined;
  let basePath: string | undefined;
  let outputPath = defaults.outputPath;
  let thresholdPercent = defaults.thresholdPercent;
  let topCount = defaults.topCount;
  let summaryPath: string | undefined;
  let failOnRegression = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--') {
      continue;
    }

    if (token === '--help' || token === '-h') {
      printUsage(defaults);
      process.exit(0);
    }
    if (token === '--head') {
      headPath = resolveCliValue(args[index + 1], '--head');
      index += 1;
      continue;
    }
    if (token === '--base') {
      basePath = resolveCliValue(args[index + 1], '--base');
      index += 1;
      continue;
    }
    if (token === '--output') {
      outputPath = resolveCliValue(args[index + 1], '--output');
      index += 1;
      continue;
    }
    if (token === '--threshold') {
      thresholdPercent = parseNonNegativeCliNumber(args[index + 1], '--threshold');
      index += 1;
      continue;
    }
    if (token === '--top') {
      topCount = parsePositiveCliInteger(args[index + 1], '--top');
      index += 1;
      continue;
    }
    if (token === '--summary') {
      summaryPath = resolveCliValue(args[index + 1], '--summary');
      index += 1;
      continue;
    }
    if (token === '--fail-on-regression') {
      failOnRegression = true;
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  if (!headPath) {
    throw new Error('Missing required option: --head <path>');
  }

  return {
    headPath,
    basePath,
    outputPath,
    thresholdPercent,
    topCount,
    summaryPath,
    failOnRegression,
  };
}

function printUsage(defaults: CliDefaults): void {
  const lines = [
    'Usage: pnpm run bench:compare --head <path> [options]',
    '',
    'Essential options:',
    '  --head <path>            Head benchmark snapshot path (required)',
    '  --base <path>            Base benchmark snapshot path',
    `  --output <path>          Output markdown path (default: ${defaults.outputPath})`,
    '',
    'Advanced options:',
    `  --threshold <percent>    Improvement/regression threshold percent (default: ${defaults.thresholdPercent})`,
    `  --top <count>            Number of rows for top lists (default: ${defaults.topCount})`,
    '  --summary <path>         Optional JSON summary output path',
    '  --fail-on-regression     Exit non-zero if the median change is a regression',
    '',
    'Developer options:',
    '  -h, --help               Show this help',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function formatSha(sha: string | undefined): string {
  if (!sha || sha.length === 0) {
    return 'unknown';
  }
  return sha.slice(0, 12);
}

function formatOps(value: number): string {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return value.toFixed(2);
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatRunCount(snapshot: ExportsBenchmarkSnapshot): string {
  const runCount = snapshot.aggregation?.runCount ?? 1;
  if (snapshot.aggregation?.strategy === 'median') {
    return `median of ${runCount}`;
  }
  return `${runCount}`;
}

runCliMain(import.meta.url, main);

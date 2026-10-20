import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadExportsBenchmarkSnapshot,
  loadExportsBenchmarkSnapshotOrUndefined,
  parseNonNegativeCLINumber,
  parsePositiveCLIInteger,
  resolveCLIValue,
  runCLIMain,
} from './cli-utils.ts';
import type { BenchmarkTaskStats, ExportsBenchmarkSnapshot } from './exports.types.ts';
import { resolveComparisonHz, resolveSampleMs } from './task-stats.ts';

interface CLIDefaults {
  outputPath: string;
  thresholdPercent: number;
  topCount: number;
}

interface CLIOptions {
  headPath: string;
  basePath?: string;
  outputPath: string;
  thresholdPercent: number;
  topCount: number;
  summaryPath?: string;
  failOnRegression: boolean;
  repositoryURL?: string;
  changedPackages: string[];
}

export type BenchmarkOverallVerdict = 'improved' | 'regressed' | 'unchanged';

/**
 * How one case moved: past the threshold with the runs apart (improved / regressed), past it with the runs overlapping
 * (noisy), within it (unchanged), or not judged because it is I/O-bound.
 */
export type RowClass = 'improved' | 'regressed' | 'noisy' | 'unchanged' | 'io';

export interface ComparedRow {
  key: string;
  baseHz: number;
  headHz: number;
  /** Change in median ops/s; positive is faster. */
  deltaPercent: number;
  /** Spread of the runs on each side, `(max - min) / median` in percent; 0 with a single run. */
  baseSpreadPercent: number;
  headSpreadPercent: number;
  /**
   * True when the two sides' runs do not overlap (every head run beats, or trails, every base run), so the change is
   * not run-to-run noise. True when either side has a single run, since there is no spread to judge by.
   */
  significant: boolean;
  /** The case is marked `ioBound`: listed apart, never judged. */
  ioBound: boolean;
}

export interface ComparisonSummary {
  comparableCaseCount: number;
  improvedCount: number;
  regressedCount: number;
  /** Cases past the threshold whose runs overlap: reported apart, not as regressions or improvements. */
  noisyCount: number;
  /** I/O-bound cases, compared but not judged. */
  ioBoundCount: number;
  unchangedCount: number;
  medianDeltaPercent: number;
  meanDeltaPercent: number;
  thresholdPercent: number;
  overallVerdict: BenchmarkOverallVerdict;
  /** Cases whose timed sample on either side lasted at/below MIN_RELIABLE_SAMPLE_MS — excluded, not just unchanged. */
  unreliableCaseCount: number;
}

export interface DiffMarkdownOptions {
  /** `https://github.com/owner/repo`, to link the commits. */
  repositoryURL?: string;
  /** Packages the pull request touches; their cases are listed first. */
  changedPackages?: readonly string[];
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryDir = resolve(scriptDir, '../..');
const COMMENT_MARKER = '<!-- be-music-exports-benchmark -->';

/**
 * Below this, one timed sample is dominated by the timer's resolution rather than the benchmarked function's own
 * cost, and percent deltas between two such samples swing by 10-30x on identical code (issue #202). The runner now
 * batches fast calls so a sample lasts TARGET_SAMPLE_MS, which clears this easily; the floor still guards snapshots
 * from before batching (a base commit's own runner), whose samples were single calls.
 */
const MIN_RELIABLE_SAMPLE_MS = 0.001;

const DEFAULTS: CLIDefaults = {
  outputPath: resolve(repositoryDir, 'tmp/bench/exports-pr-comment.md'),
  thresholdPercent: 5,
  topCount: 10,
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2), DEFAULTS);
  const headSnapshot = await loadExportsBenchmarkSnapshot(options.headPath);
  const baseSnapshot = options.basePath ? await loadExportsBenchmarkSnapshotOrUndefined(options.basePath) : undefined;
  const markdownOptions: DiffMarkdownOptions = {
    repositoryURL: options.repositoryURL,
    changedPackages: options.changedPackages,
  };

  const markdown =
    baseSnapshot !== undefined
      ? buildDiffMarkdown(baseSnapshot, headSnapshot, options.thresholdPercent, options.topCount, markdownOptions)
      : buildHeadOnlyMarkdown(headSnapshot, options.topCount, options.basePath, markdownOptions);

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${markdown}\n`, 'utf8');

  const summary: ComparisonSummary =
    baseSnapshot !== undefined
      ? summarizeComparison(baseSnapshot, headSnapshot, options.thresholdPercent)
      : {
          comparableCaseCount: 0,
          improvedCount: 0,
          regressedCount: 0,
          noisyCount: 0,
          ioBoundCount: 0,
          unchangedCount: 0,
          medianDeltaPercent: 0,
          meanDeltaPercent: 0,
          thresholdPercent: options.thresholdPercent,
          overallVerdict: 'unchanged',
          unreliableCaseCount: 0,
        };

  if (options.summaryPath) {
    await mkdir(dirname(options.summaryPath), { recursive: true });
    await writeFile(options.summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`Benchmark comparison markdown: ${options.outputPath}\n`);
  if (baseSnapshot !== undefined) {
    process.stdout.write(
      `Comparable=${summary.comparableCaseCount} overall=${summary.overallVerdict} median=${formatPercent(summary.medianDeltaPercent)} improved=${summary.improvedCount} regressed=${summary.regressedCount} noisy=${summary.noisyCount} threshold=${summary.thresholdPercent.toFixed(2)}%\n`,
    );
  } else {
    process.stdout.write('Base snapshot is unavailable. Generated head-only report.\n');
  }

  if (options.failOnRegression && summary.overallVerdict === 'regressed') {
    process.exitCode = 1;
  }
}

/**
 * The pull request comment. It leads with the verdict, then lists what needs a look (regressions, improvements, the
 * changed packages' cases, new and removed exports) and folds the rest (noise, exclusions, run details) away.
 */
export function buildDiffMarkdown(
  baseSnapshot: ExportsBenchmarkSnapshot,
  headSnapshot: ExportsBenchmarkSnapshot,
  thresholdPercent: number,
  topCount: number,
  options: DiffMarkdownOptions = {},
): string {
  const rows = compareSnapshots(baseSnapshot, headSnapshot);
  const summary = {
    ...summarizeRows(rows, thresholdPercent),
    unreliableCaseCount: countUnreliableCases(baseSnapshot, headSnapshot),
  };
  const byClass = (rowClass: RowClass) => rows.filter((row) => classifyRow(row, thresholdPercent) === rowClass);
  const regressions = byClass('regressed').sort((left, right) => left.deltaPercent - right.deltaPercent);
  const improvements = byClass('improved').sort((left, right) => right.deltaPercent - left.deltaPercent);
  const noisy = byClass('noisy').sort((left, right) => Math.abs(right.deltaPercent) - Math.abs(left.deltaPercent));
  const ioRows = byClass('io');

  const lines: string[] = [COMMENT_MARKER, '## Exports Benchmark', ''];
  lines.push(formatHeadline(summary));
  lines.push('');
  lines.push(
    `<sub>${formatShaLink(baseSnapshot.gitSha, options.repositoryURL)} → ${formatShaLink(headSnapshot.gitSha, options.repositoryURL)} · ${formatRunCount(baseSnapshot)} base / ${formatRunCount(headSnapshot)} head · a regression or improvement is a change past ±${thresholdPercent.toFixed(0)}% whose runs do not overlap · times are per call (median)</sub>`,
  );

  if (regressions.length > 0) {
    lines.push('', `### Regressions (${regressions.length})`, ...rowTable(regressions.slice(0, topCount)));
    lines.push(...moreLine(regressions.length, topCount));
  }
  if (improvements.length > 0) {
    lines.push('', `### Improvements (${improvements.length})`, ...rowTable(improvements.slice(0, topCount)));
    lines.push(...moreLine(improvements.length, topCount));
  }

  const changedPackages = [...new Set(options.changedPackages ?? [])].sort();
  const changedRows = rows.filter((row) => changedPackages.includes(packageOf(row.key)));
  if (changedRows.length > 0) {
    const changedDeltas = changedRows.map((row) => row.deltaPercent).sort((left, right) => left - right);
    lines.push('', '### Changed packages');
    lines.push(
      `${changedPackages.map((name) => `\`${name}\``).join(', ')}: ${changedRows.length} case${changedRows.length === 1 ? '' : 's'} compared, median ${formatTimeChange(percentile(changedDeltas, 0.5))}.`,
    );
    lines.push('', `<details><summary>All ${changedRows.length} cases</summary>`, '');
    lines.push(...rowTable(changedRows, thresholdPercent), '', '</details>');
  }

  const added = Object.keys(headSnapshot.results)
    .filter((key) => !(key in baseSnapshot.results))
    .sort();
  const removed = Object.keys(baseSnapshot.results)
    .filter((key) => !(key in headSnapshot.results))
    .sort();
  if (added.length > 0) {
    lines.push('', `### New exports (${added.length})`, '| API | Head |', '| --- | ---: |');
    for (const key of added) {
      lines.push(`| \`${key}\` | ${formatDuration(perCallMs(headSnapshot.results[key]))} |`);
    }
  }
  if (removed.length > 0) {
    lines.push('', `### Removed exports (${removed.length})`, ...removed.map((key) => `- \`${key}\``));
  }

  if (noisy.length > 0) {
    lines.push(
      '',
      `<details><summary>Within noise (${noisy.length}): past the threshold, but the runs overlap</summary>`,
    );
    lines.push('', ...rowTable(noisy.slice(0, topCount)), ...moreLine(noisy.length, topCount), '', '</details>');
  }

  if (ioRows.length > 0) {
    lines.push('', `<details><summary>I/O-bound, not judged (${ioRows.length})</summary>`, '');
    lines.push('These cases touch the filesystem, so their time follows the OS cache and the disk more than the code.');
    lines.push('', ...rowTable(ioRows), '', '</details>');
  }

  const unreliableKeys = resolveUnreliableCaseKeys(baseSnapshot, headSnapshot);
  if (unreliableKeys.length > 0) {
    lines.push('', `<details><summary>Excluded: too fast to time (${unreliableKeys.length})</summary>`, '');
    lines.push(
      `A timed sample lasted ${MIN_RELIABLE_SAMPLE_MS * 1000} µs or less on at least one side (usually a base commit from before calls were batched), so its time is timer noise and no change is shown.`,
    );
    lines.push('', '| API | Base | Head |', '| --- | ---: | ---: |');
    for (const key of unreliableKeys.slice(0, topCount)) {
      lines.push(
        `| \`${key}\` | ${formatDuration(perCallMs(baseSnapshot.results[key]))} | ${formatDuration(perCallMs(headSnapshot.results[key]))} |`,
      );
    }
    lines.push(...moreLine(unreliableKeys.length, topCount), '', '</details>');
  }

  const newlySkipped = resolveNewlySkippedKeys(baseSnapshot, headSnapshot);
  if (newlySkipped.length > 0) {
    lines.push('', `<details><summary>Newly skipped (${newlySkipped.length})</summary>`, '');
    lines.push(...newlySkipped.map((key) => `- \`${key}\`: ${headSnapshot.skipped[key]}`), '', '</details>');
  }

  lines.push('', '<details><summary>Run details</summary>', '', '| Measure | Value |', '| --- | ---: |');
  lines.push(`| Median change (all compared cases) | ${formatPercent(summary.medianDeltaPercent)} |`);
  lines.push(`| Mean change | ${formatPercent(summary.meanDeltaPercent)} |`);
  lines.push(`| Overall verdict (median vs. threshold) | ${summary.overallVerdict} |`);
  lines.push(
    `| Compared / within noise / I/O-bound / unchanged | ${rows.length} / ${summary.noisyCount} / ${summary.ioBoundCount} / ${summary.unchangedCount} |`,
  );
  lines.push(`| Benchmarked / skipped (head) | ${headSnapshot.totals.benchmarked} / ${headSnapshot.totals.skipped} |`);
  lines.push(
    `| Time / warmup per case | ${headSnapshot.options.timeMs} ms / ${headSnapshot.options.warmupTimeMs} ms |`,
  );
  lines.push(`| Node / platform | ${headSnapshot.nodeVersion} / ${headSnapshot.platform} |`);
  lines.push('', '</details>');

  return lines.join('\n');
}

function buildHeadOnlyMarkdown(
  headSnapshot: ExportsBenchmarkSnapshot,
  topCount: number,
  basePath: string | undefined,
  options: DiffMarkdownOptions,
): string {
  const slowest = Object.entries(headSnapshot.results)
    .map(([key, value]) => ({ key, ms: perCallMs(value) }))
    .sort((left, right) => right.ms - left.ms)
    .slice(0, topCount);

  const lines: string[] = [COMMENT_MARKER, '## Exports Benchmark', ''];
  lines.push('**No baseline**: the base commit could not be benchmarked, so this report shows the head only.');
  lines.push('');
  lines.push(
    `<sub>${formatShaLink(headSnapshot.gitSha, options.repositoryURL)} · ${formatRunCount(headSnapshot)} · ${headSnapshot.totals.benchmarked} benchmarked, ${headSnapshot.totals.skipped} skipped${basePath ? ` · tried base snapshot \`${basePath}\`` : ''}</sub>`,
  );
  lines.push('', '### Slowest cases');
  if (slowest.length === 0) {
    lines.push('No benchmark result found.');
  } else {
    lines.push('| API | Per call |', '| --- | ---: |');
    for (const row of slowest) {
      lines.push(`| \`${row.key}\` | ${formatDuration(row.ms)} |`);
    }
  }
  return lines.join('\n');
}

/**
 * True when either side's timed sample lasted at/below MIN_RELIABLE_SAMPLE_MS — the case's timing is noise, not
 * signal, so it must not be reported as a regression, an improvement, or "unchanged" (all three imply the percent
 * means something).
 */
function isUnreliableCase(
  baseResult: Pick<BenchmarkTaskStats, 'p50Ms' | 'iterationsPerSample'>,
  headResult: Pick<BenchmarkTaskStats, 'p50Ms' | 'iterationsPerSample'>,
): boolean {
  return (
    !(resolveSampleMs(baseResult) > MIN_RELIABLE_SAMPLE_MS) || !(resolveSampleMs(headResult) > MIN_RELIABLE_SAMPLE_MS)
  );
}

/** `(max - min) / median` of the runs, in percent; 0 without at least two runs. */
export function runSpreadPercent(runs: readonly number[] | undefined, medianHz: number): number {
  if (runs === undefined || runs.length < 2 || !(medianHz > 0)) {
    return 0;
  }
  return ((Math.max(...runs) - Math.min(...runs)) / medianHz) * 100;
}

/** Whether every head run is apart from every base run in the direction of the change. */
export function runsAreApart(
  baseRuns: readonly number[] | undefined,
  headRuns: readonly number[] | undefined,
  deltaPercent: number,
): boolean {
  if (baseRuns === undefined || headRuns === undefined || baseRuns.length < 2 || headRuns.length < 2) {
    return true;
  }
  return deltaPercent < 0
    ? Math.max(...headRuns) < Math.min(...baseRuns)
    : Math.min(...headRuns) > Math.max(...baseRuns);
}

export function classifyRow(row: ComparedRow, thresholdPercent: number): RowClass {
  if (row.ioBound) {
    return 'io';
  }
  if (Math.abs(row.deltaPercent) < thresholdPercent) {
    return 'unchanged';
  }
  if (!row.significant) {
    return 'noisy';
  }
  return row.deltaPercent > 0 ? 'improved' : 'regressed';
}

export function compareSnapshots(
  baseSnapshot: ExportsBenchmarkSnapshot,
  headSnapshot: ExportsBenchmarkSnapshot,
): ComparedRow[] {
  const rows: ComparedRow[] = [];
  // The head's marks decide: a base commit from before the mark has none.
  const ioBound = new Set(headSnapshot.ioBound ?? []);
  for (const [key, headResult] of Object.entries(headSnapshot.results)) {
    const baseResult = baseSnapshot.results[key];
    if (!baseResult) {
      continue;
    }
    if (isUnreliableCase(baseResult, headResult)) {
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
      baseSpreadPercent: runSpreadPercent(baseResult.runMedianHz, baseHz),
      headSpreadPercent: runSpreadPercent(headResult.runMedianHz, headHz),
      significant: runsAreApart(baseResult.runMedianHz, headResult.runMedianHz, deltaPercent),
      ioBound: ioBound.has(key),
    });
  }
  rows.sort((left, right) => left.key.localeCompare(right.key));
  return rows;
}

/** Count of comparable keys (present on both sides) excluded from `compareSnapshots` as sub-timer-resolution noise. */
export function countUnreliableCases(
  baseSnapshot: ExportsBenchmarkSnapshot,
  headSnapshot: ExportsBenchmarkSnapshot,
): number {
  return resolveUnreliableCaseKeys(baseSnapshot, headSnapshot).length;
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
  const classes = rows.map((row) => classifyRow(row, thresholdPercent));
  const countOf = (rowClass: RowClass) => classes.filter((value) => value === rowClass).length;
  const deltas = rows.map((row) => row.deltaPercent).sort((left, right) => left - right);
  const medianDeltaPercent = deltas.length === 0 ? 0 : percentile(deltas, 0.5);
  const meanDeltaPercent = deltas.length === 0 ? 0 : deltas.reduce((total, value) => total + value, 0) / deltas.length;

  return {
    comparableCaseCount: rows.length,
    improvedCount: countOf('improved'),
    regressedCount: countOf('regressed'),
    noisyCount: countOf('noisy'),
    ioBoundCount: countOf('io'),
    unchangedCount: countOf('unchanged'),
    medianDeltaPercent,
    meanDeltaPercent,
    thresholdPercent,
    overallVerdict: resolveOverallVerdict(medianDeltaPercent, thresholdPercent),
    unreliableCaseCount: 0,
  };
}

export function summarizeComparison(
  baseSnapshot: ExportsBenchmarkSnapshot,
  headSnapshot: ExportsBenchmarkSnapshot,
  thresholdPercent: number,
): ComparisonSummary {
  const rows = compareSnapshots(baseSnapshot, headSnapshot);
  return {
    ...summarizeRows(rows, thresholdPercent),
    unreliableCaseCount: countUnreliableCases(baseSnapshot, headSnapshot),
  };
}

/** The package a case key belongs to: `player.replay.parseReplay` → `player`. */
export function packageOf(key: string): string {
  const dot = key.indexOf('.');
  return dot === -1 ? key : key.slice(0, dot);
}

function resolveUnreliableCaseKeys(
  baseSnapshot: ExportsBenchmarkSnapshot,
  headSnapshot: ExportsBenchmarkSnapshot,
): string[] {
  const keys: string[] = [];
  for (const [key, headResult] of Object.entries(headSnapshot.results)) {
    const baseResult = baseSnapshot.results[key];
    if (baseResult && isUnreliableCase(baseResult, headResult)) {
      keys.push(key);
    }
  }
  keys.sort((left, right) => left.localeCompare(right));
  return keys;
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

/** One-line verdict that opens the comment. */
export function formatHeadline(summary: ComparisonSummary): string {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const details = [
    plural(summary.improvedCount, 'improvement'),
    `${summary.noisyCount} within noise`,
    `${summary.comparableCaseCount} compared`,
  ];
  if (summary.regressedCount > 0) {
    return `**🔴 ${plural(summary.regressedCount, 'regression')}** · ${details.join(' · ')}`;
  }
  if (summary.improvedCount > 0) {
    return `**🟢 ${plural(summary.improvedCount, 'improvement')}, no regression** · ${details.slice(1).join(' · ')}`;
  }
  return `**✅ No significant change** · ${details.slice(1).join(' · ')}`;
}

function rowTable(rows: readonly ComparedRow[], thresholdPercent?: number): string[] {
  const lines = ['| API | Base | Head | Change | Run spread (base / head) |', '| --- | ---: | ---: | ---: | ---: |'];
  for (const row of rows) {
    const marks = { regressed: ' 🔴', improved: ' 🟢', noisy: ' ·', unchanged: '', io: ' (I/O)' } as const;
    const mark = thresholdPercent === undefined ? '' : marks[classifyRow(row, thresholdPercent)];
    lines.push(
      `| \`${row.key}\` | ${formatDuration(1000 / row.baseHz)} | ${formatDuration(1000 / row.headHz)} | ${formatTimeChange(row.deltaPercent)}${mark} | ±${(row.baseSpreadPercent / 2).toFixed(1)}% / ±${(row.headSpreadPercent / 2).toFixed(1)}% |`,
    );
  }
  return lines;
}

function moreLine(total: number, shown: number): string[] {
  return total > shown ? ['', `_…and ${total - shown} more._`] : [];
}

function perCallMs(result: BenchmarkTaskStats | undefined): number {
  if (result === undefined) {
    return Number.NaN;
  }
  const hz = resolveComparisonHz(result);
  return hz > 0 ? 1000 / hz : result.p50Ms;
}

/** A per-call time with three significant figures in the unit that fits: `41.2 ns`, `3.08 µs`, `12.5 ms`. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 'n/a';
  }
  const [value, unit] =
    ms >= 1000 ? [ms / 1000, 's'] : ms >= 1 ? [ms, 'ms'] : ms >= 0.001 ? [ms * 1000, 'µs'] : [ms * 1e6, 'ns'];
  const text = value.toPrecision(3);
  return `${text.includes('e') ? value.toFixed(0) : text} ${unit}`;
}

/** An ops/s change put as the time per call: `12.1% slower`, `9.0% faster`, `±0.0%`. */
export function formatTimeChange(deltaPercent: number): string {
  if (!Number.isFinite(deltaPercent)) {
    return 'n/a';
  }
  // Time per call is the inverse of ops/s.
  const timePercent = (1 / (1 + deltaPercent / 100) - 1) * 100;
  if (Math.abs(timePercent) < 0.05) {
    return '±0.0%';
  }
  return `${Math.abs(timePercent).toFixed(1)}% ${timePercent > 0 ? 'slower' : 'faster'}`;
}

function parseArgs(args: string[], defaults: CLIDefaults): CLIOptions {
  let headPath: string | undefined;
  let basePath: string | undefined;
  let outputPath = defaults.outputPath;
  let thresholdPercent = defaults.thresholdPercent;
  let topCount = defaults.topCount;
  let summaryPath: string | undefined;
  let failOnRegression = false;
  let repositoryURL: string | undefined;
  let changedPackages: string[] = [];

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
      headPath = resolveCLIValue(args[index + 1], '--head');
      index += 1;
      continue;
    }
    if (token === '--base') {
      basePath = resolveCLIValue(args[index + 1], '--base');
      index += 1;
      continue;
    }
    if (token === '--output') {
      outputPath = resolveCLIValue(args[index + 1], '--output');
      index += 1;
      continue;
    }
    if (token === '--threshold') {
      thresholdPercent = parseNonNegativeCLINumber(args[index + 1], '--threshold');
      index += 1;
      continue;
    }
    if (token === '--top') {
      topCount = parsePositiveCLIInteger(args[index + 1], '--top');
      index += 1;
      continue;
    }
    if (token === '--summary') {
      summaryPath = resolveCLIValue(args[index + 1], '--summary');
      index += 1;
      continue;
    }
    if (token === '--repository-url') {
      repositoryURL = resolveCLIValue(args[index + 1], '--repository-url');
      index += 1;
      continue;
    }
    if (token === '--changed-packages') {
      // Allowed to be empty: a pull request may touch no benchmarked package.
      changedPackages = (args[index + 1] ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
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
    repositoryURL,
    changedPackages,
  };
}

function printUsage(defaults: CLIDefaults): void {
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
    '  --repository-url <url>   Repository URL, to link the base and head commits',
    '  --changed-packages <a,b> Packages the change touches; their cases are listed first',
    '  --fail-on-regression     Exit non-zero if the median change is a regression',
    '',
    'Developer options:',
    '  -h, --help               Show this help',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function formatShaLink(sha: string | undefined, repositoryURL: string | undefined): string {
  if (!sha || sha.length === 0) {
    return '`unknown`';
  }
  const short = `\`${sha.slice(0, 8)}\``;
  return repositoryURL ? `[${short}](${repositoryURL}/commit/${sha})` : short;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatRunCount(snapshot: ExportsBenchmarkSnapshot): string {
  const runCount = snapshot.aggregation?.runCount ?? 1;
  return `${runCount} run${runCount === 1 ? '' : 's'}`;
}

runCLIMain(import.meta.url, main);

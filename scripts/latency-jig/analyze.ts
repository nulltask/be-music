// Summarises latency jig runs (docs/latency-jig.md): `node scripts/latency-jig/analyze.ts web.csv native.csv ...`
// prints each run's press-to-sound distribution, and how far each run's median is from the first's.
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** One timed press: the jig's `P` line. Times are microseconds on the jig's clock. */
export interface JigPress {
  index: number;
  queuedUs: number;
  sentUs: number;
  onsetUs: number;
  latencyUs: number;
  usbUs: number;
  peak: number;
  quietSpan: number;
}

export interface JigLog {
  /** The `# run` line's settings. */
  settings: Record<string, string>;
  presses: JigPress[];
  timeouts: number;
  noisy: number;
  /** Whether the log reached `# done`, and whether the run was stopped. */
  done: boolean;
  stopped: boolean;
  errors: string[];
}

/** `key=value` pairs from a comment line such as `# run presses=300 gapMs=300-800`. */
function parseSettings(text: string): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const word of text.split(/\s+/)) {
    const separator = word.indexOf('=');
    if (separator > 0) settings[word.slice(0, separator)] = word.slice(separator + 1);
  }
  return settings;
}

/** Reads a jig log. When a file holds several runs, the last one counts. */
export function parseJigLog(text: string): JigLog {
  const emptyLog = (settings: Record<string, string>): JigLog => ({
    settings,
    presses: [],
    timeouts: 0,
    noisy: 0,
    done: false,
    stopped: false,
    errors: [],
  });
  let log = emptyLog({});
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#')) {
      const comment = line.slice(1).trim();
      if (comment.startsWith('run ')) {
        log = emptyLog(parseSettings(comment.slice(4)));
      } else if (comment.startsWith('done')) {
        log.done = true;
        log.stopped = /\bstopped\b/.test(comment);
      } else if (comment.startsWith('error:')) {
        log.errors.push(comment.slice('error:'.length).trim());
      }
      continue;
    }
    const fields = line.split(',');
    if (fields[0] === 'T') log.timeouts += 1;
    else if (fields[0] === 'N') log.noisy += 1;
    else if (fields[0] === 'P' && fields.length >= 9) {
      const [index, queuedUs, sentUs, onsetUs, latencyUs, usbUs, peak, quietSpan] = fields.slice(1).map(Number);
      const press = { index, queuedUs, sentUs, onsetUs, latencyUs, usbUs, peak, quietSpan } as JigPress;
      if (Object.values(press).every((value) => Number.isFinite(value))) log.presses.push(press);
    }
  }
  return log;
}

export interface JigStatistics {
  count: number;
  minMs: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  meanMs: number;
  /** Population standard deviation: the jitter. */
  stdevMs: number;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

/** The distribution of `valuesMs`, or `undefined` for none. */
export function summarizeJigLatencies(valuesMs: readonly number[]): JigStatistics | undefined {
  if (valuesMs.length === 0) return undefined;
  const sorted = [...valuesMs].sort((a, b) => a - b);
  const meanMs = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + (value - meanMs) ** 2, 0) / sorted.length;
  return {
    count: sorted.length,
    minMs: sorted[0]!,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted[sorted.length - 1]!,
    meanMs,
    stdevMs: Math.sqrt(variance),
  };
}

/** ADC counts from mid-scale at which the input is close to its rail: the signal clips. */
export const JIG_CLIPPING_PEAK = 1900;

/** What is worth a second look in a run: clipping, a weak signal, timeouts, an unfinished or failed run. */
export function jigLogWarnings(log: JigLog): string[] {
  const warnings: string[] = [];
  const threshold = Number(log.settings.threshold);
  const clipped = log.presses.filter((press) => press.peak >= JIG_CLIPPING_PEAK).length;
  if (clipped > 0) warnings.push(`${clipped} press(es) near the ADC's rail: turn the volume down`);
  if (Number.isFinite(threshold) && log.presses.some((press) => press.peak < threshold * 2)) {
    warnings.push('a peak under twice the threshold: turn the volume up or lower thr');
  }
  if (log.timeouts > 0) warnings.push(`${log.timeouts} timeout(s): no sound within the timeout`);
  if (log.noisy > 0) warnings.push(`${log.noisy} press(es) skipped for a noisy input`);
  for (const error of log.errors) warnings.push(`error: ${error}`);
  if (!log.done) warnings.push('the log ends before "# done"');
  else if (log.stopped) warnings.push('the run was stopped');
  return warnings;
}

export interface JigRunReport {
  label: string;
  log: JigLog;
  latency: JigStatistics | undefined;
  usb: JigStatistics | undefined;
}

export function jigRunReport(label: string, log: JigLog): JigRunReport {
  return {
    label,
    log,
    latency: summarizeJigLatencies(log.presses.map((press) => press.latencyUs / 1000)),
    usb: summarizeJigLatencies(log.presses.map((press) => press.usbUs / 1000)),
  };
}

const ms = (value: number | undefined): string => (value === undefined ? '-' : value.toFixed(2));

/** A plain-text table of the runs, with each median's difference from the first run's. */
export function formatJigReport(reports: readonly JigRunReport[]): string {
  const baseline = reports[0]?.latency?.medianMs;
  const header = ['run', 'n', 'median', 'p95', 'p99', 'max', 'stdev', 'usb', 'vs first'];
  const rows = reports.map((report) => {
    const stats = report.latency;
    const difference =
      baseline === undefined || stats === undefined || report === reports[0]
        ? '-'
        : `${stats.medianMs - baseline >= 0 ? '+' : ''}${ms(stats.medianMs - baseline)}`;
    return [
      report.label,
      String(stats?.count ?? 0),
      ms(stats?.medianMs),
      ms(stats?.p95Ms),
      ms(stats?.p99Ms),
      ms(stats?.maxMs),
      ms(stats?.stdevMs),
      ms(report.usb?.medianMs),
      difference,
    ];
  });
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column]!.length)));
  const format = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => (column === 0 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!)))
      .join('  ');
  const lines = [
    'Press to sound, milliseconds (usb: queued to taken by the host)',
    format(header),
    ...rows.map(format),
  ];
  for (const report of reports) {
    for (const warning of jigLogWarnings(report.log)) lines.push(`${report.label}: ${warning}`);
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node scripts/latency-jig/analyze.ts <run.csv> [<run.csv> ...]');
    process.exit(1);
  }
  const reports = await Promise.all(
    files.map(async (file) => jigRunReport(basename(file), parseJigLog(await readFile(file, 'utf8')))),
  );
  process.stdout.write(formatJigReport(reports));
}

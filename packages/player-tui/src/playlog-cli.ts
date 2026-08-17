import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import {
  parsePlaylog,
  simulatePlaylog,
  PLAYLOG_SIMULATOR_RULESETS,
  type BeMusicPlaylog,
  type BeatorajaJudgeAlgorithm,
  type PlaylogRulesetId,
  type PlaylogRulesetResult,
} from '@be-music/player/playlog';

/**
 * `bms-playlog` — re-derives LR2 / beatoraja / IIDX scores from a recorded play-log (`*.bmplay.json`).
 *
 * The playlog is an input replay: the resolved chart, every raw key press / release, and the play settings. Each
 * ruleset simulator replays the same input stream through its own judge windows, note-selection algorithm,
 * long-note semantics, and gauge tables — so one play yields the score it would have earned in each player.
 */

export interface PlaylogCliArgs {
  files: string[];
  rulesets: PlaylogRulesetId[];
  gauge?: string;
  judgeAlgorithm?: BeatorajaJudgeAlgorithm;
  json: boolean;
  help: boolean;
}

const USAGE = `Usage: bms-playlog [options] <file.bmplay.json> [...more files]

Re-derives LR2 / beatoraja / IIDX results from a recorded be-music play-log.

Options:
  --ruleset=<list>    Comma-separated rulesets to simulate: lr2, beatoraja, iidx, all (default: all)
  --gauge=<id>        Override the simulated gauge (ruleset-scoped id, e.g. GROOVE / NORMAL / HARD / EX-HARD)
  --algorithm=<name>  beatoraja note-selection algorithm: combo (default) / duration / lowest / score
  --json              Emit the raw result objects as JSON instead of the text table
  --help              Show this help
`;

export function parsePlaylogCliArgs(argv: readonly string[]): PlaylogCliArgs {
  const args: PlaylogCliArgs = { files: [], rulesets: [...PLAYLOG_SIMULATOR_RULESETS], json: false, help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg.startsWith('--ruleset=')) {
      const value = arg.slice('--ruleset='.length).trim().toLowerCase();
      if (value === 'all' || value === '') {
        args.rulesets = [...PLAYLOG_SIMULATOR_RULESETS];
      } else {
        const parsed: PlaylogRulesetId[] = [];
        for (const entry of value.split(',')) {
          const id = entry.trim();
          if (id === 'lr2' || id === 'beatoraja' || id === 'iidx') {
            parsed.push(id);
          } else if (id.length > 0) {
            throw new Error(`unknown ruleset '${id}' (expected lr2 / beatoraja / iidx / all)`);
          }
        }
        args.rulesets = parsed;
      }
    } else if (arg.startsWith('--gauge=')) {
      const value = arg.slice('--gauge='.length).trim().toUpperCase();
      if (value.length > 0) {
        args.gauge = value;
      }
    } else if (arg.startsWith('--algorithm=')) {
      const value = arg.slice('--algorithm='.length).trim().toLowerCase();
      if (value === 'combo' || value === 'duration' || value === 'lowest' || value === 'score') {
        args.judgeAlgorithm = value;
      } else {
        throw new Error(`unknown judge algorithm '${value}' (expected combo / duration / lowest / score)`);
      }
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option '${arg}'`);
    } else {
      args.files.push(arg);
    }
  }
  return args;
}

function formatRate(exScore: number, noteCount: number): string {
  if (noteCount <= 0) return '-';
  return `${((exScore / (noteCount * 2)) * 100).toFixed(2)}%`;
}

interface ReportRow {
  label: string;
  result: PlaylogRulesetResult;
}

/** Builds the human-readable comparison table for one playlog. */
export function buildPlaylogReport(fileLabel: string, playlog: BeMusicPlaylog, rows: readonly ReportRow[]): string {
  const chart = playlog.chart;
  const lines: string[] = [];
  const title = [chart.title, chart.subtitle].filter((part) => part && part.length > 0).join(' ');
  lines.push(`=== ${fileLabel}`);
  lines.push(
    `${title || '(untitled)'} / ${chart.artist ?? '-'} [${chart.laneMode}] notes=${chart.noteCount}` +
      ` mode=${playlog.play.mode}${playlog.play.autoScratch ? '+autoscratch' : ''} gauge=${playlog.play.gauge}` +
      `${playlog.play.aborted === true ? ' (aborted)' : ''}${playlog.createdAt ? ` @ ${playlog.createdAt}` : ''}`,
  );
  const header = [
    pad('RULESET', 14),
    pad('EX', 6),
    pad('RATE', 8),
    pad('DJ', 4),
    pad('PG', 6),
    pad('GR', 6),
    pad('GD', 5),
    pad('BD', 5),
    pad('PR', 5),
    pad('EPR', 5),
    pad('FAST', 6),
    pad('SLOW', 6),
    pad('COMBO', 6),
    pad('SCORE', 7),
    'GAUGE',
  ].join(' ');
  lines.push(header);
  for (const { label, result } of rows) {
    const gauge = `${result.gauge.final.toFixed(1)}% ${result.gauge.type} ${
      result.gauge.cleared ? 'CLEAR' : result.gauge.failedMidPlay === true ? 'FAILED(0%)' : 'FAILED'
    }`;
    lines.push(
      [
        pad(label, 14),
        pad(String(result.exScore), 6),
        pad(formatRate(result.exScore, result.noteCount), 8),
        pad(result.djLevel ?? '-', 4),
        pad(String(result.judge.pgreat), 6),
        pad(String(result.judge.great), 6),
        pad(String(result.judge.good), 5),
        pad(String(result.judge.bad), 5),
        pad(String(result.judge.poor), 5),
        pad(String(result.judge.emptyPoor), 5),
        pad(String(result.fast), 6),
        pad(String(result.slow), 6),
        pad(String(result.maxCombo), 6),
        pad(result.score !== undefined ? String(result.score) : '-', 7),
        gauge,
      ].join(' '),
    );
  }
  return lines.join('\n');
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

export async function runPlaylogCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let args: PlaylogCliArgs;
  try {
    args = parsePlaylogCliArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (args.help || args.files.length === 0) {
    process.stdout.write(USAGE);
    return args.help ? 0 : 2;
  }

  let failures = 0;
  const jsonOutput: Record<string, unknown>[] = [];
  for (const file of args.files) {
    let playlog: BeMusicPlaylog;
    try {
      playlog = parsePlaylog(await readFile(file, 'utf8'));
    } catch (error) {
      process.stderr.write(`${file}: ${(error as Error).message}\n`);
      failures += 1;
      continue;
    }
    const rows: ReportRow[] = [];
    const native = playlog.results?.native;
    if (native) {
      rows.push({ label: native.ruleset, result: native });
    }
    const results: Record<string, PlaylogRulesetResult> = {};
    for (const ruleset of args.rulesets) {
      const result = simulatePlaylog(playlog, {
        ruleset,
        ...(args.gauge !== undefined ? { gauge: args.gauge } : {}),
        ...(args.judgeAlgorithm !== undefined ? { judgeAlgorithm: args.judgeAlgorithm } : {}),
      });
      results[ruleset] = result;
      rows.push({ label: result.ruleset, result });
    }
    if (args.json) {
      jsonOutput.push({ file, chart: playlog.chart.title, play: playlog.play, native, results });
    } else {
      process.stdout.write(`${buildPlaylogReport(file, playlog, rows)}\n\n`);
    }
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify(jsonOutput, null, 2)}\n`);
  }
  return failures > 0 ? 1 : 0;
}

function isCliEntryPoint(): boolean {
  if (!isMainThread) {
    return false;
  }
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    const moduleUrl = (import.meta as { url?: unknown }).url;
    if (typeof moduleUrl === 'string' && moduleUrl.length > 0) {
      return resolve(entry) === fileURLToPath(moduleUrl);
    }
  } catch {
    // SEA/CJS bundles may not provide import.meta.url.
  }
  return resolve(entry) === resolve(process.execPath);
}

if (isCliEntryPoint()) {
  void runPlaylogCli()
    .then((code) => {
      process.exit(code);
    })
    .catch((error) => {
      const message = error instanceof Error && error.message ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    });
}

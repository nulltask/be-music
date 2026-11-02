import { isCLIEntryPoint } from '@be-music/shared-utils/cli';
import { readFile } from 'node:fs/promises';
import {
  parseReplay,
  rejudgeReplay,
  simulateReplay,
  REPLAY_SIMULATOR_RULESETS,
  type ReplayRejudgeOutcome,
  type BeMusicReplay,
  type BeatorajaJudgeAlgorithm,
  type RulesetId,
  type ReplayRulesetResult,
} from '@be-music/player-engine/replay';

/**
 * `bms-replay` — re-derives LR2 / beatoraja / That-Which-Must-Not-Be-Named scores from a recorded replay (`*.bmplay.json`).
 *
 * The replay is an input replay: the resolved chart, every raw key press / release, and the play settings. Each
 * ruleset simulator replays the same input stream through its own judge windows, note-selection algorithm,
 * long-note semantics, and gauge tables — so one play yields the score it would have earned in each player.
 */

export interface ReplayCLIArgs {
  files: string[];
  rulesets: RulesetId[];
  gauge?: string;
  judgeAlgorithm?: BeatorajaJudgeAlgorithm;
  json: boolean;
  help: boolean;
}

const USAGE = `Usage: bms-replay [options] <file.bmplay.json> [...more files]

Re-derives LR2 / beatoraja / That-Which-Must-Not-Be-Named results from a recorded be-music replay.

Options:
  --ruleset=<list>    Comma-separated rulesets to simulate: lr2, beatoraja, ____, all (default: all)
  --gauge=<id>        Override the simulated gauge (ruleset-scoped id, e.g. GROOVE / NORMAL / HARD / EX-HARD)
  --algorithm=<name>  beatoraja note-selection algorithm: combo (default) / duration / lowest / score
  --json              Emit the raw result objects as JSON instead of the text table
  --help              Show this help
`;

export function parseReplayCLIArgs(argv: readonly string[]): ReplayCLIArgs {
  const args: ReplayCLIArgs = { files: [], rulesets: [...REPLAY_SIMULATOR_RULESETS], json: false, help: false };
  // `--` ends the options, as with other CLIs: `pnpm replay -- <file>` forwards it, and anything after it is a file
  // even when its name starts with `--`.
  let optionsEnded = false;
  for (const arg of argv) {
    if (optionsEnded) {
      args.files.push(arg);
    } else if (arg === '--') {
      optionsEnded = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg.startsWith('--ruleset=')) {
      const value = arg.slice('--ruleset='.length).trim().toLowerCase();
      if (value === 'all' || value === '') {
        args.rulesets = [...REPLAY_SIMULATOR_RULESETS];
      } else {
        const parsed: RulesetId[] = [];
        for (const entry of value.split(',')) {
          const id = entry.trim();
          if (id === 'lr2' || id === 'beatoraja' || id === '____') {
            parsed.push(id);
          } else if (id.length > 0) {
            throw new Error(`unknown ruleset '${id}' (expected lr2 / beatoraja / ____ / all)`);
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
  /** Absent for a ruleset the replay is not simulated under (ADR 0019); {@link note} says why. */
  result?: ReplayRulesetResult;
  /** `truncated` for a result judged only up to where the play stopped on failure. */
  outcome?: 'truncated';
  note?: string;
}

/** Builds the human-readable comparison table for one replay. */
export function buildReplayReport(fileLabel: string, replay: BeMusicReplay, rows: readonly ReportRow[]): string {
  const chart = replay.chart;
  const lines: string[] = [];
  const title = [chart.title, chart.subtitle].filter((part) => part && part.length > 0).join(' ');
  lines.push(`=== ${fileLabel}`);
  lines.push(
    `${title || '(untitled)'} / ${chart.artist ?? '-'} [${chart.laneMode}] notes=${chart.noteCount}` +
      ` mode=${replay.play.mode}${replay.play.autoScratch ? '+autoscratch' : ''} gauge=${replay.play.gauge}` +
      `${replay.play.aborted === true ? ' (aborted)' : ''}${replay.createdAt ? ` @ ${replay.createdAt}` : ''}`,
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
  for (const { label, result, outcome, note } of rows) {
    const shownLabel = pad(label.replace(/^____(?=\/|$)/, '????'), 14);
    if (result === undefined) {
      lines.push(`${shownLabel} not simulated${note !== undefined ? ` (${note})` : ''}`);
      continue;
    }
    const gauge = `${result.gauge.final.toFixed(1)}% ${result.gauge.type} ${
      result.gauge.cleared ? 'CLEAR' : result.gauge.failedMidPlay === true ? 'FAILED(0%)' : 'FAILED'
    }${outcome === 'truncated' ? ' TRUNCATED' : ''}`;
    lines.push(
      [
        shownLabel,
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

export async function runReplayCLI(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let args: ReplayCLIArgs;
  try {
    args = parseReplayCLIArgs(argv);
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
    let replay: BeMusicReplay;
    try {
      replay = parseReplay(await readFile(file, 'utf8'));
    } catch (error) {
      process.stderr.write(`${file}: ${(error as Error).message}\n`);
      failures += 1;
      continue;
    }
    const rows: ReportRow[] = [];
    const native = replay.results?.native;
    if (native) {
      rows.push({ label: native.ruleset, result: native });
    }
    const results: Record<string, ReplayRejudgeOutcome> = {};
    for (const ruleset of args.rulesets) {
      const options = {
        ruleset,
        ...(args.judgeAlgorithm !== undefined ? { judgeAlgorithm: args.judgeAlgorithm } : {}),
      };
      // A gauge override is a developer's explicit pick: simulated as asked, with no re-judging rules.
      const outcome: ReplayRejudgeOutcome =
        args.gauge !== undefined
          ? { status: 'simulated', result: simulateReplay(replay, { ...options, gauge: args.gauge }) }
          : rejudgeReplay(replay, options);
      results[ruleset] = outcome;
      rows.push(
        outcome.status === 'not-simulated'
          ? { label: ruleset, note: outcome.reason }
          : {
              label: outcome.result.ruleset,
              result: outcome.result,
              ...(outcome.status === 'truncated' ? { outcome: 'truncated' as const } : {}),
            },
      );
    }
    if (args.json) {
      jsonOutput.push({ file, chart: replay.chart.title, play: replay.play, native, results });
    } else {
      process.stdout.write(`${buildReplayReport(file, replay, rows)}\n\n`);
    }
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify(jsonOutput, null, 2)}\n`);
  }
  return failures > 0 ? 1 : 0;
}

if (isCLIEntryPoint(() => (import.meta as { url?: unknown }).url, { allowExecutableFallback: true })) {
  void runReplayCLI()
    .then((code) => {
      process.exit(code);
    })
    .catch((error) => {
      const message = error instanceof Error && error.message ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    });
}

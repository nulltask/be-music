#!/usr/bin/env node
import { resolveCliPath } from '@be-music/utils';
import { renderChartFile } from './index.ts';

interface CliArgs {
  input?: string;
  output?: string;
  sampleRate?: number;
  normalize?: boolean;
  tailSeconds?: number;
  baseDir?: string;
}

/**
 * 非同期でmain に対応する処理を実行します。
 * @returns 戻り値はありません。
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.output) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const input = resolveCliPath(args.input);
  const output = resolveCliPath(args.output);

  const audioRenderResult = await renderChartFile(input, output, {
    sampleRate: args.sampleRate,
    normalize: args.normalize,
    tailSeconds: args.tailSeconds,
    baseDir: args.baseDir ? resolveCliPath(args.baseDir) : undefined,
  });

  process.stdout.write(
    [
      `Rendered: ${output}`,
      `Duration: ${audioRenderResult.durationSeconds.toFixed(2)}s`,
      `SampleRate: ${audioRenderResult.sampleRate}Hz`,
      `Peak: ${audioRenderResult.peak.toFixed(4)}`,
    ].join('\n') + '\n',
  );
}

/**
 * 入力データを解析し、内部処理で扱う形式に変換します。
 * @param rawArgs - CLI から渡される引数配列。
 * @returns 処理結果（CliArgs）。
 */
function parseArgs(rawArgs: string[]): CliArgs {
  const args: CliArgs = {};
  const positional: string[] = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (token === '--sample-rate' || token === '-r') {
      args.sampleRate = Number.parseInt(rawArgs[index + 1], 10);
      index += 1;
      continue;
    }
    if (token === '--tail') {
      args.tailSeconds = Number.parseFloat(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--base-dir') {
      args.baseDir = rawArgs[index + 1];
      index += 1;
      continue;
    }
    if (token === '--no-normalize') {
      args.normalize = false;
      continue;
    }
    if (token === '--normalize') {
      args.normalize = true;
      continue;
    }
    positional.push(token);
  }

  args.input = positional[0];
  args.output = positional[1];
  return args;
}

/**
 * print Usage に対応する処理を実行します。
 * @returns 戻り値はありません。
 */
function printUsage(): void {
  process.stdout.write(
    [
      'Usage: bms-audio-render <input.(bms|bmson|json)> <output.(wav|aiff)> [options]',
      '',
      'Options:',
      '  --sample-rate, -r <hz>   Output sample rate (default: 44100)',
      '  --tail <seconds>          Tail silence duration (default: 2)',
      '  --base-dir <path>         Base directory to resolve audio samples',
      '  --normalize               Enable peak normalization (default)',
      '  --no-normalize            Disable normalization',
    ].join('\n') + '\n',
  );
}

void main();

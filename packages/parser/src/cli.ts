#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolveCliPath } from '@be-music/utils';
import { parseChart, parseChartFile } from './index.ts';

interface CliArgs {
  input?: string;
  output?: string;
  formatHint?: string;
}

/**
 * 非同期でmain に対応する処理を実行します。
 * @returns 戻り値はありません。
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const inputPath = resolveCliPath(args.input);
  const json = await parseChartFile(inputPath).catch(async () => {
    const content = await readFile(inputPath, 'utf8');
    return parseChart(content, args.formatHint);
  });

  const output = JSON.stringify(json, null, 2);
  if (!args.output) {
    process.stdout.write(`${output}\n`);
    return;
  }

  const outputPath = resolveCliPath(args.output);
  await writeFile(outputPath, output, 'utf8');
  process.stdout.write(`Wrote parsed JSON to ${outputPath}\n`);
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
    if (token === '--format' || token === '-f') {
      args.formatHint = rawArgs[index + 1];
      index += 1;
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
      'Usage: bms-parse <input> [output.json] [--format bms|bmson|json]',
      '',
      'Examples:',
      '  bms-parse chart.bms chart.json',
      '  bms-parse chart.bmson --format bmson',
    ].join('\n') + '\n',
  );
}

void main();

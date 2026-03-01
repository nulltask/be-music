#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolveCliPath } from '@be-music/utils';
import { parseChart } from '@be-music/parser';
import { stringifyBmson, stringifyBms } from './index.ts';

interface CliArgs {
  input?: string;
  output?: string;
  format: 'bms' | 'bmson';
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

  const inputPath = resolveCliPath(args.input);
  const outputPath = resolveCliPath(args.output);

  const content = await readFile(inputPath, 'utf8');
  const json = parseChart(content, 'json');
  const output = args.format === 'bmson' ? stringifyBmson(json) : stringifyBms(json);

  await writeFile(outputPath, output, 'utf8');
  process.stdout.write(`Wrote ${args.format.toUpperCase()} to ${outputPath}\n`);
}

/**
 * 入力データを解析し、内部処理で扱う形式に変換します。
 * @param rawArgs - CLI から渡される引数配列。
 * @returns 処理結果（CliArgs）。
 */
function parseArgs(rawArgs: string[]): CliArgs {
  const args: CliArgs = {
    format: 'bms',
  };
  const positional: string[] = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (token === '--format' || token === '-f') {
      const format = rawArgs[index + 1];
      if (format === 'bms' || format === 'bmson') {
        args.format = format;
      }
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
      'Usage: bms-stringify <input.json> <output> [--format bms|bmson]',
      '',
      'Examples:',
      '  bms-stringify chart.json chart.bms --format bms',
      '  bms-stringify chart.json chart.bmson --format bmson',
    ].join('\n') + '\n',
  );
}

void main();

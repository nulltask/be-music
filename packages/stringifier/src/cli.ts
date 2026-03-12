import { readFile, writeFile } from 'node:fs/promises';
import { resolveCliPath } from '@be-music/utils';
import { parseChart } from '@be-music/parser';
import { stringifyBmson, stringifyBms } from './index.ts';

interface CliArgs {
  input?: string;
  output?: string;
  format: 'bms' | 'bmson';
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printUsage();
    return;
  }
  const args = parseArgs(rawArgs);
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

function printUsage(): void {
  process.stdout.write(
    [
      'Usage: bms-stringify <input.json> <output> [--format bms|bmson]',
      '',
      'Essential usage:',
      '  bms-stringify <input.json> <output>',
      '',
      'Advanced options:',
      '  --format, -f <bms|bmson>  Select output format (default: bms)',
      '',
      'Examples:',
      '  bms-stringify chart.json chart.bms --format bms',
      '  bms-stringify chart.json chart.bmson --format bmson',
    ].join('\n') + '\n',
  );
}

void main();

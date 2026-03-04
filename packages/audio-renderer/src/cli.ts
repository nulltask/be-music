#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

export async function main(): Promise<void> {
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

function printUsage(): void {
  process.stdout.write(
    [
      'Usage: bms-audio-render <input.(bms|bmson|json)> <output.(wav|aiff)> [options]',
      '',
      'Essential options:',
      '  --sample-rate, -r <hz>   Output sample rate (default: 44100)',
      '  --tail <seconds>          Tail silence duration (default: 2)',
      '',
      'Advanced options:',
      '  --base-dir <path>         Base directory to resolve audio samples',
      '  --normalize               Enable peak normalization (default)',
      '  --no-normalize            Disable normalization',
    ].join('\n') + '\n',
  );
}

function isCliEntryPoint(): boolean {
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
  void main().catch((error) => {
    const message = error instanceof Error && error.message ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}

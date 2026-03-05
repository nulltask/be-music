#!/usr/bin/env tsx

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryDir = resolve(scriptDir, '../../..');

async function main(): Promise<void> {
  const benchModule = await import('../../../scripts/bench/exports.ts');
  const runExportsBenchmarkCli = (
    benchModule as {
      runExportsBenchmarkCli?: (
        args?: readonly string[],
        overrides?: {
          defaultOutputPath?: string;
          defaultPackages?: readonly string[];
        },
      ) => Promise<unknown>;
    }
  ).runExportsBenchmarkCli;

  if (typeof runExportsBenchmarkCli !== 'function') {
    throw new Error('runExportsBenchmarkCli is not available in scripts/bench/exports.ts');
  }

  await runExportsBenchmarkCli(process.argv.slice(2), {
    defaultPackages: ['audio-renderer'],
    defaultOutputPath: resolve(repositoryDir, 'tmp/bench/exports-audio-renderer.json'),
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});

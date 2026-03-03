#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './cli/runner.ts';

export * from './cli/runner.ts';

function isCliEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return resolve(entry) === fileURLToPath(import.meta.url);
}

if (isCliEntryPoint()) {
  void main()
    .then(() => {
      process.exit(process.exitCode ?? 0);
    })
    .catch((error) => {
      const message = error instanceof Error && error.message ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    });
}

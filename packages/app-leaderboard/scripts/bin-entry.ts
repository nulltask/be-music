// The JavaScript file behind a dependency's command, to run with `process.execPath`. `node_modules/.bin/<name>` is a
// shell script on macOS and Linux but a `.cmd` wrapper on Windows, which `execFileSync` cannot start without a shell.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export function binEntry(packageDir: string, dependency: string, command: string): string {
  const manifestPath = createRequire(join(packageDir, 'package.json')).resolve(`${dependency}/package.json`);
  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin?: string | Record<string, string> };
  const entry = typeof bin === 'string' ? bin : bin?.[command];
  if (entry === undefined) throw new Error(`${dependency} has no "${command}" command`);
  return join(dirname(manifestPath), entry);
}

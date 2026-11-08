import { spawnSync } from 'node:child_process';
import { d1DatabaseId } from './env.ts';

/**
 * `node d1-migrate.ts <ID variable> [cf flags...]` runs `cf d1 migrations apply` on the database whose ID the variable
 * holds, with `--dir migrations` and the given flags (e.g. `--local --persist-to .wrangler/state`).
 */
const [variable, ...flags] = process.argv.slice(2);
if (!variable) {
  console.error('Usage: node d1-migrate.ts <ID variable> [cf flags...]');
  process.exit(1);
}

const id = d1DatabaseId(variable, flags);
const result = spawnSync('cf', ['d1', 'migrations', 'apply', id, '--dir', 'migrations', ...flags], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);

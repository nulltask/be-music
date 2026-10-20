// Sets a Worker's secrets from 1Password. Each line of secrets/<environment>.env.tpl names a secret and the 1Password
// reference holding its value (`KEY={{ op://vault/item/field }}`); the value goes from `op read` straight into
// `cf workers secrets update`, without a file, and is never printed.
//   pnpm --filter @be-music/leaderboard-api run secrets:preview
//   pnpm --filter @be-music/leaderboard-api run secrets:production
//
// Only `cf` is used: Wrangler may be signed in to another Cloudflare account. Set OP_ACCOUNT to pick the 1Password
// account (default my.1password.com).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { binEntry } from './bin-entry.ts';

const WORKERS = { preview: 'leaderboard-preview', production: 'leaderboard' } as const;

const environment = process.argv[2];
if (environment !== 'preview' && environment !== 'production') {
  console.error('usage: put-secrets.ts preview|production');
  process.exit(2);
}
const worker = WORKERS[environment];
const packageDir = resolve(import.meta.dirname, '..');
const template = readFileSync(join(packageDir, 'secrets', `${environment}.env.tpl`), 'utf8');
const opAccount = process.env.OP_ACCOUNT ?? 'my.1password.com';

const entries = template
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'))
  .map((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=\{\{\s*(op:\/\/[^}\s]+)\s*\}\}$/.exec(line);
    if (match === null) throw new Error(`not a KEY={{ op://… }} line: ${line}`);
    return { name: match[1]!, reference: match[2]! };
  });

for (const { name, reference } of entries) {
  const value = execFileSync('op', ['--account', opAccount, 'read', '--no-newline', reference], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  execFileSync(
    process.execPath,
    [
      binEntry(packageDir, 'cf', 'cf'),
      'workers',
      'secrets',
      'update',
      name,
      '--worker',
      worker,
      '--type',
      'secret_text',
      '--text',
      value,
      '--quiet',
    ],
    { cwd: packageDir, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  console.log(`${worker}: set ${name}`);
}

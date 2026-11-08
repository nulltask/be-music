import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Account and resource IDs of the official deployment stay out of the repository: `cloudflare.config.ts` and the
 * `db:migrate:*` scripts read them from the environment. CI sets them from GitHub secrets; locally they come from the
 * process environment or the git-ignored `.env.cloudflare` at the repository root (see `.env.cloudflare.example`).
 */
export const CLOUDFLARE_ENV_FILE = resolve(import.meta.dirname, '../../.env.cloudflare');

/** The D1 database ID local runs (`cf dev`, `--local` migrations) use when no real ID is set; `cf` wants a v4 UUID. */
export const LOCAL_D1_DATABASE_ID = '10ca1000-0000-4000-8000-000000000000';

/** Whether a `cf` invocation only touches local simulations, so the real IDs are not needed. */
export function isLocalCloudflareCommand(argv: readonly string[]): boolean {
  return argv[0] === 'dev' || argv.includes('--local');
}

/**
 * The value of `name`, or `local` for a local command. A deploy or a remote migration without the value fails, so it can
 * never fall back to whichever account the `cf` session is signed in to.
 */
export function resolveCloudflareEnv<Local extends string | undefined>(
  name: string,
  env: Record<string, string | undefined>,
  argv: readonly string[],
  local: Local,
): string | Local {
  const value = env[name]?.trim();
  if (value) return value;
  if (isLocalCloudflareCommand(argv)) return local;
  throw new Error(`${name} is not set. Set it in the environment or in .env.cloudflare (see .env.cloudflare.example).`);
}

let envFileLoaded = false;

function loadCloudflareEnvFile(): void {
  if (envFileLoaded) return;
  envFileLoaded = true;
  // Values already in the environment win over the file.
  if (existsSync(CLOUDFLARE_ENV_FILE)) process.loadEnvFile(CLOUDFLARE_ENV_FILE);
}

/** The arguments after the `cf` or script name, e.g. `['deploy', '--mode', 'preview']`. */
function commandArgs(): string[] {
  return process.argv.slice(2);
}

/** `CLOUDFLARE_ACCOUNT_ID`, pinned in each config so a `cf` session signed in to another account cannot deploy. */
export function cloudflareAccountId(): string | undefined {
  loadCloudflareEnvFile();
  return resolveCloudflareEnv('CLOUDFLARE_ACCOUNT_ID', process.env, commandArgs(), undefined);
}

/** A D1 database ID from `name`, e.g. `LEADERBOARD_D1_PREVIEW_ID`. */
export function d1DatabaseId(name: string, argv: readonly string[] = commandArgs()): string {
  loadCloudflareEnvFile();
  return resolveCloudflareEnv(name, process.env, argv, LOCAL_D1_DATABASE_ID);
}

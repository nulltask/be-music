import { execFileSync } from 'node:child_process';
import type { BuildInfo } from '../../packages/web-theme/src/build-info.ts';

/** Prefer explicit build metadata, then the actual checkout, then CI metadata when Git is absent. */
export function resolveBuildInfo(
  env: Record<string, string | undefined>,
  checkoutRevision: string,
  now: Date,
): BuildInfo {
  const candidates = [env.BUILD_REVISION, env.WORKERS_CI_COMMIT_SHA, checkoutRevision, env.GITHUB_SHA];
  const revision = candidates.find((value) => value && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)) ?? 'unknown';
  const timestamp = env.BUILD_TIMESTAMP ? new Date(env.BUILD_TIMESTAMP) : now;
  if (!Number.isFinite(timestamp.getTime())) throw new Error('Invalid build timestamp');
  return { builtAt: timestamp.toISOString(), revision };
}

export function getBuildInfo(directory: string): BuildInfo {
  let revision = '';
  try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // Source archives may have CI metadata but no Git checkout.
  }
  return resolveBuildInfo(process.env, revision, new Date());
}

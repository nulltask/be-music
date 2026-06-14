import { getAsset, isSea } from 'node:sea';
import { Worker } from 'node:worker_threads';

/**
 * Marker field injected into `workerData` when a worker is spawned from the SEA bundle asset. The SEA entry
 * (`src/sea-main.ts`) reads it before the CLI entry runs to decide which worker module to execute.
 */
export const SEA_WORKER_ROLE_FIELD = '__beMusicSeaWorkerRole';

/** Asset name under which the SEA build embeds a copy of the bundle itself (see `scripts/build-sea.ts`). */
export const SEA_BUNDLE_ASSET_NAME = 'sea-entry.cjs';

export const SEA_WORKER_ROLES = ['node-gameplay-worker', 'node-ui-worker', 'bga-video-worker'] as const;

export type SeaWorkerRole = (typeof SEA_WORKER_ROLES)[number];

export function isSeaRuntime(): boolean {
  try {
    return isSea();
  } catch {
    return false;
  }
}

export function resolveSeaWorkerRole(workerData: unknown): SeaWorkerRole | undefined {
  if (typeof workerData !== 'object' || workerData === null) {
    return undefined;
  }
  const role = (workerData as Record<string, unknown>)[SEA_WORKER_ROLE_FIELD];
  return (SEA_WORKER_ROLES as readonly unknown[]).includes(role) ? (role as SeaWorkerRole) : undefined;
}

/**
 * SEA binaries cannot load worker scripts from disk: the worker `.js` files are not shipped next to the
 * executable and the SEA-injected `require` only resolves builtins. Instead, spawn an eval worker that
 * re-runs the embedded bundle; the role marker makes `sea-main.ts` execute the matching worker module
 * instead of the CLI entry.
 */
export function createSeaWorker(role: SeaWorkerRole, workerData: object): Worker {
  return new Worker(getAsset(SEA_BUNDLE_ASSET_NAME, 'utf8'), {
    eval: true,
    workerData: { [SEA_WORKER_ROLE_FIELD]: role, ...workerData },
  });
}

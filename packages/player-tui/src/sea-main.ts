import { isMainThread, workerData } from 'node:worker_threads';
import { resolveSeaWorkerRole } from './node/sea-worker.ts';

// Entry of the SEA bundle (see `scripts/build-sea.ts`). The embedded bundle doubles as the script for the
// gameplay / UI / BGA-video workers: SEA binaries cannot load worker files from disk, so those workers are
// spawned as eval workers re-running an asset copy of this bundle (see `./node/sea-worker.ts`). Dispatch on
// the workerData role marker before the CLI entry gets a chance to run.
function resolveSeaEntryModule(): Promise<unknown> {
  const seaWorkerRole = isMainThread ? undefined : resolveSeaWorkerRole(workerData);
  if (seaWorkerRole === 'node-gameplay-worker') {
    return import('./node/node-gameplay-worker.ts');
  }
  if (seaWorkerRole === 'node-ui-worker') {
    return import('./node/node-ui-worker.ts');
  }
  if (seaWorkerRole === 'bga-video-worker') {
    return import('./bga-video-worker.ts');
  }
  return import('./cli.ts');
}

void resolveSeaEntryModule().catch((error: unknown) => {
  const message = error instanceof Error && error.stack ? error.stack : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

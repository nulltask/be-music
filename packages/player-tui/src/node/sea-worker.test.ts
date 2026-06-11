import { describe, expect, it } from 'vitest';
import { isSeaRuntime, resolveSeaWorkerRole, SEA_WORKER_ROLE_FIELD, SEA_WORKER_ROLES } from './sea-worker.ts';

describe('resolveSeaWorkerRole', () => {
  it.each(SEA_WORKER_ROLES)('resolves the %s role from workerData', (role) => {
    expect(resolveSeaWorkerRole({ [SEA_WORKER_ROLE_FIELD]: role })).toBe(role);
  });

  it('keeps the rest of workerData irrelevant to the resolution', () => {
    expect(
      resolveSeaWorkerRole({
        [SEA_WORKER_ROLE_FIELD]: 'node-ui-worker',
        json: { metadata: {} },
        mode: 'auto',
      }),
    ).toBe('node-ui-worker');
  });

  it('returns undefined for unknown role values', () => {
    expect(resolveSeaWorkerRole({ [SEA_WORKER_ROLE_FIELD]: 'some-other-worker' })).toBeUndefined();
    expect(resolveSeaWorkerRole({ [SEA_WORKER_ROLE_FIELD]: 1 })).toBeUndefined();
    expect(resolveSeaWorkerRole({ [SEA_WORKER_ROLE_FIELD]: undefined })).toBeUndefined();
  });

  it('returns undefined when workerData has no role marker', () => {
    expect(resolveSeaWorkerRole({ videoPath: 'movie.mpg', mode: 'base' })).toBeUndefined();
  });

  it('returns undefined for non-object workerData', () => {
    expect(resolveSeaWorkerRole(undefined)).toBeUndefined();
    expect(resolveSeaWorkerRole(null)).toBeUndefined();
    expect(resolveSeaWorkerRole('node-ui-worker')).toBeUndefined();
  });
});

describe('isSeaRuntime', () => {
  it('returns false outside a single executable application', () => {
    expect(isSeaRuntime()).toBe(false);
  });
});

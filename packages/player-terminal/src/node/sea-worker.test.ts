import { describe, expect, it } from 'vite-plus/test';
import { isSEARuntime, resolveSEAWorkerRole, SEA_WORKER_ROLE_FIELD, SEA_WORKER_ROLES } from './sea-worker.ts';

describe('resolveSEAWorkerRole', () => {
  it.each(SEA_WORKER_ROLES)('resolves the %s role from workerData', (role) => {
    expect(resolveSEAWorkerRole({ [SEA_WORKER_ROLE_FIELD]: role })).toBe(role);
  });

  it('keeps the rest of workerData irrelevant to the resolution', () => {
    expect(
      resolveSEAWorkerRole({
        [SEA_WORKER_ROLE_FIELD]: 'node-ui-worker',
        json: { metadata: {} },
        mode: 'auto',
      }),
    ).toBe('node-ui-worker');
  });

  it('returns undefined for unknown role values', () => {
    expect(resolveSEAWorkerRole({ [SEA_WORKER_ROLE_FIELD]: 'some-other-worker' })).toBeUndefined();
    expect(resolveSEAWorkerRole({ [SEA_WORKER_ROLE_FIELD]: 1 })).toBeUndefined();
    expect(resolveSEAWorkerRole({ [SEA_WORKER_ROLE_FIELD]: undefined })).toBeUndefined();
  });

  it('returns undefined when workerData has no role marker', () => {
    expect(resolveSEAWorkerRole({ videoPath: 'movie.mpg', mode: 'base' })).toBeUndefined();
  });

  it('returns undefined for non-object workerData', () => {
    expect(resolveSEAWorkerRole(undefined)).toBeUndefined();
    expect(resolveSEAWorkerRole(null)).toBeUndefined();
    expect(resolveSEAWorkerRole('node-ui-worker')).toBeUndefined();
  });
});

describe('isSEARuntime', () => {
  it('returns false outside a single executable application', () => {
    expect(isSEARuntime()).toBe(false);
  });
});

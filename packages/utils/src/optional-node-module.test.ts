import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadOptionalNodeModule } from './optional-node-module.ts';

describe('loadOptionalNodeModule', () => {
  it('returns the module when the import succeeds', async () => {
    const loaded = await loadOptionalNodeModule('anything', async () => ({ marker: 'imported' }));
    expect(loaded).toEqual({ marker: 'imported' });
  });

  it('falls back to createRequire resolution when the import fails', async () => {
    const loaded = await loadOptionalNodeModule<typeof import('node:path')>('node:path', () =>
      Promise.reject(new Error('ERR_UNKNOWN_BUILTIN_MODULE')),
    );
    expect(loaded?.join).toBe(join);
  });

  it('returns undefined when the module cannot be resolved anywhere', async () => {
    const loaded = await loadOptionalNodeModule('@be-music/this-module-does-not-exist', () =>
      Promise.reject(new Error('ERR_UNKNOWN_BUILTIN_MODULE')),
    );
    expect(loaded).toBeUndefined();
  });
});

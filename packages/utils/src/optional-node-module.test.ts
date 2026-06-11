import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadOptionalNodeModule, OPTIONAL_NODE_MODULE_DIR_ENV } from './optional-node-module.ts';

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

  describe('with the optional-module directory environment variable', () => {
    let baseDir: string | undefined;

    afterEach(async () => {
      delete process.env[OPTIONAL_NODE_MODULE_DIR_ENV];
      if (baseDir) {
        await rm(baseDir, { recursive: true, force: true });
        baseDir = undefined;
      }
    });

    it('resolves modules from the configured node_modules directory', async () => {
      baseDir = await mkdtemp(join(tmpdir(), 'be-music-optional-module-'));
      const packageDir = join(baseDir, 'node_modules', 'fake-optional-package');
      await mkdir(packageDir, { recursive: true });
      await writeFile(
        join(packageDir, 'package.json'),
        JSON.stringify({ name: 'fake-optional-package', version: '1.0.0', main: 'index.cjs' }),
      );
      await writeFile(join(packageDir, 'index.cjs'), 'module.exports = { marker: "from-env-dir" };');
      process.env[OPTIONAL_NODE_MODULE_DIR_ENV] = baseDir;

      const loaded = await loadOptionalNodeModule<{ marker: string }>('fake-optional-package', () =>
        Promise.reject(new Error('ERR_UNKNOWN_BUILTIN_MODULE')),
      );
      expect(loaded?.marker).toBe('from-env-dir');
    });
  });
});

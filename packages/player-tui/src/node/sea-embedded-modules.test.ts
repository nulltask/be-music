import { describe, expect, it } from 'vite-plus/test';
import { OPTIONAL_NODE_MODULE_DIR_ENV } from '@be-music/utils/optional-node-module';
import { ensureSEAEmbeddedNodeModules } from './sea-embedded-modules.ts';

describe('ensureSEAEmbeddedNodeModules', () => {
  it('is a no-op outside a single executable application', async () => {
    await expect(ensureSEAEmbeddedNodeModules()).resolves.toBeUndefined();
    expect(process.env[OPTIONAL_NODE_MODULE_DIR_ENV]).toBeUndefined();
  });
});

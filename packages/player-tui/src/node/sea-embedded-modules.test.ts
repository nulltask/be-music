import { describe, expect, it } from 'vitest';
import { OPTIONAL_NODE_MODULE_DIR_ENV } from '@be-music/utils/optional-node-module';
import { ensureSeaEmbeddedNodeModules } from './sea-embedded-modules.ts';

describe('ensureSeaEmbeddedNodeModules', () => {
  it('is a no-op outside a single executable application', async () => {
    await expect(ensureSeaEmbeddedNodeModules()).resolves.toBeUndefined();
    expect(process.env[OPTIONAL_NODE_MODULE_DIR_ENV]).toBeUndefined();
  });
});

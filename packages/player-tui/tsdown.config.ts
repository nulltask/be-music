import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackageTsdownConfig } from '../../tsdown.package.config.mts';

const packageDir = dirname(fileURLToPath(import.meta.url));

export default createPackageTsdownConfig({
  packageDir,
  entries: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'bga-video-worker': 'src/bga-video-worker.ts',
    'node-gameplay-worker': 'src/node/node-gameplay-worker.ts',
    'node-ui-worker': 'src/node/node-ui-worker.ts',
  },
});

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackageViteConfig } from '../../vite.package.config';

const packageDir = dirname(fileURLToPath(import.meta.url));

export default createPackageViteConfig({
  packageDir,
  entries: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'node-gameplay-worker': 'src/node/node-gameplay-worker.ts',
    'node-ui-worker': 'src/node/node-ui-worker.ts',
  },
});

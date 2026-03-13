import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackageTsdownConfig } from '../../tsdown.package.config.mts';

const packageDir = dirname(fileURLToPath(import.meta.url));

export default createPackageTsdownConfig({
  packageDir,
  entries: {
    index: 'src/index.ts',
  },
});

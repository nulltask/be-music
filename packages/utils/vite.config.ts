import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackageViteConfig } from '../../vite.package.config';

const packageDir = dirname(fileURLToPath(import.meta.url));

export default createPackageViteConfig({
  packageDir,
  entries: {
    index: 'src/index.ts',
  },
});

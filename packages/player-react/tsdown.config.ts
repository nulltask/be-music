import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserPackageTsdownConfig } from '../../tsdown.browser.package.config.mts';

const packageDir = dirname(fileURLToPath(import.meta.url));

export default createBrowserPackageTsdownConfig({
  packageDir,
  entries: {
    index: 'src/index.tsx',
  },
});

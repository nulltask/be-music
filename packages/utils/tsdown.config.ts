import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackageTsdownConfig } from '../../tsdown.package.config.mts';

const packageDir = dirname(fileURLToPath(import.meta.url));

export default createPackageTsdownConfig({
  packageDir,
  entries: {
    index: 'src/index.ts',
    // Carve out narrow subpath entry points so browser bundles can import only the helpers they need without routing
    // through the package root and pulling unrelated Node-facing modules into the graph.
    core: 'src/core.ts',
    path: 'src/path.ts',
    workerize: 'src/workerize.ts',
  },
});

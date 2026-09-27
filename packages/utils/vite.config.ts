import { defineConfig } from 'vite-plus';
import { createPackageConfig } from '../../vite.package.config.ts';

export default defineConfig({
  pack: createPackageConfig({
    packageDir: import.meta.dirname,
    entries: {
      index: 'src/index.ts',
      // Carve out narrow subpath entry points so browser bundles can import only the helpers they need without routing
      // through the package root and pulling unrelated Node-facing modules into the graph.
      core: 'src/core.ts',
      'cli-path': 'src/cli-path.ts',
      log: 'src/log.ts',
      'optional-node-module': 'src/optional-node-module.ts',
      path: 'src/path.ts',
      pcm: 'src/pcm.ts',
      workerize: 'src/workerize.ts',
    },
  }),
});

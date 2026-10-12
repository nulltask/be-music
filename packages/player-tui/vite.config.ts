import { defineConfig } from 'vite-plus';
import { createPackageConfig } from '../../vite.package.config.ts';

export default defineConfig({
  pack: createPackageConfig({
    packageDir: import.meta.dirname,
    entries: {
      index: 'src/index.ts',
      cli: 'src/cli.ts',
      'playlog-cli': 'src/playlog-cli.ts',
      'bga-video-worker': 'src/bga-video-worker.ts',
      'node-gameplay-worker': 'src/node/node-gameplay-worker.ts',
      'node-ui-worker': 'src/node/node-ui-worker.ts',
    },
  }),
});

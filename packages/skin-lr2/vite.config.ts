import { defineConfig } from 'vite-plus';
import { createPackageConfig } from '../../vite.package.config.ts';

export default defineConfig({
  pack: createPackageConfig({
    packageDir: import.meta.dirname,
    entries: {
      index: 'src/index.ts',
      ids: 'src/ids/index.ts',
      state: 'src/state/index.ts',
    },
  }),
});

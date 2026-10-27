import { defineConfig } from 'vite-plus';
import { createPackageConfig } from '../../vite.package.config.ts';

export default defineConfig({
  pack: {
    ...createPackageConfig({
      packageDir: import.meta.dirname,
      entries: { index: 'src/index.ts', 'themes/basecoat': 'src/themes/basecoat.ts' },
    }),
    platform: 'browser',
    target: 'es2022',
  },
});

import { defineConfig } from 'vite-plus';
import { createPackageConfig } from '../../vite.package.config.ts';

export default defineConfig({
  pack: createPackageConfig({
    packageDir: import.meta.dirname,
    entries: {
      // The union of the entries below, plus `logger` and Pixi's `Rectangle`.
      index: 'src/index.ts',
      // The designed entries, surfaced through `package.json#exports` (docs/player-web.md, "Entry points"). Each
      // barrel's header says what it exports.
      host: 'src/host/index.ts',
      skin: 'src/skin/index.ts',
      collection: 'src/collection/index.ts',
      audio: 'src/runtime/index.ts',
      recording: 'src/recording/index.ts',
      compute: 'src/compute/index.ts',
    },
  }),
});

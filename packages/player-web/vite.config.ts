import { defineConfig } from 'vite-plus';
import { createPackageConfig } from '../../vite.package.config.ts';

export default defineConfig({
  pack: createPackageConfig({
    packageDir: import.meta.dirname,
    entries: {
      // Main grab-bag entry that re-exports every per-area subpath. Kept for backwards compatibility with consumers
      // that import from `@be-music/player-web` directly. New code should prefer the per-area subpaths below.
      index: 'src/index.ts',
      // Per-area subpath entries — surfaced through `package.json#exports`. Each barrel's set of exports is documented
      // in the corresponding `src/<area>/index.ts` header.
      scenes: 'src/scene/index.ts',
      skin: 'src/skin/index.ts',
      chart: 'src/chart/index.ts',
      collection: 'src/collection/index.ts',
      runtime: 'src/runtime/index.ts',
    },
  }),
});

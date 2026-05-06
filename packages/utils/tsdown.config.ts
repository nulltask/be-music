import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackageTsdownConfig } from '../../tsdown.package.config.mts';

const packageDir = dirname(fileURLToPath(import.meta.url));

export default createPackageTsdownConfig({
  packageDir,
  entries: {
    index: 'src/index.ts',
    // Carve out the browser-safe `core` and Node-only `workerize` entry points so the package root doesn't
    // statically drag `node:sea` (workerize.ts) into a browser bundle. Vite externalises `node:`-prefixed
    // imports for browser targets, but only crashes when the externalised symbol is actually accessed —
    // splitting workerize off the root means a browser caller importing from `@be-music/utils` never reaches
    // `node:sea` in the first place.
    core: 'src/core.ts',
    workerize: 'src/workerize.ts',
  },
});

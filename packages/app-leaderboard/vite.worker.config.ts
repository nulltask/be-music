import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';

// Workers runtime conditions first, then the repository's `source` condition for the workspace packages.
const conditions = ['workerd', 'worker', 'source', 'module', 'import', 'default'];

/**
 * Bundles the Worker into `dist/worker.js`, the entrypoint `cloudflare.config.ts` deploys. `cf` bundles its entrypoint
 * with its own esbuild, which cannot resolve the workspace packages: they reach their TypeScript sources only through
 * the `source` export condition, and their `dist` is not built in Workers Builds. Vite+ resolves that condition like
 * every other tool in the repository, so `cf` only re-reads a module with nothing left to resolve.
 */
export default defineConfig({
  resolve: { conditions },
  ssr: {
    // Everything is inlined; only the runtime's own modules stay imports.
    noExternal: true,
    target: 'webworker',
    resolve: { conditions, externalConditions: conditions },
  },
  build: {
    ssr: resolve(import.meta.dirname, 'src/index.ts'),
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2024',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external: [/^node:/, /^cloudflare:/],
      output: { entryFileNames: 'worker.js', format: 'es' },
    },
  },
});

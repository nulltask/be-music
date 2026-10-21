import { defineConfig, defaultClientConditions } from 'vite-plus';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '../../..');
const baseline = process.env.BENCH_BASE_REF || '7a4b7a13^';
const virtual = resolve(repository, 'packages/player-browser/src/collection/__benchmark_baseline.ts');
export default defineConfig({
  root: import.meta.dirname,
  resolve: { conditions: ['source', ...defaultClientConditions] },
  plugins: [
    {
      name: 'benchmark-baseline-collection',
      resolveId(id) {
        if (id === 'virtual:baseline-collection') return virtual;
      },
      load(id) {
        if (id === virtual)
          return execFileSync('git', ['show', `${baseline}:packages/player-browser/src/collection/collection.ts`], {
            cwd: repository,
            encoding: 'utf8',
          });
      },
    },
  ],
  build: { outDir: resolve(repository, 'tmp/bench/browser-workers-dist'), emptyOutDir: true },
});

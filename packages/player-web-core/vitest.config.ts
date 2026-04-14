import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packageDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(packageDir, '../..');

export default defineConfig({
  resolve: {
    alias: {
      '@be-music/chart': resolve(rootDir, 'packages/chart/src/index.ts'),
      '@be-music/json': resolve(rootDir, 'packages/json/src/index.ts'),
      '@be-music/parser/browser': resolve(rootDir, 'packages/parser/src/browser.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

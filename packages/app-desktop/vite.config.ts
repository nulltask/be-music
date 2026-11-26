import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: { main: resolve(import.meta.dirname, 'src/main.ts') },
    clean: true,
    dts: false,
    fixedExtension: false,
    format: 'esm',
    outDir: 'dist',
    platform: 'node',
    sourcemap: true,
    // Electron 45 runs Node 24 in the main process.
    target: 'node24',
    deps: { neverBundle: ['electron'] },
  },
});

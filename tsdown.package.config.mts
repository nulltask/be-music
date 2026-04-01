import { resolve } from 'node:path';
import { defineConfig } from 'tsdown';

interface CreatePackageTsdownConfigOptions {
  packageDir: string;
  entries: Record<string, string>;
}

function createCliShebangPlugin() {
  return {
    name: 'be-music-cli-shebang',
    generateBundle(_options: unknown, bundle: Record<string, { type?: string; code?: string }>) {
      const cliChunk = bundle['cli.js'];
      if (!cliChunk || cliChunk.type !== 'chunk' || typeof cliChunk.code !== 'string' || cliChunk.code.startsWith('#!')) {
        return;
      }

      // Keep the published CLI executable without carrying a shebang in TS source files.
      cliChunk.code = `#!/usr/bin/env node\n${cliChunk.code}`;
    },
  };
}

export function createPackageTsdownConfig(options: CreatePackageTsdownConfigOptions) {
  const entry = Object.fromEntries(
    Object.entries(options.entries).map(([name, relativePath]) => [name, resolve(options.packageDir, relativePath)]),
  );

  return defineConfig({
    entry,
    clean: true,
    dts: true,
    fixedExtension: false,
    format: 'esm',
    outDir: 'dist',
    platform: 'node',
    sourcemap: true,
    target: 'node25',
    plugins: Object.hasOwn(entry, 'cli') ? [createCliShebangPlugin()] : undefined,
  });
}

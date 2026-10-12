import { resolve } from 'node:path';
import type { PackUserConfig } from 'vite-plus/pack';

interface CreatePackageConfigOptions {
  packageDir: string;
  entries: Record<string, string>;
}

function createCliShebangPlugin() {
  return {
    name: 'be-music-cli-shebang',
    generateBundle(_options: unknown, bundle: Record<string, { type?: string; code?: string }>) {
      const cliChunk = bundle['cli.js'];
      if (
        !cliChunk ||
        cliChunk.type !== 'chunk' ||
        typeof cliChunk.code !== 'string' ||
        cliChunk.code.startsWith('#!')
      ) {
        return;
      }

      // Keep the published CLI executable without carrying a shebang in TS source files.
      cliChunk.code = `#!/usr/bin/env node\n${cliChunk.code}`;
    },
  };
}

/**
 * Builds the shared `pack` block (tsdown via `vp pack`) for a workspace package. Each package's `vite.config.ts` only
 * supplies its entry map; entries resolve against the package directory so the config works from any cwd.
 */
export function createPackageConfig(options: CreatePackageConfigOptions): PackUserConfig {
  const entry = Object.fromEntries(
    Object.entries(options.entries).map(([name, relativePath]) => [name, resolve(options.packageDir, relativePath)]),
  );

  return {
    entry,
    // `tsconfig.json` is the package's type-check project (tests, `paths` into sibling sources); declarations are
    // emitted from the narrower build project instead.
    tsconfig: resolve(options.packageDir, 'tsconfig.build.json'),
    clean: true,
    dts: true,
    fixedExtension: false,
    format: 'esm',
    outDir: 'dist',
    platform: 'node',
    sourcemap: true,
    target: 'node26',
    plugins: Object.hasOwn(entry, 'cli') ? [createCliShebangPlugin()] : undefined,
  };
}

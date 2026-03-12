import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig, type Plugin, type UserConfigExport } from 'vite';

interface PackageJson {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface CreatePackageViteConfigOptions {
  packageDir: string;
  entries: Record<string, string>;
}

function readPackageJson(packageDir: string): PackageJson {
  const filePath = resolve(packageDir, 'package.json');
  const raw = readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as PackageJson;
}

function resolveExternalModules(packageJson: PackageJson): string[] {
  const externals = new Set<string>();
  const dependencyNames = [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
  ];

  for (const name of dependencyNames) {
    externals.add(name);
  }

  for (const builtin of builtinModules) {
    externals.add(builtin);
    externals.add(`node:${builtin}`);
  }

  return [...externals];
}

function createCliShebangPlugin(): Plugin {
  return {
    name: 'be-music-cli-shebang',
    generateBundle(_options, bundle) {
      const cliChunk = bundle['cli.js'];
      if (!cliChunk || cliChunk.type !== 'chunk' || cliChunk.code.startsWith('#!')) {
        return;
      }

      // Keep the shebang on published CLI output without carrying it in TS source files.
      cliChunk.code = `#!/usr/bin/env node\n${cliChunk.code}`;
    },
  };
}

export function createPackageViteConfig(options: CreatePackageViteConfigOptions): UserConfigExport {
  const packageJson = readPackageJson(options.packageDir);
  const entries = Object.fromEntries(
    Object.entries(options.entries).map(([name, relativePath]) => [name, resolve(options.packageDir, relativePath)]),
  );

  return defineConfig({
    plugins: Object.hasOwn(entries, 'cli') ? [createCliShebangPlugin()] : undefined,
    build: {
      target: 'node20',
      outDir: resolve(options.packageDir, 'dist'),
      emptyOutDir: true,
      sourcemap: true,
      minify: false,
      lib: {
        entry: entries,
        formats: ['es'],
        fileName: (_format, entryName) => `${entryName}.js`,
      },
      rollupOptions: {
        external: resolveExternalModules(packageJson),
      },
    },
  });
}

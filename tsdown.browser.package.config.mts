import { resolve } from 'node:path';
import { defineConfig } from 'tsdown';

interface CreateBrowserPackageTsdownConfigOptions {
  packageDir: string;
  entries: Record<string, string>;
}

export function createBrowserPackageTsdownConfig(options: CreateBrowserPackageTsdownConfigOptions) {
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
    platform: 'neutral',
    sourcemap: true,
    target: 'es2022',
  });
}

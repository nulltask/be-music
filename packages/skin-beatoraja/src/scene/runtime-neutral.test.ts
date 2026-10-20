import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

/**
 * The scene mapping (`@be-music/skin-beatoraja/scene`) sits between the scene models and the renderer: it draws
 * nothing, and loads neither the Lua VM nor the skin parser. This walks every module the subpath's barrel loads at run
 * time (type-only imports are erased) and checks that its package imports are the scene models, the engine's
 * vocabulary, the LR2 id tables and the file helpers. (Node built-ins, DOM globals and clocks are kept out by the lint
 * rules in `vite.config.ts`.)
 */
const BARREL = resolve(import.meta.dirname, 'index.ts');
const PACKAGE_SRC = resolve(import.meta.dirname, '..');
const ALLOWED_PACKAGES = [
  '@be-music/player-scene-model',
  '@be-music/player-engine/',
  '@be-music/skin-lr2/ids',
  '@be-music/shared-utils/core',
];
const SPECIFIER = /^\s*(import|export)\s+(?!type\b)[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gmu;

function runtimeImports(entry: string): { packages: string[]; files: string[] } {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
      const specifier = match[2]!;
      if (specifier.startsWith('.')) pending.push(resolve(dirname(file), specifier));
      else packages.add(specifier);
    }
  }
  return { packages: [...packages].sort(), files: [...seen].map((file) => relative(PACKAGE_SRC, file)).sort() };
}

describe('the beatoraja scene mapping', () => {
  it('loads only the scene models, the engine vocabulary, the LR2 ids and the file helpers', () => {
    const { packages } = runtimeImports(BARREL);
    expect(packages.filter((name) => !ALLOWED_PACKAGES.some((allowed) => name.startsWith(allowed)))).toEqual([]);
  });

  it('stays out of the Lua VM and the skin parser', () => {
    const { files } = runtimeImports(BARREL);
    expect(files.filter((file) => !file.startsWith('scene/'))).toEqual([
      'elements/base.ts',
      'elements/gauge.ts',
      'file-lookup.ts',
      'runtime-ids.ts',
    ]);
  });
});

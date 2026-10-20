import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

/**
 * The scene models sit below every skin family and renderer: they draw nothing and run unchanged in the browser, in
 * Node and in tests. This walks every module the package barrel reaches — type-only imports included, since they shape
 * the published declarations — and checks that it stays inside this package and that its only package imports are the
 * chart model and the engine, none of which draws. (Node built-ins and DOM globals are kept out by the runtime-neutral
 * lint rules in `vite.config.ts`.)
 */
const BARREL = resolve(import.meta.dirname, 'index.ts');
const SRC_DIR = import.meta.dirname;
const ALLOWED_PACKAGES = ['@be-music/chart-model', '@be-music/chart-source', '@be-music/player-engine/'];
const SPECIFIER = /\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;

function packageImports(entry: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2]!;
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier);
        if (!target.startsWith(SRC_DIR)) found.push(`${relative(SRC_DIR, file)} leaves the package for ${specifier}`);
        else pending.push(target);
      } else if (!ALLOWED_PACKAGES.some((allowed) => specifier === allowed || specifier.startsWith(allowed))) {
        found.push(`${relative(SRC_DIR, file)} imports ${specifier}`);
      }
    }
  }
  return found;
}

describe('scene models', () => {
  it('stay inside the package and build only on the chart model and the engine', () => {
    expect(packageImports(BARREL)).toEqual([]);
  });
});

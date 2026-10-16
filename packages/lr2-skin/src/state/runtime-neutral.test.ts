import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

/**
 * The LR2 state resolvers map the scene models to LR2's vocabulary and nothing else: they draw nothing and run
 * unchanged in the browser, in Node and in tests. This walks every module the `state` barrel reaches — type-only
 * imports included — and checks that it stays inside the package and imports only the scene models, the engine and
 * the chart model. (Node built-ins, DOM globals and clocks are kept out by the lint rules in `vite.config.ts`.)
 */
const BARREL = resolve(import.meta.dirname, 'index.ts');
const PACKAGE_SRC = resolve(import.meta.dirname, '..');
const ALLOWED_PACKAGES = ['@be-music/chart', '@be-music/json', '@be-music/player/', '@be-music/scene-model'];
/** Package modules outside `state/` the resolvers may reach: the id tables and the parsed skin's types. */
const ALLOWED_SIBLINGS = [resolve(PACKAGE_SRC, 'ids'), resolve(PACKAGE_SRC, 'skin.ts')];
const SPECIFIER = /\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;

function packageImports(entry: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    // The parsed skin is reached for its types only; its own imports are the parser's.
    if (file === resolve(PACKAGE_SRC, 'skin.ts')) continue;
    for (const match of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2]!;
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier);
        const inside =
          target.startsWith(import.meta.dirname) || ALLOWED_SIBLINGS.some((sibling) => target.startsWith(sibling));
        if (!inside) found.push(`${relative(PACKAGE_SRC, file)} reaches ${specifier}`);
        else pending.push(target);
      } else if (!ALLOWED_PACKAGES.some((allowed) => specifier === allowed || specifier.startsWith(allowed))) {
        found.push(`${relative(PACKAGE_SRC, file)} imports ${specifier}`);
      }
    }
  }
  return found;
}

describe('LR2 state resolvers', () => {
  it('build only on the scene models, the engine, the chart model and the id tables', () => {
    expect(packageImports(BARREL)).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

/**
 * The skin SDK never touches a rendering framework: skins bring their own (Canvas 2D, WebGL, PixiJS, three.js, …). This
 * walks every module the SDK barrel reaches — type-only imports included, since they shape the published declarations —
 * and checks that it stays inside this package and that its only package imports are the repository's own engine
 * packages, none of which draws.
 */
const SDK_BARREL = resolve(import.meta.dirname, 'index.ts');
const SRC_DIR = import.meta.dirname;
/** Packages the SDK may build on: the chart model and engine, which import no renderer. */
const ALLOWED_PACKAGES = ['@be-music/audio-renderer/', '@be-music/chart', '@be-music/json', '@be-music/player/'];
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

describe('skin SDK', () => {
  it('stays inside the package and reaches no rendering framework', () => {
    expect(packageImports(SDK_BARREL)).toEqual([]);
  });
});

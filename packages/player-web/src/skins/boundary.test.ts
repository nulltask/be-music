import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

/**
 * The built-in skins are written like third-party skins: each may import only the public skin SDK barrel, Pixi, and
 * files inside its own folder (tests may also use the test runner and Node built-ins); Plain, the Canvas 2D example,
 * not even Pixi. This keeps the SDK honest — if a
 * built-in skin needs something, the SDK has to offer it.
 */
const SKINS_DIR = import.meta.dirname;
const SDK_BARREL = resolve(SKINS_DIR, '../skin-sdk/index.ts');
const SPECIFIER = /\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function violations(file: string): string[] {
  const skinDir = join(SKINS_DIR, relative(SKINS_DIR, file).split(sep)[0]!);
  const isTest = file.endsWith('.test.ts');
  const found: string[] = [];
  for (const match of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2]!;
    // Plain is the Canvas 2D example: it must not need Pixi at all.
    if (specifier === 'pixi.js' && !file.startsWith(join(SKINS_DIR, 'plain') + sep)) continue;
    if (isTest && (specifier === 'vite-plus/test' || specifier.startsWith('node:'))) continue;
    if (specifier.startsWith('.')) {
      const target = resolve(dirname(file), specifier);
      if (target === SDK_BARREL || target.startsWith(skinDir + sep)) continue;
    }
    found.push(`${relative(SKINS_DIR, file)} imports ${specifier}`);
  }
  return found;
}

describe('built-in skin import boundary', () => {
  const skins = readdirSync(SKINS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory());

  it('covers every built-in skin', () => {
    expect(skins.map((entry) => entry.name).sort()).toEqual(['lattice', 'phantom', 'plain', 'synesthesia']);
  });

  it.each(skins.map((entry) => entry.name))('%s imports only the skin SDK, pixi.js, and its own files', (name) => {
    expect(listFiles(join(SKINS_DIR, name)).flatMap(violations)).toEqual([]);
  });
});

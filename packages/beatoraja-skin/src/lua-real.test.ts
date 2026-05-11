import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateBeatorajaLuaSkin } from './lua.ts';

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__/lua-skin');
const readFixture = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(fixtureDir, name)));

describe('evaluateBeatorajaLuaSkin (real beatoraja default theme)', () => {
  it('returns the play24 header from the entry script when skin_config is absent', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: readFixture('play24.luaskin'),
      entryName: 'play24.luaskin',
      modules: [
        { name: 'play24main', source: readFixture('play24main.lua') },
        { name: 'play_parts', source: readFixture('play_parts.lua') },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const header = result.value as Record<string, unknown>;
    expect(header.type).toBe(16);
    expect(header.w).toBe(1280);
    expect(header.h).toBe(720);
    expect(typeof header.name).toBe('string');
    expect(Array.isArray(header.property)).toBe(true);
    expect(Array.isArray(header.filepath)).toBe(true);
  });

  it('returns the full play24 main skin when skin_config is provided', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: readFixture('play24.luaskin'),
      entryName: 'play24.luaskin',
      modules: [
        { name: 'play24main', source: readFixture('play24main.lua') },
        { name: 'play_parts', source: readFixture('play_parts.lua') },
      ],
      // Pick the "Half Lane" / score-graph-off / judge-count-off / judge-detail-off branch.
      skinConfig: {
        offset: 0,
        option: {
          'Lane Geometry': 920,
          'Score Graph': 900,
          'Judge Count': 905,
          'Judge Detail': 910,
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const skin = result.value as Record<string, unknown>;
    expect(skin.w).toBe(1280);
    expect(Array.isArray(skin.source)).toBe(true);
    expect(Array.isArray(skin.image)).toBe(true);
    expect(Array.isArray(skin.destination)).toBe(true);
  });

  it('evaluates the result skin entry script for both phases', () => {
    const header = evaluateBeatorajaLuaSkin({
      entry: readFixture('result.luaskin'),
      entryName: 'result.luaskin',
      modules: [{ name: 'resultmain', source: readFixture('resultmain.lua') }],
    });
    expect(header.ok).toBe(true);
    if (!header.ok) throw new Error(header.error.message);
    expect((header.value as Record<string, unknown>).type).toBe(7);

    const main = evaluateBeatorajaLuaSkin({
      entry: readFixture('result.luaskin'),
      entryName: 'result.luaskin',
      modules: [{ name: 'resultmain', source: readFixture('resultmain.lua') }],
      skinConfig: { offset: 0, option: {} },
    });
    expect(main.ok).toBe(true);
    if (!main.ok) throw new Error(main.error.message);
    expect(Array.isArray((main.value as Record<string, unknown>).image)).toBe(true);
  });
});

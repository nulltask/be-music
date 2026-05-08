import { describe, expect, it } from 'vitest';
import { detectBeatorajaSkinFormat, loadBeatorajaSkin } from './beatoraja-skin.ts';
import {
  BEATORAJA_SKIN_TYPE,
  buildDefaultSkinConfigOptions,
  playVariantForSkinType,
  sceneForSkinType,
} from './beatoraja-skin-types.ts';
import type { BeatorajaSkinFileEntry } from './file-lookup.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function makeFiles(entries: ReadonlyArray<readonly [string, string]>): Map<string, BeatorajaSkinFileEntry> {
  return new Map(entries.map(([k, v]) => [k, enc(v)]));
}

describe('detectBeatorajaSkinFormat', () => {
  it('classifies extensions case-insensitively', () => {
    expect(detectBeatorajaSkinFormat('skin/play.json')).toBe('json');
    expect(detectBeatorajaSkinFormat('skin/PLAY.JSON')).toBe('json');
    expect(detectBeatorajaSkinFormat('skin/play.luaskin')).toBe('lua');
    expect(detectBeatorajaSkinFormat('skin/play.LuaSkin')).toBe('lua');
    expect(detectBeatorajaSkinFormat('skin/play.txt')).toBeUndefined();
  });
});

describe('SkinType helpers', () => {
  it('matches beatoraja SkinType codes for sound set and course result', () => {
    expect(BEATORAJA_SKIN_TYPE.SOUND_SET).toBe(10);
    expect(sceneForSkinType(10)).toBe('other');
    expect(BEATORAJA_SKIN_TYPE.COURSE_RESULT).toBe(15);
    expect(sceneForSkinType(15)).toBe('course-result');
  });

  it('keeps unsupported battle play types out of normal play variant selection', () => {
    expect(sceneForSkinType(BEATORAJA_SKIN_TYPE.PLAY_7KEYS_BATTLE)).toBe('play');
    expect(playVariantForSkinType(BEATORAJA_SKIN_TYPE.PLAY_7KEYS_BATTLE)).toBeUndefined();
  });
});

describe('buildDefaultSkinConfigOptions', () => {
  it('uses property.def as an item-name lookup', () => {
    expect(
      buildDefaultSkinConfigOptions({
        property: [
          {
            name: 'Lane Cover',
            def: 'Enabled',
            item: [
              { name: 'Disabled', op: 910 },
              { name: 'Enabled', op: 911 },
            ],
          },
        ],
      }),
    ).toEqual({ 'Lane Cover': 911 });
  });

  it('falls back to the first item when property.def is missing or stale', () => {
    expect(
      buildDefaultSkinConfigOptions({
        property: [
          {
            name: 'Play Side',
            item: [
              { name: '1P', op: 920 },
              { name: '2P', op: 921 },
            ],
          },
          {
            name: 'Ghost',
            def: 'Rival',
            item: [
              { name: 'Off', op: 930 },
              { name: 'Self', op: 931 },
            ],
          },
        ],
      }),
    ).toEqual({ 'Play Side': 920, Ghost: 930 });
  });
});

describe('loadBeatorajaSkin (JSON)', () => {
  it('returns the full skin and a derived header', () => {
    const files = makeFiles([
      [
        'skin/play.json',
        JSON.stringify({
          type: 5,
          name: 'demo',
          w: 1280,
          h: 720,
          offset: [{ name: 'Judge Detail', id: 40, x: true, y: true, w: 0, h: 0, r: 1, a: true }],
          source: [{ id: 0, path: 'system.png' }],
          image: [{ id: 0, src: 0, x: 0, y: 0, w: 8, h: 8 }],
        }),
      ],
      ['skin/system.png', 'png-bytes'],
    ]);
    const result = loadBeatorajaSkin({ entryPath: 'skin/play.json', files });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.format).toBe('json');
    expect(result.header.type).toBe(5);
    expect(result.header.offset).toEqual([
      { name: 'Judge Detail', id: 40, x: true, y: true, w: false, h: false, r: true, a: true },
    ]);
    expect(result.skin?.name).toBe('demo');
  });

  it('errors when the entry file is missing', () => {
    const files = makeFiles([]);
    const result = loadBeatorajaSkin({ entryPath: 'skin/play.json', files });
    expect(result.ok).toBe(false);
  });

  it('reports a JSON parse failure', () => {
    const files = makeFiles([['skin/play.json', '{ not json']]);
    const result = loadBeatorajaSkin({ entryPath: 'skin/play.json', files });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.message).toMatch(/failed to parse/i);
  });
});

describe('loadBeatorajaSkin (Lua)', () => {
  const entry = enc(
    ['local t = require("playmain")', 'if skin_config then return t.main() else return t.header end'].join('\n'),
  );
  const playmain = enc(
    [
      'local M = {}',
      'M.header = { type = 5, name = "demo", w = 1280, h = 720, offset = {{ name = "Lift", id = 41, y = true, a = true }} }',
      'function M.main()',
      '  local s = {}; for k, v in pairs(M.header) do s[k] = v end',
      '  s.source = { { id = 0, path = "system.png" } }',
      '  return s',
      'end',
      'return M',
    ].join('\n'),
  );

  it('returns just the header when skinConfig is omitted', () => {
    const files: Map<string, BeatorajaSkinFileEntry> = new Map([
      ['skin/play.luaskin', entry],
      ['skin/playmain.lua', playmain],
    ]);
    const result = loadBeatorajaSkin({ entryPath: 'skin/play.luaskin', files });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.format).toBe('lua');
    expect(result.header.type).toBe(5);
    expect(result.header.offset).toEqual([
      { name: 'Lift', id: 41, x: false, y: true, w: false, h: false, r: false, a: true },
    ]);
    expect(result.skin).toBeUndefined();
  });

  it('returns the full skin when skinConfig is provided', () => {
    const files: Map<string, BeatorajaSkinFileEntry> = new Map([
      ['skin/play.luaskin', entry],
      ['skin/playmain.lua', playmain],
    ]);
    const result = loadBeatorajaSkin({
      entryPath: 'skin/play.luaskin',
      files,
      skinConfig: { offset: 0, option: {} },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.skin?.source?.[0]?.path).toBe('system.png');
  });

  it('discovers `.lua` modules in subdirectories (e.g. `require("result/util")`)', () => {
    // ovnz/blanket-style layout: the entry .luaskin imports per-scene helpers from a sibling directory.
    // The collector must walk recursively and emit module keys with `/` separators preserved.
    const subEntry = enc(
      [
        'local main = require("result/main")',
        'if skin_config then return main.body() else return main.header end',
      ].join('\n'),
    );
    const resultMain = enc(
      [
        'local util = require("result/util")',
        'local M = {}',
        'M.header = { type = 7, name = "blanket", w = 1280, h = 720 }',
        'function M.body() return { type = 7, name = util.tag, w = 1, h = 1 } end',
        'return M',
      ].join('\n'),
    );
    const resultUtil = enc('return { tag = "from-subdir" }');
    const files: Map<string, BeatorajaSkinFileEntry> = new Map([
      ['theme/blanket/result.luaskin', subEntry],
      ['theme/blanket/result/main.lua', resultMain],
      ['theme/blanket/result/util.lua', resultUtil],
    ]);
    const result = loadBeatorajaSkin({
      entryPath: 'theme/blanket/result.luaskin',
      files,
      skinConfig: { offset: 0 },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.skin?.name).toBe('from-subdir');
  });

  it('discovers parent-directory `.lua` modules (e.g. shared `play_parts.lua`)', () => {
    const subEntry = enc(
      [
        'local t = require("submain")',
        'local p = require("shared")',
        'if skin_config then return t.main(p) else return t.header end',
      ].join('\n'),
    );
    const submain = enc(
      [
        'local M = {}',
        'M.header = { type = 0, name = "demo", w = 1, h = 1 }',
        'function M.main(p)',
        '  return { type = 0, name = p.value, w = 1, h = 1 }',
        'end',
        'return M',
      ].join('\n'),
    );
    const shared = enc('return { value = "from-parent" }');
    const files: Map<string, BeatorajaSkinFileEntry> = new Map([
      ['skin/play/play.luaskin', subEntry],
      ['skin/play/submain.lua', submain],
      ['skin/shared.lua', shared],
    ]);
    const result = loadBeatorajaSkin({
      entryPath: 'skin/play/play.luaskin',
      files,
      skinConfig: { offset: 0 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.skin?.name).toBe('from-parent');
  });
});

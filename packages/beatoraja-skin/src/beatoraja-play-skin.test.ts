import { describe, expect, it } from 'vitest';
import { discoverBeatorajaTheme, loadBeatorajaPlaySkin, pickBeatorajaPlaySkin } from './beatoraja-play-skin.ts';
import type { BeatorajaSkinFileEntry } from './file-lookup.ts';
import type { BeatorajaPlaySkinMap, BeatorajaSkinEntry } from './beatoraja-play-skin.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function jsonSkin(type: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, name: `type-${type}`, w: 1280, h: 720, ...extra });
}

describe('discoverBeatorajaTheme', () => {
  it('classifies JSON skins by `type` and groups play variants', () => {
    const files: Map<string, BeatorajaSkinFileEntry> = new Map([
      ['skin/default/play7.json', enc(jsonSkin(0))],
      ['skin/default/play5.json', enc(jsonSkin(1))],
      ['skin/default/play14.json', enc(jsonSkin(2))],
      ['skin/default/play10.json', enc(jsonSkin(3))],
      ['skin/default/play9.json', enc(jsonSkin(4))],
      ['skin/default/play24.json', enc(jsonSkin(16))],
      ['skin/default/play24double.json', enc(jsonSkin(17))],
      ['skin/default/select.json', enc(jsonSkin(5))],
      ['skin/default/graderesult.json', enc(jsonSkin(15))],
    ]);
    const { theme, warnings } = discoverBeatorajaTheme(files);
    expect(warnings).toEqual([]);
    expect(theme.playSkins['7']?.entryPath).toBe('skin/default/play7.json');
    expect(theme.playSkins['5']?.entryPath).toBe('skin/default/play5.json');
    expect(theme.playSkins['14']?.entryPath).toBe('skin/default/play14.json');
    expect(theme.playSkins['10']?.entryPath).toBe('skin/default/play10.json');
    expect(theme.playSkins['9']?.entryPath).toBe('skin/default/play9.json');
    expect(theme.playSkins['24']?.entryPath).toBe('skin/default/play24.json');
    expect(theme.playSkins['24d']?.entryPath).toBe('skin/default/play24double.json');
    expect(theme.selectSkin?.entryPath).toBe('skin/default/select.json');
    expect(theme.gradeResultSkin?.entryPath).toBe('skin/default/graderesult.json');
  });

  it('classifies Lua skins by their evaluated header', () => {
    const luaEntry = enc(
      ['local t = require("resmain")', 'if skin_config then return t.main() else return t.header end'].join('\n'),
    );
    const luaMain = enc(
      [
        'local M = {}',
        'M.header = { type = 7, name = "lua-result", w = 1280, h = 720 }',
        'function M.main() local s = {}; for k, v in pairs(M.header) do s[k] = v end; return s end',
        'return M',
      ].join('\n'),
    );
    const files: Map<string, BeatorajaSkinFileEntry> = new Map([
      ['skin/default/result/result.luaskin', luaEntry],
      ['skin/default/result/resmain.lua', luaMain],
    ]);
    const { theme } = discoverBeatorajaTheme(files);
    expect(theme.resultSkin?.header.name).toBe('lua-result');
  });

  it('skips JSON files outside `skin/` (e.g. beatoraja `practice/<sha>.json`, `player/<id>/config_player.json`)', () => {
    const files: Map<string, BeatorajaSkinFileEntry> = new Map([
      ['beatoraja/practice/abc.json', enc('not-a-skin-just-state-bytes')],
      ['beatoraja/player/player1/config_player.json', enc('{"foo": 1}')],
      ['beatoraja/skin/default/select.json', enc(jsonSkin(5))],
    ]);
    const { theme, warnings } = discoverBeatorajaTheme(files);
    expect(warnings).toEqual([]);
    expect(theme.selectSkin?.entryPath).toBe('beatoraja/skin/default/select.json');
  });

  it('records warnings for invalid skin entries without aborting', () => {
    const files: Map<string, BeatorajaSkinFileEntry> = new Map([
      ['skin/default/play.json', enc('not json')],
      ['skin/default/select.json', enc(jsonSkin(5))],
    ]);
    const { theme, warnings } = discoverBeatorajaTheme(files);
    expect(theme.selectSkin?.entryPath).toBe('skin/default/select.json');
    expect(warnings.map((w) => w.entryPath)).toContain('skin/default/play.json');
  });

  it('prefers JSON over Lua when both target the same play variant', () => {
    const luaEntry = enc(
      ['local t = require("p")', 'if skin_config then return t.main() else return t.header end'].join('\n'),
    );
    const luaMain = enc(
      [
        'local M = {}',
        'M.header = { type = 0, name = "lua7", w = 1, h = 1 }',
        'function M.main() return { type = 0, name = "lua7", w = 1, h = 1 } end',
        'return M',
      ].join('\n'),
    );
    const files: Map<string, BeatorajaSkinFileEntry> = new Map([
      ['skin/default/play7.luaskin', luaEntry],
      ['skin/default/p.lua', luaMain],
      ['skin/default/play7.json', enc(jsonSkin(0, { name: 'json7' }))],
    ]);
    const { theme } = discoverBeatorajaTheme(files);
    expect(theme.playSkins['7']?.entryPath).toBe('skin/default/play7.json');
  });
});

describe('pickBeatorajaPlaySkin', () => {
  function entry(name: string): BeatorajaSkinEntry {
    return { entryPath: `${name}.json`, header: { type: 0, w: 1, h: 1, name } };
  }

  it('returns the exact match when present', () => {
    const skins: BeatorajaPlaySkinMap = { '7': entry('p7'), '14': entry('p14') };
    expect(pickBeatorajaPlaySkin(skins, '7')?.entryPath).toBe('p7.json');
  });

  it('walks the fallback chain when the exact variant is missing', () => {
    const skins: BeatorajaPlaySkinMap = { '7': entry('p7') };
    expect(pickBeatorajaPlaySkin(skins, '14')?.entryPath).toBe('p7.json');
  });

  it('returns undefined when no play skins are available', () => {
    expect(pickBeatorajaPlaySkin({}, '7')).toBeUndefined();
  });
});

describe('loadBeatorajaPlaySkin', () => {
  it('runs the entry script with the supplied skin config', () => {
    const entry: BeatorajaSkinEntry = {
      entryPath: 'skin/default/play.json',
      header: { type: 0, w: 1, h: 1, name: 'demo' },
    };
    const files: Map<string, BeatorajaSkinFileEntry> = new Map([
      ['skin/default/play.json', enc(jsonSkin(0, { destination: [{ id: 1, dst: [{ time: 0, x: 0, y: 0 }] }] }))],
    ]);
    const result = loadBeatorajaPlaySkin(files, entry, { offset: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.skin?.destination).toBeDefined();
  });
});

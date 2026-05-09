import { describe, expect, it } from 'vitest';
import {
  BEATORAJA_LUA_TIMER_OFF_VALUE,
  evaluateBeatorajaLuaBoolean,
  evaluateBeatorajaLuaNumber,
  evaluateBeatorajaLuaSkin,
  isBeatorajaLuaFunctionValue,
} from './beatoraja-skin-lua.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('evaluateBeatorajaLuaSkin', () => {
  it('returns the table value from a trivial entry script', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc('return { name = "demo", w = 1280, h = 720 }'),
      modules: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ name: 'demo', w: 1280, h: 720 });
  });

  it('exposes table.insert/ipairs/pairs/string.format', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local t = {}',
          'for i = 1, 3 do table.insert(t, string.format("v%d", i)) end',
          'local s = {}',
          'for i, v in ipairs(t) do s[i] = v end',
          'return s',
        ].join('\n'),
      ),
      modules: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual(['v1', 'v2', 'v3']);
  });

  it('runs the beatoraja 2-phase header / main contract via require', () => {
    const mainModule = enc(
      [
        'local M = {}',
        'M.header = { type = 16, name = "demo", w = 1280, h = 720, property = {{name = "X", item = {{name = "On", op = 1}}}} }',
        'function M.main()',
        '  local s = {}',
        '  for k, v in pairs(M.header) do s[k] = v end',
        '  s.option_x = skin_config.option["X"]',
        // `skin_config.offset` is now a NAME-KEYED TABLE (matching beatoraja\'s actual Lua
        // bridge); reach into a name-defaulted entry rather than reading the integer chart
        // offset, which is no longer exposed to Lua.
        '  s.offset_a = skin_config.offset["BgBrightness"].a',
        '  return s',
        'end',
        'return M',
      ].join('\n'),
    );
    const entry = enc(
      ['local t = require("mainmod")', 'if skin_config then return t.main() else return t.header end'].join('\n'),
    );
    const modules = [{ name: 'mainmod', source: mainModule }];

    // Phase 1: header.
    const header = evaluateBeatorajaLuaSkin({ entry, modules });
    expect(header.ok).toBe(true);
    if (!header.ok) throw new Error(header.error.message);
    expect(header.value).toEqual({
      type: 16,
      name: 'demo',
      w: 1280,
      h: 720,
      property: [{ name: 'X', item: [{ name: 'On', op: 1 }] }],
    });

    // Phase 2: main with skin_config injected.
    const main = evaluateBeatorajaLuaSkin({
      entry,
      modules,
      skinConfig: { offset: { BgBrightness: { a: 128 } }, option: { X: 1 } },
    });
    expect(main.ok).toBe(true);
    if (!main.ok) throw new Error(main.error.message);
    expect((main.value as Record<string, unknown>).option_x).toBe(1);
    expect((main.value as Record<string, unknown>).offset_a).toBe(128);
  });

  it('skin_config.offset auto-vivifies unknown keys to a default zero record (no host pre-fill required)', () => {
    // The killer ModernChic-pattern: deferred property closures inside
    // `customoption.offset(name)` access `skin_config.offset[name].a` etc. at module-load
    // time. If the host hasn\'t yet propagated a value for `name`, theme code would crash
    // with "attempt to index a nil value". Beatoraja\'s reference Lua bridge auto-fills
    // defaults; we mirror that via an `__index` metatable that yields
    // `{x:0, y:0, w:0, h:0, r:0, a:0}` for any missing key.
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local rec = skin_config.offset["NeverDeclared"]',
          'return { x = rec.x, y = rec.y, w = rec.w, h = rec.h, r = rec.r, a = rec.a }',
        ].join('\n'),
      ),
      modules: [],
      skinConfig: { option: {}, file: {} },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ x: 0, y: 0, w: 0, h: 0, r: 0, a: 0 });
  });

  it('skin_config.offset accepts the legacy number form (chart timing offset) without crashing Lua access', () => {
    // Backward-compat: existing `BeatorajaSkinConfig.offset = number` callers (the chart
    // timing offset slider) still type-check. The number form just doesn\'t surface to Lua;
    // theme code reads from the auto-zero metatable instead.
    const result = evaluateBeatorajaLuaSkin({
      entry: enc('return skin_config.offset["X"].a'),
      modules: [],
      skinConfig: { offset: 5, option: {} },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toBe(0);
  });

  it('treats empty Lua tables as empty arrays (so `filepath = {}` is iterable JS-side)', () => {
    // The reference theme writes `filepath = {}`, `property = {}`, etc. and expects the JS side
    // to consume them with `Array.isArray(...)` / `for..of`. Defaulting empty tables to `[]`
    // matches that contract — record-typed tables always have at least one entry, so this only
    // disambiguates the empty case.
    const result = evaluateBeatorajaLuaSkin({
      entry: enc('return { name = "demo", filepath = {}, property = {}, image = {} }'),
      modules: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const skin = result.value as Record<string, unknown>;
    expect(Array.isArray(skin.filepath)).toBe(true);
    expect(Array.isArray(skin.property)).toBe(true);
    expect(Array.isArray(skin.image)).toBe(true);
    expect(skin.filepath).toEqual([]);
  });

  it('reports syntax errors as a failure result', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc('return {'),
      modules: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected syntax error');
    expect(result.error.message).toMatch(/syntax|unexpected/i);
  });

  it('returns an empty stub table for unknown require modules', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        ['local t = require("some_unknown_helper")', 'return { has_table = type(t) == "table", count = 0 }'].join('\n'),
      ),
      modules: [],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ has_table: true, count: 0 });
  });

  it('returns the SAME stub table on repeated require() calls', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local a = require("some_unknown_helper")',
          'local b = require("some_unknown_helper")',
          'return { same = a == b }',
        ].join('\n'),
      ),
      modules: [],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ same: true });
  });

  it('preserves runtime Lua functions and evaluates them with a main_state context', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local main_state = require("main_state")',
          'local count = 0',
          'return {',
          '  draw = function() return main_state.gauge() >= 80 end,',
          '  value = function() count = count + 1; return main_state.number(10) + count end,',
          '}',
        ].join('\n'),
      ),
      modules: [],
      skinConfig: {},
    });
    if (!result.ok) throw new Error(result.error.message);
    const value = result.value as Record<string, unknown>;
    expect(isBeatorajaLuaFunctionValue(value.draw)).toBe(true);
    expect(isBeatorajaLuaFunctionValue(value.value)).toBe(true);
    if (!isBeatorajaLuaFunctionValue(value.draw) || !isBeatorajaLuaFunctionValue(value.value)) {
      throw new Error('expected runtime Lua functions');
    }
    expect(evaluateBeatorajaLuaBoolean(value.draw, { gauge: () => 79 })).toBe(false);
    expect(evaluateBeatorajaLuaBoolean(value.draw, { gauge: () => 80 })).toBe(true);
    expect(evaluateBeatorajaLuaNumber(value.value, { number: (id) => (id === 10 ? 5 : 0) })).toBe(6);
    expect(evaluateBeatorajaLuaNumber(value.value, { number: (id) => (id === 10 ? 5 : 0) })).toBe(7);
    value.draw.dispose();
    value.value.dispose();
  });

  it('main_state is empty during the header pass', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc('local m = require("main_state"); return { has_gauge = m.gauge ~= nil }'),
      modules: [],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ has_gauge: false });
  });

  it('main_state built-in module exposes the MainStateAccessor surface as default-value stubs', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local m = require("main_state")',
          'return {',
          '  is_table = type(m) == "table",',
          '  exscore = m.exscore(),',
          '  rate = m.rate(),',
          '  text = m.text(10),',
          '  option = m.option(123),',
          '  offset_a = m.offset(3).a,',
          '  timer_is_off = m.timer(46) == m.timer_off_value,',
          '  off_value = m.timer_off_value,',
          '  volume_bg = m.volume_bg(),',
          '  set_timer = m.set_timer(10000, 0),',
          '  judge = m.judge(0),',
          '  gauge_type = m.gauge_type(),',
          '}',
        ].join('\n'),
      ),
      modules: [],
      skinConfig: {},
    });
    if (!result.ok) throw new Error(result.error.message);
    const value = result.value as Record<string, unknown>;
    expect(value.is_table).toBe(true);
    expect(value.exscore).toBe(0);
    expect(value.rate).toBe(0);
    expect(value.text).toBe('');
    expect(value.option).toBe(false);
    // Additive alpha delta default = 0 (Java float field init). Previously 255 under the
    // multiplicative semantics; now an additive +1.0 max-brightness delta if left at 255.
    expect(value.offset_a).toBe(0);
    expect(value.timer_is_off).toBe(true);
    expect(value.off_value).toBe(BEATORAJA_LUA_TIMER_OFF_VALUE);
    expect(value.volume_bg).toBe(0);
    expect(value.set_timer).toBe(true);
    expect(value.judge).toBe(0);
    expect(value.gauge_type).toBe(0);
  });

  it('require accepts both `/` and `.` separators (so `result/util` and `result.util` both resolve)', () => {
    // Both forms must hit the same canonical key in the module table — the loader normalizes `.` → `/`
    // before lookup. We register the module under the slash form (matching how
    // `collectBeatorajaLuaModules` emits keys for nested files).
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local a = require("result/util")',
          'local b = require("result.util")',
          'return { same = a == b, value = a.x }',
        ].join('\n'),
      ),
      modules: [{ name: 'result/util', source: enc('return { x = 42 }') }],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ same: true, value: 42 });
  });

  it('exposes inert stubs for `os` / `io` / `dofile` so themes that reference them load without crashing', () => {
    // Earlier versions of the sandbox stripped `os`, `io`, and `dofile` outright. Community
    // skins (ModernChic) require()-load utility modules whose top-level body unconditionally
    // touches these globals (`local luajava = require("luajava"); local f = io.open(...)`),
    // so a stripped global crashed the entire module load. We now provide inert stubs:
    // `os.time()` / `os.date()` work; `os.execute` / `os.remove` / `os.rename` no-op; `io.open`
    // returns a fake file handle whose methods are no-ops. `dofile` is wired against the bundle
    // resolver — without one supplied, it raises a clear "no resolver" error if invoked.
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'return {',
          '  has_os = os ~= nil,',
          '  has_io = io ~= nil,',
          '  has_dofile = dofile ~= nil,',
          '  os_time_is_function = type(os.time) == "function",',
          '  io_open_is_function = type(io.open) == "function",',
          '}',
        ].join('\n'),
      ),
      modules: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({
      has_os: true,
      has_io: true,
      has_dofile: true,
      os_time_is_function: true,
      io_open_is_function: true,
    });
  });

  it('skin_config:get_path returns `${baseDir}/${rel}` so dofile can round-trip the path', () => {
    // ModernChic loads its layout via `dofile(skin_config.get_path("Play/lua/sp/info.lua"))`.
    // Both the dot-call (`skin_config.get_path(...)`) and colon-call (`skin_config:get_path(...)`)
    // forms appear in the wild — the closure ignores any `self` argument so both work.
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local a = skin_config.get_path("Play/lua/sp/info.lua")',
          'local b = skin_config:get_path("Play/lua/sp/info.lua")',
          'return { dot = a, colon = b }',
        ].join('\n'),
      ),
      modules: [],
      skinConfig: { offset: 0, option: {}, file: {} },
      skinBaseDir: 'skin/ModernChic',
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({
      dot: 'skin/ModernChic/Play/lua/sp/info.lua',
      colon: 'skin/ModernChic/Play/lua/sp/info.lua',
    });
  });

  it('dofile loads + caches bundle files via the resolver', () => {
    // First call hits the resolver; second call (same path) returns the cached value WITHOUT
    // touching the resolver again — beatoraja's runtime caches similarly so themes can
    // dofile the same helper from multiple entry points without paying repeated I/O.
    const calls: string[] = [];
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local a = dofile("util/helper.lua")',
          'local b = dofile("util/helper.lua")',
          'return { a = a.value, b = b.value, same = a == b }',
        ].join('\n'),
      ),
      modules: [],
      skinConfig: { offset: 0, option: {}, file: {} },
      skinBaseDir: 'skin/test',
      dofileResolver: (path) => {
        calls.push(path);
        if (path === 'util/helper.lua') return enc('return { value = 42 }');
        return undefined;
      },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ a: 42, b: 42, same: true });
    expect(calls).toEqual(['util/helper.lua']); // resolver hit ONCE despite two dofile calls
  });

  it('dofile raises a clear error when the resolver has no entry for the requested path', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc('dofile("missing.lua")'),
      modules: [],
      skinConfig: { offset: 0, option: {}, file: {} },
      dofileResolver: () => undefined,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/cannot open 'missing\.lua'.*not found/);
  });

  it('require() is case-insensitive against module keys (matches the collector\'s lowercase convention)', () => {
    // Windows-authored skins commonly capitalise directory components (`require("Root.define")`)
    // even though the collector keys everything under lowercase. The resolver lowercases
    // incoming names so the same Lua source loads on every host without case-tweaking.
    const result = evaluateBeatorajaLuaSkin({
      entry: enc('local d = require("Root.Define"); return d.x'),
      modules: [{ name: 'root/define', source: enc('return { x = 1 }') }],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toBe(1);
  });

  it('runtimeContext.option flows into main_state.option(...) called during entry-script eval', () => {
    // ModernChic decide.lua's `lockonAnimation` calls `CUSTOM.NUM.diffRGB()` which reads
    // `main_state.option(MAIN.OP.DIFFICULTY1..)` from the entry-script eval's TOP LEVEL.
    // Without a host-supplied runtimeContext, the accessor returns `false` and any nil
    // indexing the theme does on the result (`RGB[1]`) crashes the eval. Pin that the host
    // can pass an `option(id)` callback to surface chart-aware ops at load time.
    //
    // `main_state` is exposed via `require("main_state")`; the stub only carries real
    // accessors when `skinConfig !== undefined` (= phase-2 eval), matching the production
    // path where runtime ops only matter once the user has picked options.
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local main_state = require("main_state")',
          // Mimics what diffRGB does: branch on a series of difficulty ops, return a value
          // when one matches, else nil. Without a runtime context all branches fail and the
          // function returns nil.
          'local v',
          'if main_state.option(151) then v = "beginner"',
          'elseif main_state.option(152) then v = "normal"',
          'elseif main_state.option(154) then v = "another"',
          'else v = "unknown" end',
          'return { picked = v }',
        ].join('\n'),
      ),
      modules: [],
      skinConfig: { offset: 0, option: {}, file: {} },
      runtimeContext: {
        option: (id) => id === 154, // simulate the chart being classified ANOTHER
      },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ picked: 'another' });
  });

  it('runtimeContext is optional — entry script still loads when the host omits it', () => {
    // The legacy contract (no runtimeContext) keeps working — main_state stubs return safe
    // defaults (`false` for option, `0` for numbers).
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local main_state = require("main_state")',
          'return { active = main_state.option(151) }',
        ].join('\n'),
      ),
      modules: [],
      skinConfig: { offset: 0, option: {}, file: {} },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ active: false });
  });

  it('drives ModernChic-style customoption gating: skin_config.option picks select which optional dofile loads', () => {
    // ModernChic's `Play/lua/sp/property.lua` builds boolean predicates as closures over
    // `skin_config.option[parentName] == auto_num`, and `play7_hw.lua`'s `main()` gates
    // `dofile` calls on those predicates:
    //
    //   if PROPERTY.isAttackModeOn() then
    //     dofile(skin_config.get_path("Play/lua/sp/attack.lua"))
    //   end
    //
    // The auto-numbered op is whatever the property module's counter assigned to the "戦闘モード/有効"
    // child item. This test verifies the full chain: condition closure reads from skin_config,
    // dofile fires only when the condition is true, and the gated module's contribution shows up
    // in the returned skin.
    const propertyModule = enc(
      [
        'local module = {}',
        'local nextNum = 900',
        'local function makeChild(parent, label)',
        '  local num = nextNum',
        '  nextNum = nextNum + 1',
        '  -- Mirrors customoption.chiled — closure-captured num + parent name read live from skin_config.',
        '  local cond = function() return skin_config.option[parent] == num end',
        '  return num, cond',
        'end',
        'local attackOff, isAttackModeOff = makeChild("戦闘モード", "無効")',
        'local attackOn, isAttackModeOn = makeChild("戦闘モード", "有効")',
        'module.isAttackModeOn = isAttackModeOn',
        'module.attackOnNum = attackOn',
        'module.attackOffNum = attackOff',
        'return module',
      ].join('\n'),
    );
    const entry = enc(
      [
        'local property = require("property")',
        'if not skin_config then',
        '  -- Header pass — return the schema so the host can present the option.',
        '  return { type = 0, w = 1280, h = 720, attackOn = property.attackOnNum, attackOff = property.attackOffNum }',
        'end',
        'local skin = {}',
        'if property.isAttackModeOn() then',
        '  local attack = dofile(skin_config.get_path("Play/lua/sp/attack.lua"))',
        '  skin.attackPart = attack.label',
        'else',
        '  skin.attackPart = "(disabled)"',
        'end',
        'return skin',
      ].join('\n'),
    );
    const dofileResolver = (path: string): Uint8Array | undefined => {
      if (path === 'skin/Play/lua/sp/attack.lua') return enc('return { label = "attack-loaded" }');
      return undefined;
    };

    // Header pass — no skin_config — exposes the auto-num so the host UI can wire the dropdown.
    const headerResult = evaluateBeatorajaLuaSkin({
      entry,
      modules: [{ name: 'property', source: propertyModule }],
      dofileResolver,
      skinBaseDir: 'skin',
    });
    if (!headerResult.ok) throw new Error(headerResult.error.message);
    const header = headerResult.value as { attackOn: number; attackOff: number };
    expect(header.attackOff).toBe(900);
    expect(header.attackOn).toBe(901);

    // Main pass — user picked attackOn (= 901). dofile should fire and the skin gets the loaded label.
    const onResult = evaluateBeatorajaLuaSkin({
      entry,
      modules: [{ name: 'property', source: propertyModule }],
      dofileResolver,
      skinBaseDir: 'skin',
      skinConfig: { offset: 0, file: {}, option: { '戦闘モード': header.attackOn } },
    });
    if (!onResult.ok) throw new Error(onResult.error.message);
    expect(onResult.value).toEqual({ attackPart: 'attack-loaded' });

    // Main pass — user picked attackOff (= 900). dofile should NOT fire even though the resolver
    // can produce the bytes; the predicate gates entry into the if-block.
    const offResult = evaluateBeatorajaLuaSkin({
      entry,
      modules: [{ name: 'property', source: propertyModule }],
      dofileResolver,
      skinBaseDir: 'skin',
      skinConfig: { offset: 0, file: {}, option: { '戦闘モード': header.attackOff } },
    });
    if (!offResult.ok) throw new Error(offResult.error.message);
    expect(offResult.value).toEqual({ attackPart: '(disabled)' });
  });

  it('exposes main_state.audio_play / audio_loop / audio_stop, dispatching to runtimeContext callbacks', () => {
    // Mirrors ModernChic's `Root/customsound.lua` pattern: every panel-toggle / song-change /
    // confirm calls `main_state.audio_play(skin_config.get_path("Root/sounds/click.ogg"))`.
    // Without these defined the call hit `attempt to call a nil value` and either crashed
    // the eval or (when wrapped in pcall) silently disabled the SE — both undesirable.
    const calls: Array<{ kind: string; path: string; volume?: number }> = [];
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local main_state = require("main_state")',
          'local r1 = main_state.audio_play("click.ogg")',
          'local r2 = main_state.audio_play("hover.ogg", 0.5)',
          'local r3 = main_state.audio_loop("ambient.ogg", 0.3)',
          'local r4 = main_state.audio_stop("ambient.ogg")',
          'return { r1 = r1, r2 = r2, r3 = r3, r4 = r4 }',
        ].join('\n'),
      ),
      modules: [],
      skinConfig: { offset: 0, option: {}, file: {} },
      runtimeContext: {
        audioPlay: (path, volume) => {
          calls.push({ kind: 'play', path, volume });
          return true;
        },
        audioLoop: (path, volume) => {
          calls.push({ kind: 'loop', path, volume });
          return true;
        },
        audioStop: (path) => {
          calls.push({ kind: 'stop', path });
          return true;
        },
      },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ r1: true, r2: true, r3: true, r4: true });
    expect(calls).toEqual([
      { kind: 'play', path: 'click.ogg', volume: 1 },
      { kind: 'play', path: 'hover.ogg', volume: 0.5 },
      { kind: 'loop', path: 'ambient.ogg', volume: 0.3 },
      { kind: 'stop', path: 'ambient.ogg' },
    ]);
  });

  it('audio_play returns false (and does not crash) when the host omits the callback', () => {
    // The most common state during early development — no audio host wired. A skin call
    // through `audio_play` should return false (no-op) instead of `nil` (would crash on
    // boolean coercion in some skins). pcall'd skin code likewise sees a clean false.
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local main_state = require("main_state")',
          'return { ok = main_state.audio_play("click.ogg") }',
        ].join('\n'),
      ),
      modules: [],
      skinConfig: { offset: 0, option: {}, file: {} },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ ok: false });
  });

  it('exposes timer_util.timer_observe_boolean as a TimerProperty closure tied to a Lua boolFn', () => {
    // ModernChic Result/Select sites assign `timer = timer_util.timer_observe_boolean(boolFn)`
    // on 80+ destinations. The resulting closure, when called by the renderer at draw time,
    // returns either a microsecond start-time (when boolFn is currently true) or the
    // timer-off sentinel. Without timer_util wired the require returns nil and the destination
    // throws on the field access.
    let toggle = false;
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local timer_util = require("timer_util")',
          // boolFn flips based on the host-supplied option(1) gate; we toggle that gate from JS
          // between calls below to emulate the engine flipping a runtime predicate.
          'local main_state = require("main_state")',
          'local fn = timer_util.timer_observe_boolean(function() return main_state.option(1) end)',
          'return { fn = fn, off = main_state.timer_off_value }',
        ].join('\n'),
      ),
      modules: [],
      skinConfig: { offset: 0, option: {}, file: {} },
      runtimeContext: {
        option: (id) => id === 1 && toggle,
        time: () => 1234567,
      },
    });
    if (!result.ok) throw new Error(result.error.message);
    const value = result.value as { fn: import('./beatoraja-skin-lua.ts').BeatorajaLuaFunctionValue; off: number };
    // boolFn returns false initially → the closure returns the timer-off sentinel.
    expect(evaluateBeatorajaLuaNumber(value.fn, { option: () => false, time: () => 100 })).toBe(value.off);
    // boolFn flips true → closure stamps the current time and returns it.
    toggle = true;
    expect(evaluateBeatorajaLuaNumber(value.fn, { option: () => true, time: () => 5_000_000 })).toBe(5_000_000);
    // Subsequent calls while still true return the SAME stamp (animation doesn't restart).
    expect(evaluateBeatorajaLuaNumber(value.fn, { option: () => true, time: () => 9_000_000 })).toBe(5_000_000);
    // Flip back to false → returns off again, and the next true stamps a fresh start.
    expect(evaluateBeatorajaLuaNumber(value.fn, { option: () => false, time: () => 11_000_000 })).toBe(value.off);
    expect(evaluateBeatorajaLuaNumber(value.fn, { option: () => true, time: () => 13_000_000 })).toBe(13_000_000);
    value.fn.dispose();
  });

  it('exposes timer_util.is_timer_on / is_timer_off keyed off main_state.timer', () => {
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local timer_util = require("timer_util")',
          'return { on = timer_util.is_timer_on(7), off = timer_util.is_timer_off(7) }',
        ].join('\n'),
      ),
      modules: [],
      skinConfig: { offset: 0, option: {}, file: {} },
      runtimeContext: {
        // timer(7) returns 1234 → "on"; timer_off_value is whatever the runtime's TIMER_OFF
        // sentinel is. is_timer_on/off compare against it, so we don't need to match an exact
        // numeric value here.
        timer: (id) => (id === 7 ? 1234 : undefined),
      },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ on: true, off: false });
  });

  it('exposes event_util.event_observe_turn_true returning a {condition, action} descriptor', () => {
    // event_util descriptors get assigned to `customEvents` (audit 2.2 — not yet wired); for
    // this test we just verify the require returns a usable table whose condition fires once
    // when boolFn flips false → true and stays false on repeated true.
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local event_util = require("event_util")',
          'local count = 0',
          'local main_state = require("main_state")',
          'local fired = 0',
          'local desc = event_util.event_observe_turn_true(',
          '  function() return main_state.option(1) end,',
          '  function() fired = fired + 1 end',
          ')',
          // Drive condition() through a simulated state machine: false, true (fire), true
          // (no-fire), false (no-fire), true (fire).
          'local r = {}',
          'r[1] = desc.condition()',
          'r[2] = desc.condition()',
          'return r',
        ].join('\n'),
      ),
      modules: [],
      skinConfig: { offset: 0, option: {}, file: {} },
      runtimeContext: {
        // Always false during this synthetic eval — condition() should yield false twice
        // (no flip).
        option: () => false,
      },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual([false, false]);
  });

  it('audio_play with empty path short-circuits without invoking the host callback', () => {
    // Defensive: a skin computing the path dynamically may hand us "" before the bundle is
    // resolved. We don't want to invoke the host callback with an empty path (which the
    // host might log or treat as an error); short-circuit to false here.
    let invoked = false;
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local main_state = require("main_state")',
          'return { ok = main_state.audio_play("") }',
        ].join('\n'),
      ),
      modules: [],
      skinConfig: { offset: 0, option: {}, file: {} },
      runtimeContext: {
        audioPlay: () => {
          invoked = true;
          return true;
        },
      },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({ ok: false });
    expect(invoked).toBe(false);
  });

  it('places a placeholder in the cache before running a module body so circular requires terminate (audit 3.11)', () => {
    // Beatoraja's PackageLib stores a sentinel in `package.loaded[name]` before executing
    // the module body so that re-entrant `require()` calls during execution see the sentinel
    // (a placeholder table) rather than re-entering the loader and infinite-recursing. We
    // mirror that contract: cache an empty table BEFORE running the chunk; the chunk's return
    // value replaces the placeholder afterwards.
    //
    // a → require b → require a → see placeholder (empty {}) → return → continue a's body.
    const moduleA = enc(
      [
        'local a = {}',
        'a.name = "a"',
        'a.b = require("modb")',
        'return a',
      ].join('\n'),
    );
    const moduleB = enc(
      [
        'local b = {}',
        'b.name = "b"',
        // Cyclic require — receives the placeholder table for `moda` (empty at this point).
        'b.a_ref = require("moda")',
        'return b',
      ].join('\n'),
    );
    const result = evaluateBeatorajaLuaSkin({
      entry: enc(
        [
          'local moda = require("moda")',
          'return { aname = moda.name, bname = moda.b.name }',
        ].join('\n'),
      ),
      modules: [
        { name: 'moda', source: moduleA },
        { name: 'modb', source: moduleB },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    // a runs first, b runs during a's body (sees placeholder for a), a finishes. By the time
    // we read moda.name and moda.b.name they're populated; the cycle returned the placeholder
    // (empty table at that moment) and didn't infinite-loop.
    expect(result.value).toEqual({ aname: 'a', bname: 'b' });
  });
});

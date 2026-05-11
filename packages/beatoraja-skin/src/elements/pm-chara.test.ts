import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaPmCharas } from './pm-chara.ts';

describe('normalizeBeatorajaPmCharas', () => {
  it('preserves id / src / color / type / side from the default 9K skin', () => {
    // The reference 9K skin authors four pmchara destinations, two pairs (main + BG) for each
    // side. Verify all five fields round-trip without loss.
    const out = normalizeBeatorajaPmCharas([
      { id: 'dstPMchara1P', src: 'srcPMchara1P', color: 1, type: 0, side: 1 },
      { id: 'dstPMchara2P', src: 'srcPMchara2P', color: 1, type: 0, side: 2 },
      { id: 'dstPMchara1PBG', src: 'srcPMchara1P', color: 1, type: 1 },
    ]);
    expect(out).toEqual([
      { id: 'dstPMchara1P', src: 'srcPMchara1P', color: 1, type: 0, side: 1, ifCodes: [] },
      { id: 'dstPMchara2P', src: 'srcPMchara2P', color: 1, type: 0, side: 2, ifCodes: [] },
      // The third entry omits `side` — defaults to 1 (= 1P) per beatoraja's
      // `chara.side == 2 ? 2 : 1` normalization (audit 3.1).
      { id: 'dstPMchara1PBG', src: 'srcPMchara1P', color: 1, type: 1, side: 1, ifCodes: [] },
    ]);
  });

  it('rejects entries missing id or src (incomplete shapes drop silently)', () => {
    // Defensive against malformed Lua tables — a stray `{}` or partial author edit shouldn't
    // crash the parser, just be skipped. Matches `image[]` / `value[]` etc. behaviour.
    expect(normalizeBeatorajaPmCharas([{ src: 'a' }, { id: 'x' }, {}])).toEqual([]);
  });

  it("normalizes side via beatoraja's `chara.side == 2 ? 2 : 1` rule (audit 3.1)", () => {
    // Beatoraja's play loader treats side=2 specially and lumps everything else into 1P. Out-
    // of-range values, missing fields, and string typos all default to 1 — matching real
    // beatoraja, which never emits side=0 from its loader.
    expect(normalizeBeatorajaPmCharas([{ id: 'x', src: 's', side: 99 }])[0]?.side).toBe(1);
    expect(normalizeBeatorajaPmCharas([{ id: 'x', src: 's', side: 'foo' }])[0]?.side).toBe(1);
    expect(normalizeBeatorajaPmCharas([{ id: 'x', src: 's' }])[0]?.side).toBe(1);
    expect(normalizeBeatorajaPmCharas([{ id: 'x', src: 's', side: 2 }])[0]?.side).toBe(2);
  });

  it('defaults color to 1 when omitted (audit 3.1 — matches Java JsonSkin.PmChara)', () => {
    // Java's `JsonSkin.PmChara.color = 1` declaration plus the loader's `color == 2 ? 2 : 1`
    // clamp means any sparse pmchara entry without `color` should resolve to 1, not 0.
    expect(normalizeBeatorajaPmCharas([{ id: 'x', src: 's' }])[0]?.color).toBe(1);
  });

  it('returns an empty array when the input is missing or not an array', () => {
    expect(normalizeBeatorajaPmCharas(undefined)).toEqual([]);
    expect(normalizeBeatorajaPmCharas({})).toEqual([]);
  });
});

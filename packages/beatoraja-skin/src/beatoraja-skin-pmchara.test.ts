import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaPmCharas } from './beatoraja-skin-pmchara.ts';

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
      // The third entry omits `side` — defaults to 0 (= "any").
      { id: 'dstPMchara1PBG', src: 'srcPMchara1P', color: 1, type: 1, side: 0, ifCodes: [] },
    ]);
  });

  it('rejects entries missing id or src (incomplete shapes drop silently)', () => {
    // Defensive against malformed Lua tables — a stray `{}` or partial author edit shouldn't
    // crash the parser, just be skipped. Matches `image[]` / `value[]` etc. behaviour.
    expect(normalizeBeatorajaPmCharas([{ src: 'a' }, { id: 'x' }, {}])).toEqual([]);
  });

  it('clamps invalid side values to 0 (= "any")', () => {
    // Side is a constrained domain (0/1/2). Out-of-range values from a hand-edited skin file
    // collapse to the safe default rather than leaking as a numeric 99.
    expect(normalizeBeatorajaPmCharas([{ id: 'x', src: 's', side: 99 }])[0]?.side).toBe(0);
    expect(normalizeBeatorajaPmCharas([{ id: 'x', src: 's', side: 'foo' }])[0]?.side).toBe(0);
  });

  it('returns an empty array when the input is missing or not an array', () => {
    expect(normalizeBeatorajaPmCharas(undefined)).toEqual([]);
    expect(normalizeBeatorajaPmCharas({})).toEqual([]);
  });
});

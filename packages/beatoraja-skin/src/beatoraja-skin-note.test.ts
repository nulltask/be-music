import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaNote, pickBeatorajaNoteRects } from './beatoraja-skin-note.ts';

describe('normalizeBeatorajaNote', () => {
  it('returns an empty section for missing / non-object input', () => {
    const empty = normalizeBeatorajaNote(undefined);
    expect(empty.id).toBe('');
    expect(empty.note).toEqual([]);
    expect(empty.lnstart).toEqual([]);
    expect(empty.dst).toEqual([]);

    expect(normalizeBeatorajaNote(null).note).toEqual([]);
    expect(normalizeBeatorajaNote([]).note).toEqual([]);
    expect(normalizeBeatorajaNote('not-an-object').note).toEqual([]);
  });

  it('parses a flat dst[] as a single block with no if codes', () => {
    const section = normalizeBeatorajaNote({
      id: 'notes',
      note: ['n-1', 'n-2', 'n-3'],
      dst: [
        { x: 100, y: 0, w: 50, h: 600 },
        { x: 150, y: 0, w: 50, h: 600 },
        { x: 200, y: 0, w: 50, h: 600 },
      ],
    });
    expect(section.id).toBe('notes');
    expect(section.note).toEqual(['n-1', 'n-2', 'n-3']);
    expect(section.dst).toHaveLength(1);
    expect(section.dst[0]!.ifCodes).toEqual([]);
    expect(section.dst[0]!.rects).toHaveLength(3);
    expect(section.dst[0]!.rects[1]).toEqual({ x: 150, y: 0, w: 50, h: 600 });
  });

  it('parses gated dst[] groups with their if codes', () => {
    const section = normalizeBeatorajaNote({
      id: 'notes',
      dst: [
        {
          if: [920],
          values: [
            { x: 100, y: 0, w: 36, h: 580 },
            { x: 140, y: 0, w: 36, h: 580 },
          ],
        },
        {
          if: [922],
          values: [
            { x: 90, y: 0, w: 32, h: 580 },
            { x: 130, y: 0, w: 32, h: 580 },
          ],
        },
      ],
    });
    expect(section.dst).toHaveLength(2);
    expect(section.dst[0]!.ifCodes).toEqual([920]);
    expect(section.dst[1]!.ifCodes).toEqual([922]);
    expect(section.dst[0]!.rects[0]!.w).toBe(36);
    expect(section.dst[1]!.rects[0]!.w).toBe(32);
  });

  it('keeps lnstart / lnbody / lnend / mine arrays at their declared length', () => {
    const section = normalizeBeatorajaNote({
      lnstart: ['lns-1', 'lns-2'],
      lnbody: ['lnb-1', 'lnb-2', 'lnb-3'],
      lnend: ['lne-1'],
      mine: ['m-1', 'm-2', 'm-3', 'm-4'],
    });
    expect(section.lnstart).toEqual(['lns-1', 'lns-2']);
    expect(section.lnbody).toEqual(['lnb-1', 'lnb-2', 'lnb-3']);
    expect(section.lnend).toEqual(['lne-1']);
    expect(section.mine).toEqual(['m-1', 'm-2', 'm-3', 'm-4']);
  });

  it('coerces non-string entries into empty strings (lossy but stable)', () => {
    const section = normalizeBeatorajaNote({ note: ['ok', 7, null, 'fine'] });
    expect(section.note).toEqual(['ok', '', '', 'fine']);
  });

  it('substitutes 0 for missing / non-finite rect coordinates', () => {
    const section = normalizeBeatorajaNote({
      dst: [{ x: 100, y: Number.NaN, w: '50', h: 600 }],
    });
    expect(section.dst[0]!.rects[0]).toEqual({ x: 100, y: 0, w: 0, h: 600 });
  });

  it('parses expansionrate as the [xPct, yPct] pair (default 9K authors [115, 112])', () => {
    expect(normalizeBeatorajaNote({ expansionrate: [115, 112] }).expansionRate).toEqual({ x: 115, y: 112 });
  });

  it('falls back to [100, 100] when expansionrate is missing or malformed', () => {
    expect(normalizeBeatorajaNote({}).expansionRate).toEqual({ x: 100, y: 100 });
    expect(normalizeBeatorajaNote({ expansionrate: 'invalid' }).expansionRate).toEqual({ x: 100, y: 100 });
    expect(normalizeBeatorajaNote({ expansionrate: [Number.NaN, -50] }).expansionRate).toEqual({ x: 100, y: 1 });
  });

  it('mirrors a single-element expansionrate to both axes', () => {
    // Authors that want uniform scaling can write `[120]` instead of `[120, 120]`.
    expect(normalizeBeatorajaNote({ expansionrate: [120] }).expansionRate).toEqual({ x: 120, y: 120 });
  });
});

describe('pickBeatorajaNoteRects', () => {
  const section = normalizeBeatorajaNote({
    dst: [
      { if: [920], values: [{ x: 1, y: 0, w: 0, h: 0 }] },
      { if: [922], values: [{ x: 2, y: 0, w: 0, h: 0 }] },
      { if: [924], values: [{ x: 3, y: 0, w: 0, h: 0 }] },
    ],
  });

  it('returns the first block whose if codes are satisfied', () => {
    expect(pickBeatorajaNoteRects(section, new Set([920]))[0]!.x).toBe(1);
    expect(pickBeatorajaNoteRects(section, new Set([922]))[0]!.x).toBe(2);
    expect(pickBeatorajaNoteRects(section, new Set([924]))[0]!.x).toBe(3);
  });

  it('returns [] when no block matches (no fallback)', () => {
    expect(pickBeatorajaNoteRects(section, new Set([999]))).toEqual([]);
  });

  it('respects negation codes (negative if entry)', () => {
    const negated = normalizeBeatorajaNote({
      dst: [{ if: [-920], values: [{ x: 42, y: 0, w: 0, h: 0 }] }],
    });
    expect(pickBeatorajaNoteRects(negated, new Set())[0]!.x).toBe(42);
    expect(pickBeatorajaNoteRects(negated, new Set([920]))).toEqual([]);
  });

  it('treats an empty-if block as the default layout', () => {
    const flat = normalizeBeatorajaNote({
      dst: [{ x: 7, y: 0, w: 0, h: 0 }],
    });
    expect(pickBeatorajaNoteRects(flat, new Set())[0]!.x).toBe(7);
  });
});

describe('LN/HCN body mode flip (audit 1.10)', () => {
  it('legacy mode: lnBodyHeld = lnbody, lnBodyUnheld = lnactive', () => {
    // Legacy authoring (no `lnbodyActive`). Beatoraja's loader maps `lnbody` → "held" and
    // `lnactive` → "unheld" in this branch. ModernChic and GdbG_Skin both use this mode.
    const section = normalizeBeatorajaNote({
      lnbody: ['lnb-w', 'lnb-b', 'lnb-w', 'lnb-s'],
      lnactive: ['lna-w', 'lna-b', 'lna-w', 'lna-s'],
    });
    expect(section.lnBodyHeld).toEqual(['lnb-w', 'lnb-b', 'lnb-w', 'lnb-s']);
    expect(section.lnBodyUnheld).toEqual(['lna-w', 'lna-b', 'lna-w', 'lna-s']);
    // Raw fields stay accessible for debugging / migration tooling.
    expect(section.lnbody).toEqual(['lnb-w', 'lnb-b', 'lnb-w', 'lnb-s']);
    expect(section.lnactive).toEqual(['lna-w', 'lna-b', 'lna-w', 'lna-s']);
    expect(section.lnbodyActive).toEqual([]);
  });

  it('modern mode: lnBodyHeld = lnbodyActive, lnBodyUnheld = lnbody', () => {
    // Modern authoring (audit 1.10) — community 9K skins use this. Authoring `lnbodyActive`
    // flips the meaning of the raw fields: `lnbody` becomes the unheld sprite and
    // `lnbodyActive` is the actively-held one.
    const section = normalizeBeatorajaNote({
      lnbody: ['lnb-w', 'lnb-b'],
      lnbodyActive: ['lnA-w', 'lnA-b'],
      lnactive: ['lna-w', 'lna-b'], // Authored but ignored in modern mode (per Java loader).
    });
    expect(section.lnBodyHeld).toEqual(['lnA-w', 'lnA-b']);
    expect(section.lnBodyUnheld).toEqual(['lnb-w', 'lnb-b']);
  });

  it('legacy HCN: hcnBodyHeld = hcnbody, _Unheld = hcnactive, _Reactive = hcndamage, _Miss = hcnreactive', () => {
    // Legacy HCN naming is genuinely confusing: `hcnreactive` maps to lns[9] (the "missed"
    // slot) and `hcndamage` maps to lns[8] (the "recovered" slot). Modern mode renamed for
    // clarity. The mode-flip resolution presents stable per-state slots regardless.
    const section = normalizeBeatorajaNote({
      hcnbody: ['hcb-1', 'hcb-2'],
      hcnactive: ['hca-1', 'hca-2'],
      hcndamage: ['hcd-1', 'hcd-2'],
      hcnreactive: ['hcr-1', 'hcr-2'],
    });
    expect(section.hcnBodyHeld).toEqual(['hcb-1', 'hcb-2']);
    expect(section.hcnBodyUnheld).toEqual(['hca-1', 'hca-2']);
    expect(section.hcnBodyReactive).toEqual(['hcd-1', 'hcd-2']);
    expect(section.hcnBodyMiss).toEqual(['hcr-1', 'hcr-2']);
  });

  it('modern HCN: per-state slots come from the *Active / *Miss / *Reactive fields', () => {
    const section = normalizeBeatorajaNote({
      hcnbody: ['unheld'],
      hcnbodyActive: ['held'],
      hcnbodyReactive: ['recovered'],
      hcnbodyMiss: ['missed'],
    });
    expect(section.hcnBodyHeld).toEqual(['held']);
    expect(section.hcnBodyUnheld).toEqual(['unheld']);
    expect(section.hcnBodyReactive).toEqual(['recovered']);
    expect(section.hcnBodyMiss).toEqual(['missed']);
  });

  it('partial modern authoring: lnbodyActive present without lnbody falls through cleanly', () => {
    // A skin that authors only `lnbodyActive` (and leaves `lnbody` unset) gets a well-formed
    // section — `lnBodyUnheld` resolves to the empty `lnbody` array, which the renderer
    // handles by falling back to its colored-rect placeholder for the unheld state.
    const section = normalizeBeatorajaNote({ lnbodyActive: ['held'] });
    expect(section.lnBodyHeld).toEqual(['held']);
    expect(section.lnBodyUnheld).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaTimingVisualizers } from './beatoraja-skin-timingvisualizer.ts';

describe('normalizeBeatorajaTimingVisualizers', () => {
  it('keeps id and falls back to JsonSkin.java upstream defaults (reference-theme shape)', () => {
    // Defaults mirror `JsonSkin.java:297-311` (`TimingVisualizer`):
    //   width = 301, judgeWidthMillis = 150, lineWidth = 1, transparent = 0, drawDecay = 1.
    // The reference theme authors only `{id = "timing"}` and relies on these.
    expect(normalizeBeatorajaTimingVisualizers([{ id: 'timing' }])).toEqual([
      {
        id: 'timing',
        width: 301,
        judgeWidthMillis: 150,
        lineWidth: 1,
        transparent: 0,
        drawDecay: 1,
        lineColor: '',
        centerColor: '',
        pgColor: '',
        grColor: '',
        gdColor: '',
        bdColor: '',
        prColor: '',
        ifCodes: [],
      },
    ]);
  });

  it('parses authored numeric / color fields verbatim', () => {
    const out = normalizeBeatorajaTimingVisualizers([
      {
        id: 'tv',
        width: 401,
        judgeWidthMillis: 100,
        lineWidth: 2,
        transparent: 192,
        drawDecay: 8,
        lineColor: 'ffffff',
        centerColor: '00ff00',
        PGColor: 'ffff00',
        GRColor: '00ffff',
        GDColor: '0000ff',
        BDColor: 'ff00ff',
        PRColor: 'ff0000',
      },
    ]);
    expect(out[0]).toMatchObject({
      width: 401,
      judgeWidthMillis: 100,
      lineWidth: 2,
      transparent: 192,
      drawDecay: 8,
      lineColor: 'ffffff',
      centerColor: '00ff00',
      pgColor: 'ffff00',
      grColor: '00ffff',
      gdColor: '0000ff',
      bdColor: 'ff00ff',
      prColor: 'ff0000',
    });
  });

  it('width drives the px/ms rate independently of dst.w (audit A-11)', () => {
    // Upstream `SkinTimingVisualizer.java:63`:
    //   judgeWidthRate = width / (judgeWidthMillis * 2 + 1)
    // The `width` field is INDEPENDENT of the destination's runtime `region.width`. A
    // `width = 401, judgeWidthMillis = 200` element gives 401/401 = 1 px/ms regardless of
    // what the dst rect's width animates to.
    const out = normalizeBeatorajaTimingVisualizers([{ id: 'tv', width: 401, judgeWidthMillis: 200 }]);
    expect(out[0]?.width).toBe(401);
    expect(out[0]?.judgeWidthMillis).toBe(200);
  });

  it('honors lowercase color keys (LR2-style author convention)', () => {
    const out = normalizeBeatorajaTimingVisualizers([{ id: 'tv', pgColor: 'aabbcc' }]);
    expect(out[0]?.pgColor).toBe('aabbcc');
  });

  it('drops entries without an id', () => {
    expect(normalizeBeatorajaTimingVisualizers([{ judgeWidthMillis: 100 }, { id: 'ok' }])).toHaveLength(1);
  });

  it('returns an empty array on missing / malformed input', () => {
    expect(normalizeBeatorajaTimingVisualizers(undefined)).toEqual([]);
    expect(normalizeBeatorajaTimingVisualizers(null)).toEqual([]);
    expect(normalizeBeatorajaTimingVisualizers('nope')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaTimingVisualizers } from './beatoraja-skin-timingvisualizer.ts';

describe('normalizeBeatorajaTimingVisualizers', () => {
  it('keeps id and lets every other field default to 0 / empty (reference-theme shape)', () => {
    expect(normalizeBeatorajaTimingVisualizers([{ id: 'timing' }])).toEqual([
      {
        id: 'timing',
        judgeWidthMillis: 0,
        lineWidth: 0,
        transparent: 0,
        drawDecay: 0,
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

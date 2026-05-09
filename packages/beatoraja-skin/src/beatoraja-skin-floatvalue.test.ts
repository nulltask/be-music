import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaFloatValues } from './beatoraja-skin-floatvalue.ts';

describe('normalizeBeatorajaFloatValues', () => {
  it('parses iketa / fketa / gain / isSignvisible from a representative authoring', () => {
    // Mirrors a typical Result-screen accuracy display: two integer digits + two fractional
    // digits, scaling the underlying op by 0.01, with sign visibility off (`+98.76 %` would
    // render as `98.76` here unless isSignvisible flips on).
    const out = normalizeBeatorajaFloatValues([
      {
        id: 'accuracy',
        src: 4,
        x: 0,
        y: 0,
        w: 240,
        h: 24,
        divx: 11,
        digit: 4,
        iketa: 2,
        fketa: 2,
        gain: 0.01,
        isSignvisible: true,
        ref: 100,
      },
    ]);
    expect(out[0]).toMatchObject({
      id: 'accuracy',
      src: 4,
      iketa: 2,
      fketa: 2,
      gain: 0.01,
      isSignvisible: true,
      ref: 100,
    });
  });

  it('falls back to gain=1 / isSignvisible=false when omitted', () => {
    const out = normalizeBeatorajaFloatValues([{ id: 'bpm', src: 4 }]);
    expect(out[0]).toMatchObject({ gain: 1, isSignvisible: false, iketa: 0, fketa: 0 });
  });

  it('drops entries without a usable id', () => {
    expect(normalizeBeatorajaFloatValues([{ src: 4 }, {}])).toEqual([]);
  });

  it('preserves zeropadding / padding / space / align fields shared with value[]', () => {
    const out = normalizeBeatorajaFloatValues([
      { id: 'x', src: 4, padding: 1, zeropadding: 1, space: 2, align: 1 },
    ]);
    expect(out[0]).toMatchObject({ padding: 1, zeropadding: 1, space: 2, align: 1 });
  });

  it('respects flat-vs-conditional flattening like other element parsers', () => {
    const out = normalizeBeatorajaFloatValues([
      { if: [920], values: [{ id: 'gated', src: 4 }] },
    ]);
    expect(out[0]).toMatchObject({ id: 'gated', ifCodes: [920] });
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaImagesets } from './beatoraja-skin-imageset.ts';

describe('normalizeBeatorajaImagesets', () => {
  it('parses minimal imageset (id + ref + images)', () => {
    const out = normalizeBeatorajaImagesets([
      { id: 'modeset', ref: 11, images: ['allkeys', '5keys', '7keys'] },
    ]);
    expect(out).toEqual([
      {
        id: 'modeset',
        ref: 11,
        images: ['allkeys', '5keys', '7keys'],
        act: 0,
        click: 0,
        ifCodes: [],
      },
    ]);
  });

  it('parses act / click click-event fields (audit 2.5)', () => {
    // default `select.json:152` authors `modeset` with `act:11` (KEYS_FILTER cycle). Without
    // the parser surfacing `act` and `click`, the renderer never makes the imageset interactive
    // — clicks dropped at the data layer.
    const out = normalizeBeatorajaImagesets([
      { id: 'modeset', ref: 11, images: ['a', 'b'], act: 11, click: 1 },
    ]);
    expect(out[0]?.act).toBe(11);
    expect(out[0]?.click).toBe(1);
  });

  it('drops imagesets with empty or missing images array', () => {
    expect(normalizeBeatorajaImagesets([{ id: 'empty', ref: 0 }])).toEqual([]);
    expect(normalizeBeatorajaImagesets([{ id: 'empty', ref: 0, images: [] }])).toEqual([]);
  });

  it('drops imagesets with missing id', () => {
    expect(normalizeBeatorajaImagesets([{ ref: 0, images: ['a'] }])).toEqual([]);
  });

  it('coerces non-string / non-number image entries away (defensive)', () => {
    const out = normalizeBeatorajaImagesets([
      { id: 'mix', ref: 0, images: ['valid', null, 42, true, 'also-valid'] },
    ]);
    // null and `true` get dropped; 42 stays (numeric ids are valid for image refs).
    expect(out[0]?.images).toEqual(['valid', 42, 'also-valid']);
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaFonts, normalizeBeatorajaTexts } from './text.ts';

describe('normalizeBeatorajaTexts', () => {
  it('fills in default font / size / ref / align when omitted', () => {
    const out = normalizeBeatorajaTexts([{ id: 'genre' }]);
    expect(out).toEqual([
      {
        id: 'genre',
        fontId: 0,
        size: 24,
        ref: 0,
        align: 'left',
        overflow: 0,
        outlineColor: { rgb: 0xffffff, alpha: 0 },
        outlineWidth: 0,
        shadowColor: { rgb: 0xffffff, alpha: 0 },
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        shadowSmoothness: 0,
        wrapping: false,
        ifCodes: [],
      },
    ]);
  });

  it('parses outlineColor / shadowColor as RRGGBBAA hex strings (audit 2.10)', () => {
    // ModernChic Decide authors `outlineColor = "165423ff"` (beginner green) on every
    // tablename / genre / title / artist label. The 8-char hex carries an alpha byte that
    // the renderer uses to decide whether to apply the stroke at all (alpha=0 = "off").
    const out = normalizeBeatorajaTexts([
      {
        id: 'title',
        outlineColor: '165423ff',
        outlineWidth: 1,
        shadowColor: '00000080',
        shadowOffsetX: 2,
        shadowOffsetY: 3,
        shadowSmoothness: 1.5,
        wrapping: true,
      },
    ]);
    expect(out[0]?.outlineColor).toEqual({ rgb: 0x165423, alpha: 1 });
    expect(out[0]?.outlineWidth).toBe(1);
    expect(out[0]?.shadowColor).toEqual({ rgb: 0x000000, alpha: 128 / 255 });
    expect(out[0]?.shadowOffsetX).toBe(2);
    expect(out[0]?.shadowOffsetY).toBe(3);
    expect(out[0]?.shadowSmoothness).toBe(1.5);
    expect(out[0]?.wrapping).toBe(true);
  });

  it('tolerates 6-char RRGGBB color (alpha defaults to 1.0)', () => {
    const out = normalizeBeatorajaTexts([{ id: 'a', outlineColor: 'ff0000' }]);
    expect(out[0]?.outlineColor).toEqual({ rgb: 0xff0000, alpha: 1 });
  });

  it('falls back to defaults for malformed color strings', () => {
    const out = normalizeBeatorajaTexts([{ id: 'a', outlineColor: 'not-a-color' }]);
    expect(out[0]?.outlineColor).toEqual({ rgb: 0xffffff, alpha: 0 });
  });

  it('preserves authored numeric and string fields verbatim', () => {
    const out = normalizeBeatorajaTexts([{ id: 'title', font: 1, size: 30, ref: 12, align: 'center' }]);
    expect(out[0]).toMatchObject({ id: 'title', fontId: 1, size: 30, ref: 12, align: 'center' });
  });

  it('preserves symbolic string font ids', () => {
    const out = normalizeBeatorajaTexts([{ id: 'title', font: 'title_font', size: 30 }]);
    expect(out[0]?.fontId).toBe('title_font');
  });

  it('coerces numeric align codes (0=left, 1=center, 2=right)', () => {
    expect(normalizeBeatorajaTexts([{ id: 'a', align: 0 }])[0].align).toBe('left');
    expect(normalizeBeatorajaTexts([{ id: 'b', align: 1 }])[0].align).toBe('center');
    expect(normalizeBeatorajaTexts([{ id: 'c', align: 2 }])[0].align).toBe('right');
  });

  it('rejects unknown align strings and defaults to `left`', () => {
    expect(normalizeBeatorajaTexts([{ id: 'a', align: 'justify' }])[0].align).toBe('left');
  });

  it('flattens conditional `if`/`values` blocks and attaches ifCodes', () => {
    const out = normalizeBeatorajaTexts([{ if: [920], values: [{ id: 'genre', font: 0, size: 24, ref: 13 }] }]);
    expect(out[0]).toMatchObject({ id: 'genre', ifCodes: [920] });
  });

  it('drops entries without a usable id', () => {
    expect(normalizeBeatorajaTexts([{ font: 0, size: 24 }])).toEqual([]);
  });
});

describe('normalizeBeatorajaFonts', () => {
  it('returns the bundled font list with id + path preserved', () => {
    const out = normalizeBeatorajaFonts([{ id: 0, path: 'VL-Gothic-Regular.ttf' }]);
    expect(out).toEqual([{ id: 0, path: 'VL-Gothic-Regular.ttf' }]);
  });

  it('keeps symbolic string ids and skips invalid ids or empty paths', () => {
    expect(
      normalizeBeatorajaFonts([
        { id: 'title_font', path: 'a.ttf' },
        { id: '', path: 'empty.ttf' },
        { id: 1, path: '' },
        { id: 2, path: 'b.ttf' },
      ]),
    ).toEqual([
      { id: 'title_font', path: 'a.ttf' },
      { id: 2, path: 'b.ttf' },
    ]);
  });

  it('returns an empty array when the input is missing or not an array', () => {
    expect(normalizeBeatorajaFonts(undefined)).toEqual([]);
    expect(normalizeBeatorajaFonts({})).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { parseBeatorajaSongList } from './beatoraja-skin-songlist.ts';
import type { BeatorajaSkin } from './beatoraja-skin-types.ts';

function makeSkin(overrides: Partial<BeatorajaSkin> & { songlist?: unknown } = {}): BeatorajaSkin {
  return { type: 5, w: 1280, h: 720, ...overrides } as BeatorajaSkin;
}

describe('parseBeatorajaSongList', () => {
  it('returns undefined when the skin omits the songlist block', () => {
    expect(parseBeatorajaSongList(makeSkin())).toBeUndefined();
  });

  it('reads liston[].dst[0] as the per-row rect (default reference theme shape)', () => {
    // Default beatoraja `select.json` authors 21 rows at x=800, h=36, y stepping by -36
    // (skin Y-UP). Pick a 3-row subset to exercise the parser without listing all 21.
    const skin = makeSkin({
      songlist: {
        id: 'songlist',
        liston: [
          { id: 'bar', dst: [{ x: 800, y: 720, w: 500, h: 36 }] },
          { id: 'bar', dst: [{ x: 800, y: 360, w: 500, h: 36 }] },
          { id: 'bar', dst: [{ x: 800, y: 0, w: 500, h: 36 }] },
        ],
      },
    } as unknown as Partial<BeatorajaSkin>);
    const layout = parseBeatorajaSongList(skin);
    expect(layout?.rows).toHaveLength(3);
    expect(layout?.rows[0]).toEqual({ x: 800, y: 720, w: 500, h: 36 });
    expect(layout?.rows[2]).toEqual({ x: 800, y: 0, w: 500, h: 36 });
  });

  it('picks the row whose Pixi-y centre is closest to canvas vertical centre as focused', () => {
    // 720-tall canvas (skin.h). Rows below in skin-Y-UP order:
    //   row0: y=600, h=36 → Pixi centre y = 720 - 600 - 18 = 102
    //   row1: y=360, h=36 → Pixi centre y = 720 - 360 - 18 = 342
    //   row2: y=120, h=36 → Pixi centre y = 720 - 120 - 18 = 582
    // Canvas centre = 360. Closest is row1 (342, distance 18).
    const skin = makeSkin({
      songlist: {
        liston: [
          { id: 'bar', dst: [{ x: 0, y: 600, w: 500, h: 36 }] },
          { id: 'bar', dst: [{ x: 0, y: 360, w: 500, h: 36 }] },
          { id: 'bar', dst: [{ x: 0, y: 120, w: 500, h: 36 }] },
        ],
      },
    } as unknown as Partial<BeatorajaSkin>);
    const layout = parseBeatorajaSongList(skin);
    expect(layout?.focusedRowIndex).toBe(1);
  });

  it('falls back to listoff[] when liston[] is missing', () => {
    const skin = makeSkin({
      songlist: {
        listoff: [{ id: 'bar', dst: [{ x: 100, y: 200, w: 500, h: 50 }] }],
      },
    } as unknown as Partial<BeatorajaSkin>);
    const layout = parseBeatorajaSongList(skin);
    expect(layout?.rows).toHaveLength(1);
    expect(layout?.rows[0]).toEqual({ x: 100, y: 200, w: 500, h: 50 });
  });

  it('skips entries with non-positive width / height', () => {
    const skin = makeSkin({
      songlist: {
        liston: [
          { id: 'bar', dst: [{ x: 0, y: 0, w: 0, h: 36 }] },
          { id: 'bar', dst: [{ x: 0, y: 100, w: 500, h: 36 }] },
          { id: 'bar', dst: [{ x: 0, y: 200, w: 500, h: 0 }] },
        ],
      },
    } as unknown as Partial<BeatorajaSkin>);
    const layout = parseBeatorajaSongList(skin);
    expect(layout?.rows).toHaveLength(1);
  });

  it('handles arched / diagonal layouts where x varies per row (ModernChic shape)', () => {
    // ModernChic's "arch" pattern keeps the focused row at a smaller x and pushes other rows
    // outward. The parser preserves the per-row x so the rendered layout follows the arc.
    const skin = makeSkin({
      h: 1080,
      songlist: {
        liston: [
          { id: 'bar', dst: [{ x: 1288, y: 1065, w: 960, h: 70 }] }, // top-left arch
          { id: 'bar', dst: [{ x: 1125, y: 505, w: 960, h: 70 }] }, // mid (tightest x)
          { id: 'bar', dst: [{ x: 1288, y: -55, w: 960, h: 70 }] }, // bottom-left arch
        ],
      },
    } as unknown as Partial<BeatorajaSkin>);
    const layout = parseBeatorajaSongList(skin);
    expect(layout?.rows).toHaveLength(3);
    expect(layout?.rows[0]?.x).toBe(1288);
    expect(layout?.rows[1]?.x).toBe(1125);
    expect(layout?.rows[2]?.x).toBe(1288);
    // Pixi y centres: row0 = 1080-1065-35=-20, row1 = 1080-505-35=540, row2 = 1080-(-55)-35=1100.
    // Canvas centre = 540. Row1 is exactly there → focused.
    expect(layout?.focusedRowIndex).toBe(1);
  });
});

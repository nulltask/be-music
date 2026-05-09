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
    expect(layout?.rows[0]).toEqual({ id: 'bar', x: 800, y: 720, w: 500, h: 36 });
    expect(layout?.rows[2]).toEqual({ id: 'bar', x: 800, y: 0, w: 500, h: 36 });
  });

  it('captures `liston[i].id` per row so renderers can crop the bar texture', () => {
    // Many beatoraja skins author the focused row with a different id (e.g. `list_on`)
    // while other rows use the generic `list` id. Retaining the per-row id lets the
    // renderer pick the right `image[]` crop without extra focused-row branching.
    const skin = makeSkin({
      songlist: {
        liston: [
          { id: 'list', dst: [{ x: 800, y: 720, w: 500, h: 36 }] },
          { id: 'list_on', dst: [{ x: 800, y: 360, w: 500, h: 36 }] },
          { id: 'list', dst: [{ x: 800, y: 0, w: 500, h: 36 }] },
        ],
      },
    } as unknown as Partial<BeatorajaSkin>);
    const layout = parseBeatorajaSongList(skin);
    expect(layout?.rows.map((r) => r.id)).toEqual(['list', 'list_on', 'list']);
  });

  it('omits `id` when the entry has no `id` field', () => {
    const skin = makeSkin({
      songlist: {
        liston: [{ dst: [{ x: 0, y: 0, w: 500, h: 36 }] }],
      },
    } as unknown as Partial<BeatorajaSkin>);
    const layout = parseBeatorajaSongList(skin);
    expect(layout?.rows[0]?.id).toBeUndefined();
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
    expect(layout?.rows[0]).toEqual({ id: 'bar', x: 100, y: 200, w: 500, h: 50 });
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

  it('extracts level sub-destination rect (relative to per-row bar rect)', () => {
    // Reference theme `select.json` authors `songlist.level[]` with one entry per chart
    // difficulty (1..14) but identical geometry. The parser picks the first entry's
    // `dst[0]` rect — most skins author every difficulty with the same `(x, y, w, h)` and
    // only vary the color tint, so the FIRST captures the canonical layout.
    const skin = makeSkin({
      songlist: {
        liston: [{ id: 'bar', dst: [{ x: 800, y: 360, w: 500, h: 36 }] }],
        level: [
          { id: 'playlevel_bar', dst: [{ x: 20, y: 8, w: 24, h: 24 }] },
          { id: 'playlevel_bar', dst: [{ x: 20, y: 8, w: 24, h: 24, r: 0, b: 0 }] },
        ],
      },
    } as unknown as Partial<BeatorajaSkin>);
    const layout = parseBeatorajaSongList(skin);
    expect(layout?.level).toEqual({ id: 'playlevel_bar', x: 20, y: 8, w: 24, h: 24 });
  });

  it('returns level as undefined / labels + text as empty when the songlist omits them', () => {
    const skin = makeSkin({
      songlist: {
        liston: [{ id: 'bar', dst: [{ x: 0, y: 0, w: 100, h: 30 }] }],
      },
    } as unknown as Partial<BeatorajaSkin>);
    const layout = parseBeatorajaSongList(skin);
    expect(layout?.level).toBeUndefined();
    expect(layout?.labels).toEqual([]);
    expect(layout?.text).toEqual([]);
  });

  it('extracts `songlist.text[]` entries verbatim so renderers can size text from `dst.h`', () => {
    // Default beatoraja `select.json` authors `bartext` per-bar at `{x:80, y:6, w:18, h:24}`
    // — `dst.h:24` IS the rendered glyph height (matches `font.setScale(region.h / size)`
    // upstream). The renderer needs the rect to position the text and size the font.
    const skin = makeSkin({
      songlist: {
        liston: [{ id: 'bar', dst: [{ x: 0, y: 0, w: 500, h: 36 }] }],
        text: [{ id: 'bartext', dst: [{ x: 80, y: 6, w: 400, h: 24 }] }],
      },
    } as unknown as Partial<BeatorajaSkin>);
    const layout = parseBeatorajaSongList(skin);
    expect(layout?.text).toEqual([{ id: 'bartext', rect: { x: 80, y: 6, w: 400, h: 24 } }]);
  });

  it('de-dupes `songlist.text[]` by id (default skin authors `bartext` twice with filter variants)', () => {
    // Real default `select.json` authors `bartext` twice — same `dst.h` but different colors
    // gated on `filter`. Without a filter engine we'd paint the text twice on top of itself;
    // keeping the first occurrence per id approximates the focused-row rendering.
    const skin = makeSkin({
      songlist: {
        liston: [{ id: 'bar', dst: [{ x: 0, y: 0, w: 500, h: 36 }] }],
        text: [
          { id: 'bartext', filter: 1, dst: [{ x: 80, y: 6, w: 18, h: 24 }] },
          { id: 'bartext', filter: 1, dst: [{ x: 80, y: 6, w: 18, h: 24, b: 0 }] },
        ],
      },
    } as unknown as Partial<BeatorajaSkin>);
    const layout = parseBeatorajaSongList(skin);
    expect(layout?.text).toHaveLength(1);
    expect(layout?.text[0]?.id).toBe('bartext');
  });

  it('extracts every entry of `songlist.label[]` as `{id, rect}` for per-feature gating', () => {
    // Default beatoraja's `select.json` authors three feature-gated label entries
    // (LN / random / mine). Each maps to a `skin.image[]` entry by id and gets a
    // rect RELATIVE to the bar — the renderer iterates them and shows each label
    // sprite when the focused chart has the matching feature.
    const skin = makeSkin({
      songlist: {
        liston: [{ id: 'bar', dst: [{ x: 0, y: 0, w: 500, h: 36 }] }],
        label: [
          { id: 'label-ln', dst: [{ x: -20, y: 5, w: 16, h: 30 }] },
          { id: 'label-random', dst: [{ x: -40, y: 5, w: 16, h: 30 }] },
          { id: 'label-mine', dst: [{ x: -60, y: 5, w: 16, h: 30 }] },
        ],
      },
    } as unknown as Partial<BeatorajaSkin>);
    const layout = parseBeatorajaSongList(skin);
    expect(layout?.labels).toEqual([
      { id: 'label-ln', rect: { x: -20, y: 5, w: 16, h: 30 } },
      { id: 'label-random', rect: { x: -40, y: 5, w: 16, h: 30 } },
      { id: 'label-mine', rect: { x: -60, y: 5, w: 16, h: 30 } },
    ]);
  });
});

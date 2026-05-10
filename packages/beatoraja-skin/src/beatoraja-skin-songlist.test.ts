import { describe, expect, it } from 'vitest';
import { BEATORAJA_SONGLIST_BAR_COUNT, parseBeatorajaSongList } from './beatoraja-skin-songlist.ts';
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

  it('accepts numeric `liston[i].id` (image[].id is `string | number`)', () => {
    // `image[].id` is typed `BeatorajaImageId = number | string`. Lua-driven skins
    // (ModernChic's bar variants) sometimes emit numeric ids when the authoring loop
    // assigns them programmatically. Previously the parser only accepted strings, so
    // numeric forms silently dropped — leaving rows with no bar background even when
    // the matching `image[]` entry was authored.
    const skin = makeSkin({
      songlist: {
        liston: [
          { id: 100, dst: [{ x: 800, y: 720, w: 500, h: 36 }] },
          { id: 101, dst: [{ x: 800, y: 360, w: 500, h: 36 }] },
        ],
      },
    } as unknown as Partial<BeatorajaSkin>);
    const layout = parseBeatorajaSongList(skin);
    expect(layout?.rows.map((r) => r.id)).toEqual([100, 101]);
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

  it('honors `songlist.center` verbatim when authored (audit A-8)', () => {
    // Mirrors `JsonSelectSkinObjectLoader.java:79` — `setCenterBar(sk.songlist.center)`.
    // The author's intent for which row should look "focused" wins over the geometric
    // heuristic that's used as the fallback. Test setup: 3 rows with the geometric centre
    // landing on row 1 (closest to canvas-vertical-centre), but author says `center: 2`.
    // The parser must return 2.
    const skin = makeSkin({
      songlist: {
        center: 2,
        liston: [
          { id: 'bar', dst: [{ x: 0, y: 600, w: 500, h: 36 }] },
          { id: 'bar', dst: [{ x: 0, y: 360, w: 500, h: 36 }] }, // closest to centre by geometry
          { id: 'bar', dst: [{ x: 0, y: 120, w: 500, h: 36 }] },
        ],
      },
    } as unknown as Partial<BeatorajaSkin>);
    expect(parseBeatorajaSongList(skin)?.focusedRowIndex).toBe(2);
  });

  it('falls back to the geometric heuristic when `songlist.center` is omitted', () => {
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
    expect(layout?.levelEntries).toEqual([]);
    expect(layout?.labels).toEqual([]);
    expect(layout?.text).toEqual([]);
  });

  it('extracts every `songlist.level[]` entry into levelEntries so the renderer can pick per-difficulty', () => {
    // ModernChic authors six entries (`level-unknown / -beginner / -normal / -hyper /
    // -another / -insane`), each pointing at a different `value[]` declaration that crops a
    // colour-coded row from `songbar.png`. The renderer keys on the entry's id suffix to
    // pick the matching value at draw time. The parser keeps every entry verbatim so the
    // ordering / color information survives.
    const skin = makeSkin({
      songlist: {
        liston: [{ id: 'bar', dst: [{ x: 0, y: 0, w: 960, h: 70 }] }],
        level: [
          { id: 'level-unknown', dst: [{ x: 30, y: 13, w: 35, h: 42 }] },
          { id: 'level-beginner', dst: [{ x: 30, y: 13, w: 35, h: 42 }] },
          { id: 'level-normal', dst: [{ x: 30, y: 13, w: 35, h: 42 }] },
          { id: 'level-hyper', dst: [{ x: 30, y: 13, w: 35, h: 42 }] },
          { id: 'level-another', dst: [{ x: 30, y: 13, w: 35, h: 42 }] },
          { id: 'level-insane', dst: [{ x: 30, y: 13, w: 35, h: 42 }] },
        ],
      },
    } as unknown as Partial<BeatorajaSkin>);
    const layout = parseBeatorajaSongList(skin);
    expect(layout?.levelEntries.map((entry) => entry.id)).toEqual([
      'level-unknown',
      'level-beginner',
      'level-normal',
      'level-hyper',
      'level-another',
      'level-insane',
    ]);
    // The singular `level` rect is still populated for backwards compat — falls back to the
    // first entry's geometry, which all six entries share in the ModernChic authoring.
    expect(layout?.level).toEqual({ id: 'level-unknown', x: 30, y: 13, w: 35, h: 42 });
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

  describe('audit A-7 — imageset[] chain resolution for liston[].id', () => {
    // Mirrors `JsonSelectSkinObjectLoader.java:44-77`: `liston[i].id` references an
    // `imageset[]` entry, NOT `image[]` directly. The renderer needs the underlying
    // `image[].id` (= `imageset[id].images[0]`) for its bar-texture lookup. The parser
    // resolves the chain at parse time, replacing the row's `id` with the resolved value.

    it('resolves liston[].id through `imageset[id].images[0]` to the underlying image[].id', () => {
      const skin = makeSkin({
        imageset: [{ id: 'bar', images: ['bar-img'] }],
        songlist: {
          liston: [{ id: 'bar', dst: [{ x: 800, y: 360, w: 500, h: 36 }] }],
        },
      } as unknown as Partial<BeatorajaSkin>);
      const layout = parseBeatorajaSongList(skin);
      // Row id should be the resolved underlying image[].id, not the original imageset id.
      expect(layout?.rows[0]?.id).toBe('bar-img');
    });

    it('uses imageset.images[0] only — additional frames are ignored at parse time', () => {
      // Upstream `SkinImage(images[][], timer, cycle, ref=null)` always picks `image[0]`
      // at draw time since `ref == null` short-circuits to value=0. We anchor that
      // behavior at parse time by resolving to images[0].
      const skin = makeSkin({
        imageset: [{ id: 'bar', images: ['bar-frame-a', 'bar-frame-b', 'bar-frame-c'] }],
        songlist: {
          liston: [{ id: 'bar', dst: [{ x: 0, y: 0, w: 500, h: 36 }] }],
        },
      } as unknown as Partial<BeatorajaSkin>);
      const layout = parseBeatorajaSongList(skin);
      expect(layout?.rows[0]?.id).toBe('bar-frame-a');
    });

    it('keeps the original id when no imageset matches (back-compat for image[]-only skins)', () => {
      // Skins authoring bars as `image[]` directly (legacy / test fixtures / hand-rolled
      // simplified skins) skip the imageset wrapper. The resolver leaves the id as-is
      // so the renderer's direct `image[]` lookup still succeeds.
      const skin = makeSkin({
        // No imageset[] authored.
        songlist: {
          liston: [{ id: 'bar', dst: [{ x: 0, y: 0, w: 500, h: 36 }] }],
        },
      } as unknown as Partial<BeatorajaSkin>);
      const layout = parseBeatorajaSongList(skin);
      expect(layout?.rows[0]?.id).toBe('bar');
    });

    it('resolves per-row when liston[] uses different imageset ids (e.g. focused vs unfocused)', () => {
      // Common authoring: focused row uses a "highlighted" imageset, others use a base
      // imageset. Each row's id resolves through its own imageset entry.
      const skin = makeSkin({
        imageset: [
          { id: 'list', images: ['list-img'] },
          { id: 'list_on', images: ['list_on-img'] },
        ],
        songlist: {
          liston: [
            { id: 'list', dst: [{ x: 0, y: 720, w: 500, h: 36 }] },
            { id: 'list_on', dst: [{ x: 0, y: 360, w: 500, h: 36 }] },
            { id: 'list', dst: [{ x: 0, y: 0, w: 500, h: 36 }] },
          ],
        },
      } as unknown as Partial<BeatorajaSkin>);
      const layout = parseBeatorajaSongList(skin);
      expect(layout?.rows.map((r) => r.id)).toEqual(['list-img', 'list_on-img', 'list-img']);
    });

    it('honors numeric imageset ids', () => {
      const skin = makeSkin({
        imageset: [{ id: 100, images: [200] }],
        songlist: {
          liston: [{ id: 100, dst: [{ x: 0, y: 0, w: 500, h: 36 }] }],
        },
      } as unknown as Partial<BeatorajaSkin>);
      const layout = parseBeatorajaSongList(skin);
      expect(layout?.rows[0]?.id).toBe(200);
    });

    it('falls back to original id when imageset.images[] is empty / malformed', () => {
      // Defensive: an imageset with no images can't resolve anywhere meaningful. Keep
      // the original id; let the renderer attempt direct image[] lookup. Either it
      // succeeds (= a sibling image[] declared the id) or the bar texture stays empty.
      const skin = makeSkin({
        imageset: [{ id: 'bar', images: [] }],
        songlist: {
          liston: [{ id: 'bar', dst: [{ x: 0, y: 0, w: 500, h: 36 }] }],
        },
      } as unknown as Partial<BeatorajaSkin>);
      const layout = parseBeatorajaSongList(skin);
      expect(layout?.rows[0]?.id).toBe('bar');
    });

    it('also resolves `listoff[]` ids when the skin omits liston[]', () => {
      // The `listoff` fallback path triggers when `liston[]` is absent. The imageset
      // resolver still runs on each row's id.
      const skin = makeSkin({
        imageset: [{ id: 'bar', images: ['bar-img'] }],
        songlist: {
          listoff: [{ id: 'bar', dst: [{ x: 0, y: 0, w: 500, h: 36 }] }],
        },
      } as unknown as Partial<BeatorajaSkin>);
      const layout = parseBeatorajaSongList(skin);
      expect(layout?.rows[0]?.id).toBe('bar-img');
    });
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

  // Audit A-9 — upstream `BarRenderer.barlength = 60` / `SkinBar.BAR_COUNT = 60`. The
  // constant + the widened `center` acceptance range let renderers iterate the full
  // 60-slot grid (treating `liston[i]` for `i ≥ liston.length` as unauthored / null).
  describe('60-bar fixed slot grid (audit A-9)', () => {
    it('exports `BEATORAJA_SONGLIST_BAR_COUNT = 60` matching upstream BarRenderer', () => {
      // Upstream `beatoraja/src/bms/player/beatoraja/select/bar/BarRenderer.java:52`:
      //   `private final int barlength = 60;`
      // and `bms/player/beatoraja/skin/SkinBar.java`:
      //   `public static final int BAR_COUNT = 60;`
      // Pinning the value catches accidental drifts if upstream ever changes the constant.
      expect(BEATORAJA_SONGLIST_BAR_COUNT).toBe(60);
    });

    it('accepts `songlist.center` values up to 59 even when `liston.length` is smaller', () => {
      // Upstream `JsonSelectSkinObjectLoader.java:79` calls `setCenterBar(sk.songlist.center)`
      // verbatim, and `BarRenderer.java:124` loops `i ∈ [0, 60)` testing `i == centerBar`.
      // A skin authoring `center: 25` with only 21 authored rows is legal — the focused
      // slot just renders nothing in upstream (`barimageon[25] == null`). Our parser must
      // round-trip the value rather than clamp it to `liston.length - 1`.
      const skin = makeSkin({
        songlist: {
          center: 25,
          liston: Array.from({ length: 21 }, (_, i) => ({
            id: 'bar',
            dst: [{ x: 800, y: 720 - i * 36, w: 500, h: 36 }],
          })),
        },
      } as unknown as Partial<BeatorajaSkin>);
      expect(parseBeatorajaSongList(skin)?.focusedRowIndex).toBe(25);
    });

    it('rejects `songlist.center` values ≥ 60 (upstream BarRenderer iterates `[0, 60)`)', () => {
      // 60 / 100 / negatives etc. fall through to the geometric heuristic. Mirrors upstream's
      // implicit bound — `barlength = 60` is the loop length, and feeding `centerBar = 60`
      // would mean "no slot is the cursor" in the upstream comparison.
      const skin = makeSkin({
        songlist: {
          center: 60,
          liston: [
            { id: 'bar', dst: [{ x: 0, y: 600, w: 500, h: 36 }] },
            { id: 'bar', dst: [{ x: 0, y: 360, w: 500, h: 36 }] }, // geometric pick
            { id: 'bar', dst: [{ x: 0, y: 120, w: 500, h: 36 }] },
          ],
        },
      } as unknown as Partial<BeatorajaSkin>);
      // Geometric fallback resolves to row 1 (closest to canvas vertical centre).
      expect(parseBeatorajaSongList(skin)?.focusedRowIndex).toBe(1);
    });

    it('rejects negative `songlist.center` and falls back to the geometric heuristic', () => {
      const skin = makeSkin({
        songlist: {
          center: -1,
          liston: [
            { id: 'bar', dst: [{ x: 0, y: 600, w: 500, h: 36 }] },
            { id: 'bar', dst: [{ x: 0, y: 360, w: 500, h: 36 }] },
            { id: 'bar', dst: [{ x: 0, y: 120, w: 500, h: 36 }] },
          ],
        },
      } as unknown as Partial<BeatorajaSkin>);
      expect(parseBeatorajaSongList(skin)?.focusedRowIndex).toBe(1);
    });
  });
});

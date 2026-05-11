import { describe, expect, it } from 'vitest';
import { expandBeatorajaJudgeDestinations, normalizeBeatorajaJudges } from './beatoraja-skin-judge.ts';

describe('expandBeatorajaJudgeDestinations', () => {
  it('appends the matching per-judge op for each PG/GR/GD/BD/PR/MS slot', () => {
    const judges = normalizeBeatorajaJudges([
      {
        id: 2010,
        index: 0,
        images: [
          { id: 'judgef-pg' },
          { id: 'judgef-gr' },
          { id: 'judgef-gd' },
          { id: 'judgef-bd' },
          { id: 'judgef-pr' },
          { id: 'judgef-ms' },
        ],
        numbers: [],
      },
    ]);
    const expanded = expandBeatorajaJudgeDestinations(judges);
    expect(expanded.map((d) => ({ id: d.id, op: d.op }))).toEqual([
      { id: 'judgef-pg', op: [241] }, // _1p_perfect
      { id: 'judgef-gr', op: [242] }, // _1p_great
      { id: 'judgef-gd', op: [243] }, // _1p_good
      { id: 'judgef-bd', op: [244] }, // _1p_bad
      { id: 'judgef-pr', op: [245] }, // _1p_poor
      { id: 'judgef-ms', op: [246] }, // _1p_miss
    ]);
  });

  it('makes judge[0] and judge[6] mutually exclusive via gauge-max op gating (audit 1.2)', () => {
    // Default 9K's `play9.json` authors a 7-image judge with `judgef-pg2` at index 6.
    // Beatoraja's `SkinJudge.prepare()` swaps `judge[0]` for `judge[6]` when the gauge is at
    // max — it's a SUBSTITUTE, not a parallel layer. Express that mutual exclusion via the
    // synthetic `GAUGE_NOW_AT_MAX_1P` (= 90100) op:
    //   - judge[0] (PG) gates on `[_1p_perfect, -GAUGE_NOW_AT_MAX_1P]` — fires when PG and
    //     gauge is NOT at max.
    //   - judge[6] (PG2) gates on `[_1p_perfect, GAUGE_NOW_AT_MAX_1P]` — fires when PG and
    //     gauge IS at max.
    //
    // Pre-fix the TS impl emitted both side-by-side gated on `[241]`, producing a visible
    // double-render of `judgef-pg` + `judgef-pg2` on every PG (not just full-gauge PGs).
    const judges = normalizeBeatorajaJudges([
      {
        id: 2010,
        index: 0,
        images: [
          { id: 'judgef-pg' },
          { id: 'judgef-gr' },
          { id: 'judgef-gd' },
          { id: 'judgef-bd' },
          { id: 'judgef-pr' },
          { id: 'judgef-ms' },
          { id: 'judgef-pg2' }, // index 6 — fullgauge PG substitute
        ],
        numbers: [],
      },
    ]);
    const expanded = expandBeatorajaJudgeDestinations(judges);
    expect(expanded[0]).toMatchObject({ id: 'judgef-pg', op: [241, -90100] });
    expect(expanded[1]).toMatchObject({ id: 'judgef-gr', op: [242] });
    expect(expanded[6]).toMatchObject({ id: 'judgef-pg2', op: [241, 90100] });
  });

  it('does NOT gate judge[0] on gauge-max when no fullgauge substitute is authored', () => {
    // The standard 6-image authoring (everything except default play9) shouldn't pay the cost
    // of the fullgauge gate. judge[0] keeps its plain `[241]` op so the renderer paints it
    // for every PG regardless of gauge state.
    const judges = normalizeBeatorajaJudges([
      {
        id: 2010,
        index: 0,
        images: [
          { id: 'judgef-pg' },
          { id: 'judgef-gr' },
          { id: 'judgef-gd' },
          { id: 'judgef-bd' },
          { id: 'judgef-pr' },
          { id: 'judgef-ms' },
        ],
        numbers: [],
      },
    ]);
    const expanded = expandBeatorajaJudgeDestinations(judges);
    expect(expanded[0]).toMatchObject({ id: 'judgef-pg', op: [241] });
  });

  it('uses the 2P op block when index === 1', () => {
    const judges = normalizeBeatorajaJudges([{ id: 2011, index: 1, images: [{ id: 'pg2' }], numbers: [] }]);
    expect(expandBeatorajaJudgeDestinations(judges)[0]).toMatchObject({ op: [261] }); // _2p_perfect
  });

  it('uses the 3P op block when index === 2 (POPN-9 third judge plate)', () => {
    // Upstream `play9.json` authors `id: 2012, index: 2` for the right-most judge plate over
    // POPN-9's single playfield. Each per-tier image gets the matching `_3p_*` op:
    //   PG → 361, GR → 362, GD → 363. BAD / POOR / MISS fall back to the 1P ops upstream
    //   (`SkinProperty.java` defines no `_3p_bad/poor/miss`).
    const judges = normalizeBeatorajaJudges([
      {
        id: 2012,
        index: 2,
        images: [
          { id: 'judgef-pg' },
          { id: 'judgef-gr' },
          { id: 'judgef-gd' },
          { id: 'judgef-bd' },
          { id: 'judgef-pr' },
          { id: 'judgef-ms' },
        ],
        numbers: [],
      },
    ]);
    const expanded = expandBeatorajaJudgeDestinations(judges);
    expect(expanded[0]).toMatchObject({ id: 'judgef-pg', op: [361] });
    expect(expanded[1]).toMatchObject({ id: 'judgef-gr', op: [362] });
    expect(expanded[2]).toMatchObject({ id: 'judgef-gd', op: [363] });
    // BAD / POOR / MISS borrow the 1P ops since the 3P plate has no per-tier op upstream.
    expect(expanded[3]).toMatchObject({ id: 'judgef-bd', op: [244] });
    expect(expanded[4]).toMatchObject({ id: 'judgef-pr', op: [245] });
    expect(expanded[5]).toMatchObject({ id: 'judgef-ms', op: [246] });
  });

  it('clones the combo value with SYNTHETIC_NUM_JUDGE_COMBO_3P for plate 3 (per-plate ref)', () => {
    // The POPN-9 right plate (`judge.index === 2`) must NOT mutate the shared `judgen-*` value
    // in place — multiple plates reference the same value id, so a per-plate mutation would
    // race the last-processed plate's ref onto all earlier plates' combo digits. Instead, the
    // expander clones the value with a plate-suffixed id (`__plate3`), sets `ref` to the 3P
    // synthetic on the clone, and rewrites the destination's `id` to the clone. The ORIGINAL
    // value stays untouched (= plate 1's id and ref) and the cloned value carries plate 3's
    // ref. Pairs with `valuesById.set(...)` so the renderer's value lookup finds the clone at
    // render time.
    const judges = normalizeBeatorajaJudges([
      {
        id: 2012,
        index: 2,
        images: [{ id: 'judgef-pg' }],
        numbers: [{ id: 'judgen-pg' }],
      },
    ]);
    const original = { id: 'judgen-pg', digit: 6, align: 0, ref: 75 /* = MAXCOMBO */ };
    const valuesById = new Map([['judgen-pg', original]]);
    const expanded = expandBeatorajaJudgeDestinations(
      judges,
      valuesById as unknown as Parameters<typeof expandBeatorajaJudgeDestinations>[1],
    );
    // Original stays untouched — that entry belongs to plate 1.
    expect(original.ref).toBe(75);
    expect(original.align).toBe(0);
    // A cloned entry exists with the per-plate ref + center-align override.
    const clone = valuesById.get('judgen-pg__plate3' as never) as
      | { id: string; align: number; ref: number; digit: number }
      | undefined;
    expect(clone).toBeDefined();
    expect(clone?.ref).toBe(20103);
    expect(clone?.align).toBe(2);
    expect(clone?.digit).toBe(6);
    // The destination's `id` is rewritten to the clone so the renderer's value lookup hits it.
    const judgenDest = expanded.find((d) => typeof (d as { id?: unknown }).id === 'string' && (d as { id: string }).id.startsWith('judgen-pg'));
    expect((judgenDest as { id: string } | undefined)?.id).toBe('judgen-pg__plate3');
  });

  it('mutates the value in place for plate 1 (single-plate idiom — no aliasing risk)', () => {
    // Plate 1 (`judge.index === 0`) keeps the in-place mutation since there's exactly one
    // plate-1 entry per chart and the value isn't aliased across plates. Documents the
    // intentional asymmetry between plate 1 (mutate) and plates 2 / 3 (clone) so a future
    // refactor doesn't accidentally start cloning every plate.
    const judges = normalizeBeatorajaJudges([
      { id: 2010, index: 0, images: [{ id: 'judgef-pg' }], numbers: [{ id: 'judgen-pg' }] },
    ]);
    const valueElement = { id: 'judgen-pg', digit: 6, align: 0, ref: 75 };
    const valuesById = new Map([['judgen-pg', valueElement]]);
    expandBeatorajaJudgeDestinations(
      judges,
      valuesById as unknown as Parameters<typeof expandBeatorajaJudgeDestinations>[1],
    );
    expect(valueElement.ref).toBe(20101); // SYNTHETIC_NUM_JUDGE_COMBO_1P
    expect(valueElement.align).toBe(2);
    // No clone entries — plate 1 mutated in place.
    expect([...valuesById.keys()]).toEqual(['judgen-pg']);
  });

  it('preserves an existing op gate by appending the judge op (AND semantics)', () => {
    // Authors that gate the judge image on a play-side op (e.g. `op = {920}`) expect both
    // gates to be active for the image to render. The expansion appends the judge op to the
    // existing array rather than replacing it.
    const judges = normalizeBeatorajaJudges([
      { id: 2010, index: 0, images: [{ id: 'judgef-pg', op: [920] }], numbers: [] },
    ]);
    expect(expandBeatorajaJudgeDestinations(judges)[0]).toMatchObject({ op: [920, 241] });
  });

  it('only emits judge.numbers[0..2] (PG/GR/GD) — drops BD/PR/MS slots (audit 1.3)', () => {
    // Beatoraja's `SkinJudge.java:96` runs `nowCount = judgenow < 3 ? count[judgenow] : null`,
    // so authoring numbers for tiers 3..5 produces nothing on screen. The TS impl previously
    // emitted all 6 slots identically gated on the matching judge op, which made authors who
    // referenced MAXCOMBO from every slot (ModernChic Play/lua/sp/judge.lua, GdbG values.lua)
    // see a stale combo digit on every BAD/POOR/MISS — Java would render nothing instead.
    const judges = normalizeBeatorajaJudges([
      {
        id: 2010,
        index: 0,
        images: [],
        numbers: [
          { id: 'count-pg' },
          { id: 'count-gr' },
          { id: 'count-gd' },
          { id: 'count-bd' },
          { id: 'count-pr' },
          { id: 'count-ms' },
        ],
      },
    ]);
    const expanded = expandBeatorajaJudgeDestinations(judges);
    expect(expanded.map((d) => d.id)).toEqual(['count-pg', 'count-gr', 'count-gd']);
    expect(expanded[0]).toMatchObject({ op: [241] }); // _1p_perfect
    expect(expanded[1]).toMatchObject({ op: [242] }); // _1p_great
    expect(expanded[2]).toMatchObject({ op: [243] }); // _1p_good
  });

  it('emits all authored numbers when fewer than 3 are present', () => {
    // Authors that author only the PG count number (the most common case for
    // single-overlay popn-style skins) still get that single entry emitted with the PG op.
    const judges = normalizeBeatorajaJudges([
      { id: 2010, index: 0, images: [], numbers: [{ id: 'pg-count-only' }] },
    ]);
    const expanded = expandBeatorajaJudgeDestinations(judges);
    expect(expanded).toHaveLength(1);
    expect(expanded[0]).toMatchObject({ id: 'pg-count-only', op: [241] });
  });

  it('folds judge.numbers[i].dst into judge.images[i].dst per layout variant', () => {
    // Beatoraja's `SkinJudge.draw()` paints `numbers[i]` at `(parent.x + child.x, parent.y +
    // child.y)`. Default `play5.json` authors `judgef-pg.dst = {x:70, y:240}` (1P layout
    // gated on `if[920]`) / `{x:1010, y:240}` (2P gated on `if[921]`) and `judgen-pg.dst =
    // {x:200, y:0, w:40, h:40}`. The folded output should pin the number at `(70+200, 240+0)`
    // for 1P and `(1010+200, 240+0)` for 2P — NOT at the literal `(200, 0)` (which would put
    // the digit at Y-UP `y=0` = bottom of canvas next to DURATION). Pure-time fade-out kfs
    // (no x/y) pass through unchanged.
    const judges = normalizeBeatorajaJudges([
      {
        id: 2010,
        index: 0,
        images: [
          {
            id: 'judgef-pg',
            timer: 46,
            dst: [
              { if: [920], value: { time: 0, x: 70, y: 240, w: 180, h: 40 } },
              { if: [921], value: { time: 0, x: 1010, y: 240, w: 180, h: 40 } },
              { time: 500 },
            ],
          },
        ],
        numbers: [
          {
            id: 'judgen-pg',
            timer: 46,
            dst: [
              { time: 0, x: 200, y: 0, w: 40, h: 40 },
              { time: 500 },
            ],
          },
        ],
      },
    ]);
    const expanded = expandBeatorajaJudgeDestinations(judges);
    // 1 image + 1 number = 2 destinations
    expect(expanded).toHaveLength(2);
    const number = expanded[1]! as Record<string, unknown>;
    expect(number.id).toBe('judgen-pg');
    expect(number.dst).toEqual([
      // 1P-gated keyframe — `(70+200, 240+0, 40, 40)`
      { if: [920], value: { time: 0, x: 270, y: 240, w: 40, h: 40 } },
      // 2P-gated keyframe — `(1010+200, 240+0, 40, 40)`
      { if: [921], value: { time: 0, x: 1210, y: 240, w: 40, h: 40 } },
      // Pure-time fade-out passes through unchanged
      { time: 500 },
    ]);
  });

  it('applies upstream pre-shift (ckf.w * digit / 2) and forces align=2 on judge.numbers values', () => {
    // Mirrors `JsonPlaySkinObjectLoader.java:267-270`: judge.numbers[i].dst.x is decremented
    // by `ani.w * value.digit / 2` so the authored child.x represents the CENTRE of the digit
    // row (not the left edge). And SkinJudge constructs SkinNumber with align=2 (CENTRE)
    // hard-coded, ignoring any authored `value.align`.
    //
    // For default `play5.json`'s judge.numbers[0] = {x:200, y:0, w:40, h:40} with the matching
    // value `judgen-pg` (digit:6), the pre-shift is `40 * 6 / 2 = 120`, so the folded x for
    // the 1P parent (`judgef-pg.dst.x = 70`) is `70 + 200 - 120 = 150`. Without the pre-shift
    // + align=2 override, "GREAT 46" rendered with a 160 px gap between word and digits.
    const judges = normalizeBeatorajaJudges([
      {
        id: 2010,
        index: 0,
        images: [
          {
            id: 'judgef-pg',
            dst: [{ if: [920], value: { time: 0, x: 70, y: 240, w: 180, h: 40 } }],
          },
        ],
        numbers: [
          {
            id: 'judgen-pg',
            dst: [{ time: 0, x: 200, y: 0, w: 40, h: 40 }],
          },
        ],
      },
    ]);
    const valueElement = {
      id: 'judgen-pg',
      src: 4,
      x: 0,
      y: 0,
      w: 300,
      h: 100,
      divx: 10,
      divy: 2,
      digit: 6,
      padding: 0,
      zeropadding: 0,
      space: 0,
      ref: 75,
      align: 0, // authored as RIGHT — should be mutated to 2 (CENTER)
      offsets: [] as readonly number[],
      cycle: 0,
      ifCodes: [] as readonly number[],
    };
    const valuesById = new Map([['judgen-pg' as string | number, valueElement]]);
    const expanded = expandBeatorajaJudgeDestinations(judges, valuesById);
    const number = expanded[1]! as Record<string, unknown>;
    expect(number.id).toBe('judgen-pg');
    expect(number.dst).toEqual([
      // 70 (parent) + 200 (child) - 120 (preShift = 40*6/2) = 150
      { if: [920], value: { time: 0, x: 150, y: 240, w: 40, h: 40 } },
    ]);
    // Value declaration's align is mutated to 2 (CENTER) for the SkinNumber render path.
    expect(valueElement.align).toBe(2);
  });

  it('appends synthetic judge-word-shift offset id on judgef-* destinations when shift=true', () => {
    // Mirrors `SkinJudge.prepare()`'s `nowJudge.region.x += -nowCount.getLength() / 2`:
    // when `judge.shift` is true, beatoraja shifts the judge word LEFT by half the
    // rendered combo's pixel width so the (word + combo) pair stays centred on the
    // authored anchor regardless of digit count. We append a synthetic offset id
    // (20001 for 1P, 20002 for 2P) that the runtime adapter resolves to the dynamic
    // `-combo_width/2` x adjustment.
    const judges = normalizeBeatorajaJudges([
      {
        id: 2010,
        index: 0,
        images: [{ id: 'judgef-pg', dst: [{ time: 0, x: 70, y: 240, w: 180, h: 40 }] }],
        numbers: [{ id: 'judgen-pg', dst: [{ time: 0, x: 200, y: 0, w: 40, h: 40 }] }],
        shift: true,
      },
    ]);
    const expanded = expandBeatorajaJudgeDestinations(judges);
    const judgef = expanded[0]! as Record<string, unknown>;
    expect(judgef.id).toBe('judgef-pg');
    expect(judgef.offsets).toEqual([20001]); // 1P judge-word-shift synthetic id
  });

  it('uses the 2P synthetic offset id when index=1 and shift=true', () => {
    const judges = normalizeBeatorajaJudges([
      {
        id: 2010,
        index: 1,
        images: [{ id: 'judgef-pg', dst: [{ time: 0, x: 1010, y: 240, w: 180, h: 40 }] }],
        numbers: [{ id: 'judgen-pg', dst: [{ time: 0, x: 200, y: 0, w: 40, h: 40 }] }],
        shift: true,
      },
    ]);
    const expanded = expandBeatorajaJudgeDestinations(judges);
    const judgef = expanded[0]! as Record<string, unknown>;
    expect(judgef.offsets).toEqual([20002]); // 2P
  });

  it('skips the synthetic offset when shift=false', () => {
    const judges = normalizeBeatorajaJudges([
      {
        id: 2010,
        index: 0,
        images: [{ id: 'judgef-pg', dst: [{ time: 0, x: 70, y: 240, w: 180, h: 40 }] }],
        numbers: [{ id: 'judgen-pg', dst: [{ time: 0, x: 200, y: 0, w: 40, h: 40 }] }],
        shift: false,
      },
    ]);
    const expanded = expandBeatorajaJudgeDestinations(judges);
    const judgef = expanded[0]! as Record<string, unknown>;
    // `offsets` is either undefined or empty — no synthetic id.
    const offsets = (judgef.offsets as number[] | undefined) ?? [];
    expect(offsets.includes(20001) || offsets.includes(20002)).toBe(false);
  });

  it('passes the child through unchanged when the matching parent has no positioned dst', () => {
    // Some skins author `judge.images[i]` with empty / time-only dst (e.g. an animation hold
    // with no spatial keyframe). Folding has nothing to add to in that case — the child's
    // own dst stays as authored. Verifies the fold doesn't drop kfs when there's no parent
    // position to combine with.
    const judges = normalizeBeatorajaJudges([
      {
        id: 2010,
        index: 0,
        images: [{ id: 'judgef-pg', dst: [{ time: 0 }] }],
        numbers: [{ id: 'judgen-pg', dst: [{ time: 0, x: 100, y: 200, w: 40, h: 40 }] }],
      },
    ]);
    const expanded = expandBeatorajaJudgeDestinations(judges);
    const number = expanded[1]! as Record<string, unknown>;
    expect(number.dst).toEqual([{ time: 0, x: 100, y: 200, w: 40, h: 40 }]);
  });

  // Mirrors upstream `JsonPlaySkinObjectLoader.java:220-221`:
  //   for (JsonSkin.Judge judge : sk.judge) {
  //       if (dst.id.equals(judge.id)) { ... instantiate ... }
  //   }
  // Only judges whose id matches a destination id get instantiated. The previous TS impl
  // expanded every parts.judge entry regardless — visible as 2-3 stacked judge sprites on
  // ModernChic where 5 alternate-layout judge entries (`def`, `laneCoverRest_{1,2}`,
  // `constantRest_{1,2}`) were all painting simultaneously even though `parts.destination`
  // referenced just one.
  it('skips judge entries whose id is not in the referencedJudgeIds set', () => {
    const judges = normalizeBeatorajaJudges([
      {
        id: 'def',
        index: 0,
        images: [{ id: 'judgef-pg', dst: [{ time: 0, x: 0, y: 0, w: 100, h: 100 }] }],
        numbers: [],
      },
      {
        id: 'laneCoverRest_1',
        index: 0,
        images: [{ id: 'judgef-pg', dst: [{ time: 0, x: 0, y: 0, w: 100, h: 100 }] }],
        numbers: [],
      },
      {
        id: 'constantRest_2',
        index: 0,
        images: [{ id: 'judgef-pg', dst: [{ time: 0, x: 0, y: 0, w: 100, h: 100 }] }],
        numbers: [],
      },
    ]);
    // parts.destination references only `def`; the other two layouts must be skipped.
    const referenced = new Set(['def']);
    const expanded = expandBeatorajaJudgeDestinations(judges, undefined, referenced);
    // 6 image destinations from `def` (one per judge tier PG/GR/GD/BD/PR/MS — though we only
    // authored one image, the expansion processes images.length entries). The two unreferenced
    // entries contribute 0 destinations each.
    expect(expanded).toHaveLength(judges[0]!.images.length);
  });

  it('expands every judge entry when no referencedJudgeIds set is supplied (legacy fallback)', () => {
    // Hosts that haven't wired the destination scan yet (or older tests) keep working — the
    // filter only activates when an explicit set is passed.
    const judges = normalizeBeatorajaJudges([
      {
        id: 'a',
        index: 0,
        images: [{ id: 'judgef-pg', dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] }],
        numbers: [],
      },
      {
        id: 'b',
        index: 0,
        images: [{ id: 'judgef-pg', dst: [{ time: 0, x: 0, y: 0, w: 1, h: 1 }] }],
        numbers: [],
      },
    ]);
    const expanded = expandBeatorajaJudgeDestinations(judges);
    expect(expanded.length).toBe(judges[0]!.images.length + judges[1]!.images.length);
  });
});

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
});

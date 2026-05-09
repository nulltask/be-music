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

  it('aliases indices beyond MS back to PERFECT (popn 9K judgef-pg2 at index 6)', () => {
    // Default 9K's `play9.json` authors a 7-image judge with `judgef-pg2` at index 6 — it's a
    // popn-style secondary splash that fires alongside the regular `judgef-pg` on PERFECT.
    // Pre-fix the 7th entry was silently dropped because the expansion capped at
    // `i < ops.length`. Now indices ≥ 6 alias to PG so authors can stack PG-only effects.
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
          { id: 'judgef-pg2' }, // index 6 — popn PG2 splash
        ],
        numbers: [],
      },
    ]);
    const expanded = expandBeatorajaJudgeDestinations(judges);
    // Both `judgef-pg` (index 0) AND `judgef-pg2` (index 6) gate on op 241 — they fire together.
    expect(expanded[0]).toMatchObject({ id: 'judgef-pg', op: [241] });
    expect(expanded[6]).toMatchObject({ id: 'judgef-pg2', op: [241] });
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
});

import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaJudgeGraphs } from './beatoraja-skin-judgegraph.ts';

describe('normalizeBeatorajaJudgeGraphs', () => {
  it('keeps the per-element fields the renderer cares about', () => {
    const out = normalizeBeatorajaJudgeGraphs([{ id: 'judgegraph', type: 1, backTexOff: 1 }]);
    expect(out[0]).toMatchObject({ id: 'judgegraph', type: 1, backTexOff: 1, ifCodes: [] });
  });

  it('honors numeric ids (matches resultmain.lua: `{id = "judgegraph_j", type = 1}`)', () => {
    const out = normalizeBeatorajaJudgeGraphs([{ id: 5, type: 2 }]);
    expect(out[0]).toMatchObject({ id: 5, type: 2, backTexOff: 0, ifCodes: [] });
  });

  it('drops entries without a usable id', () => {
    const out = normalizeBeatorajaJudgeGraphs([{ type: 1 }, { id: 'ok', type: 1 }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'ok', type: 1, backTexOff: 0, ifCodes: [] });
  });

  it('preserves ifCodes from `if`-gated entries', () => {
    const graphs = normalizeBeatorajaJudgeGraphs([{ if: [920], values: [{ id: 'jg', type: 1 }] }]);
    expect(graphs[0]).toMatchObject({ id: 'jg', type: 1, backTexOff: 0, ifCodes: [920] });
  });

  it('parses delay / orderReverse / noGap / noGapX styling fields with beatoraja defaults (audit 3.4)', () => {
    // Author-omitted fields fall back to beatoraja's `JsonSkin.JudgeGraph` defaults
    // (delay=500, others=0). Entry-animation timing AND bar layout (gap, order) are now
    // surfaced for renderers that animate the histogram fill.
    const out = normalizeBeatorajaJudgeGraphs([{ id: 'jg', type: 1 }]);
    expect(out[0]).toMatchObject({ delay: 500, orderReverse: 0, noGap: 0, noGapX: 0 });

    // Authored values pass through verbatim.
    const styled = normalizeBeatorajaJudgeGraphs([
      { id: 'jg', type: 1, delay: 250, orderReverse: 1, noGap: 1, noGapX: 1 },
    ]);
    expect(styled[0]).toMatchObject({ delay: 250, orderReverse: 1, noGap: 1, noGapX: 1 });
  });

  it('returns an empty array when input is missing or malformed', () => {
    expect(normalizeBeatorajaJudgeGraphs(undefined)).toEqual([]);
    expect(normalizeBeatorajaJudgeGraphs(null)).toEqual([]);
    expect(normalizeBeatorajaJudgeGraphs('nope')).toEqual([]);
  });
});

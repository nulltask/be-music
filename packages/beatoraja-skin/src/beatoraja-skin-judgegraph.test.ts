import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaJudgeGraphs } from './beatoraja-skin-judgegraph.ts';

describe('normalizeBeatorajaJudgeGraphs', () => {
  it('keeps the per-element fields the renderer cares about', () => {
    expect(normalizeBeatorajaJudgeGraphs([{ id: 'judgegraph', type: 1, backTexOff: 1 }])).toEqual([
      { id: 'judgegraph', type: 1, backTexOff: 1, ifCodes: [] },
    ]);
  });

  it('honors numeric ids (matches resultmain.lua: `{id = "judgegraph_j", type = 1}`)', () => {
    expect(normalizeBeatorajaJudgeGraphs([{ id: 5, type: 2 }])).toEqual([
      { id: 5, type: 2, backTexOff: 0, ifCodes: [] },
    ]);
  });

  it('drops entries without a usable id', () => {
    expect(normalizeBeatorajaJudgeGraphs([{ type: 1 }, { id: 'ok', type: 1 }])).toEqual([
      { id: 'ok', type: 1, backTexOff: 0, ifCodes: [] },
    ]);
  });

  it('preserves ifCodes from `if`-gated entries', () => {
    const graphs = normalizeBeatorajaJudgeGraphs([{ if: [920], values: [{ id: 'jg', type: 1 }] }]);
    expect(graphs).toEqual([{ id: 'jg', type: 1, backTexOff: 0, ifCodes: [920] }]);
  });

  it('returns an empty array when input is missing or malformed', () => {
    expect(normalizeBeatorajaJudgeGraphs(undefined)).toEqual([]);
    expect(normalizeBeatorajaJudgeGraphs(null)).toEqual([]);
    expect(normalizeBeatorajaJudgeGraphs('nope')).toEqual([]);
  });
});

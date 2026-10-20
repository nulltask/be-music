import { describe, expect, it } from 'vite-plus/test';
import { normalizeBeatorajaBPMGraphs } from './bpm-graph.ts';

describe('normalizeBeatorajaBPMGraphs', () => {
  it('keeps numeric ids', () => {
    expect(normalizeBeatorajaBPMGraphs([{ id: 42 }])).toEqual([{ id: 42, ifCodes: [] }]);
  });

  it('keeps string ids (matches beatoraja default theme: `id = "bpmgraph"`)', () => {
    expect(normalizeBeatorajaBPMGraphs([{ id: 'bpmgraph' }])).toEqual([{ id: 'bpmgraph', ifCodes: [] }]);
  });

  it('drops entries without an id', () => {
    expect(normalizeBeatorajaBPMGraphs([{ src: 0 }, { id: 'ok' }])).toEqual([{ id: 'ok', ifCodes: [] }]);
  });

  it('preserves ifCodes from `if`-gated entries', () => {
    const graphs = normalizeBeatorajaBPMGraphs([{ if: [920], values: [{ id: 'bpm' }] }]);
    expect(graphs).toEqual([{ id: 'bpm', ifCodes: [920] }]);
  });

  it('returns an empty array when input is missing or malformed', () => {
    expect(normalizeBeatorajaBPMGraphs(undefined)).toEqual([]);
    expect(normalizeBeatorajaBPMGraphs(null)).toEqual([]);
    expect(normalizeBeatorajaBPMGraphs('not-an-array')).toEqual([]);
  });
});

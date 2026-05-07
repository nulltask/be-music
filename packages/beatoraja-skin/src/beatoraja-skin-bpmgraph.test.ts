import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaBpmGraphs } from './beatoraja-skin-bpmgraph.ts';

describe('normalizeBeatorajaBpmGraphs', () => {
  it('keeps numeric ids', () => {
    expect(normalizeBeatorajaBpmGraphs([{ id: 42 }])).toEqual([{ id: 42, ifCodes: [] }]);
  });

  it('keeps string ids (matches beatoraja default theme: `id = "bpmgraph"`)', () => {
    expect(normalizeBeatorajaBpmGraphs([{ id: 'bpmgraph' }])).toEqual([{ id: 'bpmgraph', ifCodes: [] }]);
  });

  it('drops entries without an id', () => {
    expect(normalizeBeatorajaBpmGraphs([{ src: 0 }, { id: 'ok' }])).toEqual([{ id: 'ok', ifCodes: [] }]);
  });

  it('preserves ifCodes from `if`-gated entries', () => {
    const graphs = normalizeBeatorajaBpmGraphs([{ if: [920], values: [{ id: 'bpm' }] }]);
    expect(graphs).toEqual([{ id: 'bpm', ifCodes: [920] }]);
  });

  it('returns an empty array when input is missing or malformed', () => {
    expect(normalizeBeatorajaBpmGraphs(undefined)).toEqual([]);
    expect(normalizeBeatorajaBpmGraphs(null)).toEqual([]);
    expect(normalizeBeatorajaBpmGraphs('not-an-array')).toEqual([]);
  });
});

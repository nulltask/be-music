import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaGaugeGraphs } from './beatoraja-skin-gaugegraph.ts';

describe('normalizeBeatorajaGaugeGraphs', () => {
  it('keeps id + color list', () => {
    const out = normalizeBeatorajaGaugeGraphs([{ id: 'gaugegraph', color: ['ff8888', '442222', 'ff00ff', '440044'] }]);
    expect(out).toEqual([{ id: 'gaugegraph', colors: ['ff8888', '442222', 'ff00ff', '440044'], ifCodes: [] }]);
  });

  it('drops non-string / empty entries from `color`', () => {
    const out = normalizeBeatorajaGaugeGraphs([{ id: 'gg', color: ['ff8888', 42, '', 'ff00ff', null] }]);
    expect(out[0]?.colors).toEqual(['ff8888', 'ff00ff']);
  });

  it('drops entries without an id', () => {
    expect(normalizeBeatorajaGaugeGraphs([{ color: ['x'] }, { id: 'ok' }])).toEqual([
      { id: 'ok', colors: [], ifCodes: [] },
    ]);
  });

  it('preserves ifCodes from `if`-gated entries', () => {
    expect(normalizeBeatorajaGaugeGraphs([{ if: [920], values: [{ id: 'gg' }] }])).toEqual([
      { id: 'gg', colors: [], ifCodes: [920] },
    ]);
  });

  it('returns an empty array when input is missing or malformed', () => {
    expect(normalizeBeatorajaGaugeGraphs(undefined)).toEqual([]);
    expect(normalizeBeatorajaGaugeGraphs(null)).toEqual([]);
    expect(normalizeBeatorajaGaugeGraphs('nope')).toEqual([]);
  });
});

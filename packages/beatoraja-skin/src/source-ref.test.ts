import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaGraphs } from './elements/graph.ts';
import { normalizeBeatorajaSliders } from './elements/slider.ts';
import { normalizeBeatorajaValues } from './elements/value.ts';

describe('symbolic source references', () => {
  it('preserves string src ids for value elements', () => {
    const out = normalizeBeatorajaValues([{ id: 'score', src: 'numbers_src', x: 0, y: 0, w: 120, h: 24 }]);
    expect(out[0]?.src).toBe('numbers_src');
  });

  it('preserves string src ids for graph elements', () => {
    const out = normalizeBeatorajaGraphs([{ id: 'gauge', src: 'gauge_src', x: 0, y: 0, w: 100, h: 12 }]);
    expect(out[0]?.src).toBe('gauge_src');
  });

  it('preserves string src ids for slider elements', () => {
    const out = normalizeBeatorajaSliders([{ id: 'lanecover', src: 'system_src', x: 0, y: 0, w: 64, h: 8 }]);
    expect(out[0]?.src).toBe('system_src');
  });
});

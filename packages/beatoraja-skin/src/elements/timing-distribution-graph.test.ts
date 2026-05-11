import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaTimingDistributionGraphs } from './timing-distribution-graph.ts';

describe('normalizeBeatorajaTimingDistributionGraphs', () => {
  it('keeps id and defaults the rest to zero / empty', () => {
    expect(normalizeBeatorajaTimingDistributionGraphs([{ id: 'tdg' }])).toEqual([
      {
        id: 'tdg',
        lineWidth: 0,
        drawAverage: 0,
        drawDev: 0,
        graphColor: '',
        averageColor: '',
        devColor: '',
        pgColor: '',
        grColor: '',
        gdColor: '',
        bdColor: '',
        prColor: '',
        ifCodes: [],
      },
    ]);
  });

  it('parses authored fields verbatim (uppercase color keys honored too)', () => {
    const out = normalizeBeatorajaTimingDistributionGraphs([
      {
        id: 'tdg',
        lineWidth: 2,
        drawAverage: 1,
        drawDev: 1,
        graphColor: 'cccccc',
        averageColor: 'ffaa00',
        devColor: '00aaff',
        PGColor: 'ffff00',
        GRColor: '00ff00',
        GDColor: '0000ff',
        BDColor: 'ff0000',
        PRColor: 'ff00ff',
      },
    ]);
    expect(out[0]).toMatchObject({
      lineWidth: 2,
      drawAverage: 1,
      drawDev: 1,
      graphColor: 'cccccc',
      averageColor: 'ffaa00',
      devColor: '00aaff',
      pgColor: 'ffff00',
      prColor: 'ff00ff',
    });
  });

  it('drops entries without an id', () => {
    expect(normalizeBeatorajaTimingDistributionGraphs([{ lineWidth: 2 }, { id: 'ok' }])).toHaveLength(1);
  });

  it('returns an empty array on missing input', () => {
    expect(normalizeBeatorajaTimingDistributionGraphs(undefined)).toEqual([]);
    expect(normalizeBeatorajaTimingDistributionGraphs(null)).toEqual([]);
  });
});

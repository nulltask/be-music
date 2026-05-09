import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaGaugeGraphs } from './beatoraja-skin-gaugegraph.ts';

describe('normalizeBeatorajaGaugeGraphs', () => {
  it('keeps id + color list', () => {
    const out = normalizeBeatorajaGaugeGraphs([{ id: 'gaugegraph', color: ['ff8888', '442222', 'ff00ff', '440044'] }]);
    expect(out[0]).toMatchObject({
      id: 'gaugegraph',
      colors: ['ff8888', '442222', 'ff00ff', '440044'],
      ifCodes: [],
    });
  });

  it('drops non-string / empty entries from `color`', () => {
    const out = normalizeBeatorajaGaugeGraphs([{ id: 'gg', color: ['ff8888', 42, '', 'ff00ff', null] }]);
    expect(out[0]?.colors).toEqual(['ff8888', 'ff00ff']);
  });

  it('drops entries without an id', () => {
    const out = normalizeBeatorajaGaugeGraphs([{ color: ['x'] }, { id: 'ok' }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'ok', colors: [], ifCodes: [] });
  });

  it('preserves ifCodes from `if`-gated entries', () => {
    const out = normalizeBeatorajaGaugeGraphs([{ if: [920], values: [{ id: 'gg' }] }]);
    expect(out[0]).toMatchObject({ id: 'gg', colors: [], ifCodes: [920] });
  });

  it('returns an empty array when input is missing or malformed', () => {
    expect(normalizeBeatorajaGaugeGraphs(undefined)).toEqual([]);
    expect(normalizeBeatorajaGaugeGraphs(null)).toEqual([]);
    expect(normalizeBeatorajaGaugeGraphs('nope')).toEqual([]);
  });

  it('parses 14 named per-gauge color fields with beatoraja defaults (audit 3.3)', () => {
    // Author-omitted fields fall back to beatoraja's `JsonSkin.GaugeGraph` declaration
    // defaults — the renderer can pick the matching pair without checking for undefined.
    const out = normalizeBeatorajaGaugeGraphs([{ id: 'gg' }]);
    expect(out[0]).toMatchObject({
      assistClearBGColor: '440044',
      assistAndEasyFailBGColor: '004444',
      grooveFailBGColor: '004400',
      grooveClearAndHardBGColor: '440000',
      exHardBGColor: '444400',
      hazardBGColor: '444444',
      assistClearLineColor: 'ff00ff',
      assistAndEasyFailLineColor: '00ffff',
      grooveFailLineColor: '00ff00',
      grooveClearAndHardLineColor: 'ff0000',
      exHardLineColor: 'ffff00',
      hazardLineColor: 'cccccc',
      borderlineColor: 'ff0000',
      borderColor: '440000',
    });
  });

  it('preserves authored color overrides verbatim', () => {
    const out = normalizeBeatorajaGaugeGraphs([
      { id: 'gg', grooveClearAndHardLineColor: 'abcdef', borderColor: '123456' },
    ]);
    expect(out[0]?.grooveClearAndHardLineColor).toBe('abcdef');
    expect(out[0]?.borderColor).toBe('123456');
    // Untouched fields keep their defaults.
    expect(out[0]?.exHardLineColor).toBe('ffff00');
  });
});

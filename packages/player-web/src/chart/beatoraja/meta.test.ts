import { describe, expect, it } from 'vitest';
import type { BeMusicJson } from '@be-music/json';
import { extractChartSubartist } from './meta.ts';

function makeChart(opts: { extras?: Record<string, string>; subartists?: string[] }): BeMusicJson {
  return {
    metadata: {
      bpm: 120,
      title: 't',
      extras: opts.extras ?? {},
    } as unknown as BeMusicJson['metadata'],
    events: [],
    measures: [],
    bms: {} as unknown as BeMusicJson['bms'],
    resources: {} as unknown as BeMusicJson['resources'],
    bmson: opts.subartists ? ({ info: { subartists: opts.subartists } } as unknown as BeMusicJson['bmson']) : undefined,
  } as unknown as BeMusicJson;
}

describe('extractChartSubartist', () => {
  it('returns empty for an undefined chart', () => {
    expect(extractChartSubartist(undefined)).toBe('');
  });

  it('returns empty when neither source is populated', () => {
    expect(extractChartSubartist(makeChart({}))).toBe('');
  });

  it('reads from `metadata.extras.SUBARTIST` for BMS / PMS charts', () => {
    // BMS parser drops `#SUBARTIST` into `extras` since it is not a typed metadata field. The
    // GdbG chart `_94_CyCh_EX.pms` has `#SUBARTIST mov:LLRK / vo:花隈千冬` — must surface verbatim.
    const chart = makeChart({ extras: { SUBARTIST: 'mov:LLRK / vo:花隈千冬' } });
    expect(extractChartSubartist(chart)).toBe('mov:LLRK / vo:花隈千冬');
  });

  it('joins bmson `info.subartists[]` entries with spaces', () => {
    const chart = makeChart({ subartists: ['illust:foo', 'obj:bar'] });
    expect(extractChartSubartist(chart)).toBe('illust:foo obj:bar');
  });

  it('skips empty strings inside `subartists[]`', () => {
    const chart = makeChart({ subartists: ['', 'mov:foo', ''] });
    expect(extractChartSubartist(chart)).toBe('mov:foo');
  });

  it('prefers bmson `subartists` over `extras.SUBARTIST` when both are present', () => {
    // bmson charts round-tripped through a BMS-flavoured tool can pick up an `extras.SUBARTIST`
    // duplicate. The structured field wins so we don't render the same value twice.
    const chart = makeChart({
      subartists: ['mov:bmson'],
      extras: { SUBARTIST: 'mov:bms-extra' },
    });
    expect(extractChartSubartist(chart)).toBe('mov:bmson');
  });

  it('falls back to extras when bmson subartists is empty', () => {
    const chart = makeChart({ subartists: [], extras: { SUBARTIST: 'mov:bms' } });
    expect(extractChartSubartist(chart)).toBe('mov:bms');
  });
});

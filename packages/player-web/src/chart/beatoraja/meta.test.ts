import { describe, expect, it } from 'vite-plus/test';
import type { BeMusicJson } from '@be-music/json';
import { extractChartSubartist, resolveChartTotalReadout } from './meta.ts';

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

describe('resolveChartTotalReadout', () => {
  const chart = (total?: number) => ({ metadata: total === undefined ? {} : { total } }) as unknown as BeMusicJson;

  it('prefers the effective TOTAL the gauge runs on', () => {
    // A bmson `total: 100` is a percentage; the readout shows the resolved TOTAL, as beatoraja does after
    // `BMSPlayerRule.validate`.
    expect(resolveChartTotalReadout(chart(100), { effectiveTotal: 176.8 })).toBe(176);
  });

  it('falls back to the chart header without a resolved gauge', () => {
    expect(resolveChartTotalReadout(chart(320), undefined)).toBe(320);
    expect(resolveChartTotalReadout(chart(320), { effectiveTotal: 0 })).toBe(320);
  });

  it('is undefined with neither a gauge nor a header', () => {
    expect(resolveChartTotalReadout(chart(), undefined)).toBeUndefined();
    expect(resolveChartTotalReadout(undefined, undefined)).toBeUndefined();
  });
});

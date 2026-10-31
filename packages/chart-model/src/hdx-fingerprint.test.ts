import { expect, test } from 'vite-plus/test';
import { parseBMS, resolveBMSControlFlowWithDraws } from '@be-music/chart-parser';
import { computePlayFingerprint, computeChartFingerprint, createPlayFingerprintDocument } from './fingerprint.ts';
import { createOutcomeComposer, expandChartFingerprintDocument } from './fingerprint-compose.ts';
import { createChartFingerprintDocument } from './fingerprint.ts';
const notes = '#BPM 120\n#LNTYPE 1\n#00151:01\n#00251:01';

test('HDX LONGMODE contributes the same effective LN identity as explicit LNMODE', () => {
  const key = (prefix: string) => computePlayFingerprint(parseBMS(`${prefix}\n${notes}`), { chartPath: 'hdx.bms' });
  expect(key('#OPTION charatbeatHDX:LONGMODE 0')).toBe(key('#LNMODE 2'));
  expect(key('#OPTION charatbeatHDX:LONGMODE 1')).toBe(key('#LNMODE 3'));
  expect(key('#OPTION charatbeatHDX:LONGMODE 0')).not.toBe(key('#OPTION charatbeatHDX:LONGMODE 1'));
  expect(key('#LNMODE 1\n#OPTION charatbeatHDX:LONGMODE 1')).toBe(key('#LNMODE 1'));
});
test.each([
  '#OPTION charatbeatHDX:LONGMODE 1\n#RANDOM 2\n#IF 1\n#OPTION charatbeatHDX:LONGMODE 0\n#ENDIF\n#ENDRANDOM',
  '#RANDOM 2\n#IF 1\n#OPTION charatbeatHDX:LONGMODE 0\n#ENDIF\n#ENDRANDOM\n#OPTION charatbeatHDX:LONGMODE 1',
  '#RANDOM 2\n#IF 1\n#OPTION charatbeatHDX:LONGMODE 0\n#ELSE\n#LNMODE 1\n#ENDIF\n#ENDRANDOM\n#OPTION charatbeatHDX:LONGMODE 1',
])('fingerprint branch composition matches actual resolved notes: %s', (headers) => {
  const chart = parseBMS(`${headers}\n${notes}`);
  const before = JSON.stringify(chart);
  const compose = createOutcomeComposer(chart, { chartPath: 'hdx.bms' });
  for (const value of [1, 2]) {
    const draws = [{ command: 'RANDOM' as const, range: 2, value }];
    expect(compose(draws)).toEqual(
      createPlayFingerprintDocument(resolveBMSControlFlowWithDraws(chart, draws), { chartPath: 'hdx.bms' }),
    );
  }
  expect(JSON.stringify(chart)).toBe(before);
  expect(
    expandChartFingerprintDocument(createChartFingerprintDocument(chart, { chartPath: 'hdx.bms' })).length,
  ).toBeGreaterThan(0);
  expect(computeChartFingerprint(chart, { chartPath: 'hdx.bms' })).toMatch(/^bmfp0:/);
});

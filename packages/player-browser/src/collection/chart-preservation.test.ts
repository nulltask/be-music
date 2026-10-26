import { expect, test } from 'vite-plus/test';
import { parseBMSBytes, resolveBMSControlFlowWithDraws } from '@be-music/chart-parser';
import { compactChartPreservation } from './chart-preservation.ts';

test('compaction retains WAV declaration order and branch gates while dropping formatting and objects', () => {
  const chart = parseBMSBytes(
    new TextEncoder().encode(
      '#TITLE Format\n#WAV09 aa.wav\n#RANDOM 2\n#IF 1\n#WAV01 bb.wav\n#ELSE\n#WAV01 cc.wav\n#ENDIF\n#ENDRANDOM\n#00111:01',
    ),
  );
  const expected = structuredClone(
    chart.preservation.bms.sourceLines.filter(
      (entry) => entry.kind === 'directive' || (entry.kind === 'header' && entry.command.startsWith('WAV')),
    ),
  );
  const original = chart.preservation.bms.sourceLines;
  compactChartPreservation(chart);
  expect(chart.preservation.bms.sourceLines).toEqual(expected);
  expect(chart.preservation.bms.objectLines).toEqual([]);
  expect(chart.bms.wavNameBytePrefixes).toEqual({ 'aa.wav': '6161', 'bb.wav': '6262', 'cc.wav': '6363' });
  expect(chart.preservation.bms.sourceLines[0]).not.toBe(
    original.find((entry) => entry.kind === 'header' && entry.command === 'WAV09'),
  );
  expect(resolveBMSControlFlowWithDraws(chart, [{ command: 'RANDOM', range: 2, value: 2 }]).resources.wav['01']).toBe(
    'cc.wav',
  );
  compactChartPreservation(chart);
  expect(chart.preservation.bms.sourceLines).toEqual(expected);
});

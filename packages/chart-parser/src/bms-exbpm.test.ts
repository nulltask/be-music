import { expect, test } from 'vite-plus/test';
import { createTimingResolver } from '../../chart-model/src/index.ts';
import { parseChart, resolveBMSControlFlow } from './index.ts';

function bms(...lines: string[]): string {
  return ['#TITLE exbpm', '#BPM 120', ...lines].join('\n');
}

test('BMS: #EXBPMxx defines the same slot as #BPMxx and drives channel 08', () => {
  const json = parseChart(bms('#EXBPM01 240', '#00108:01'), 'chart.bms');

  expect(json.resources.bpm).toEqual({ '01': 240 });
  expect(json.metadata.extras.EXBPM01).toBeUndefined();
  // Stored under the canonical spelling, so output writes `#BPM01`.
  expect(json.preservation.bms.sourceLines).toContainEqual({ kind: 'header', command: 'BPM01', value: '240' });
  expect(createTimingResolver(json).tempoPoints.map((point) => point.bpm)).toEqual([120, 240]);
});

test('BMS: #BPMxx and #EXBPMxx for one index follow the file-order rule', () => {
  expect(parseChart(bms('#BPM01 100', '#EXBPM01 200'), 'chart.bms').resources.bpm['01']).toBe(200);
  expect(parseChart(bms('#EXBPM01 200', '#BPM01 100'), 'chart.bms').resources.bpm['01']).toBe(100);
});

test('BMS: #EXBPMxx inside a branch applies when taken and yields to a later top-level #BPMxx', () => {
  const branched = parseChart(bms('#RANDOM 1', '#IF 1', '#EXBPM01 180', '#ENDIF', '#ENDRANDOM'), 'chart.bms');
  expect(branched.bms.controlFlow).toContainEqual({ kind: 'header', command: 'BPM01', value: '180' });
  expect(resolveBMSControlFlow(branched, { random: () => 0 }).resources.bpm['01']).toBe(180);

  const overridden = parseChart(
    bms('#RANDOM 1', '#IF 1', '#EXBPM01 180', '#ENDIF', '#ENDRANDOM', '#BPM01 90'),
    'chart.bms',
  );
  expect(resolveBMSControlFlow(overridden, { random: () => 0 }).resources.bpm['01']).toBe(90);
});

test('BMS: #EXBPMxx keeps a case-sensitive key under #BASE 62', () => {
  const json = parseChart(bms('#BASE 62', '#EXBPM0a 150', '#EXBPM0A 75'), 'chart.bms');
  expect(json.resources.bpm).toEqual({ '0a': 150, '0A': 75 });
});

test('Be-Music JSON: a legacy #EXBPMxx in metadata.extras migrates into resources.bpm unless #BPMxx defines it', () => {
  const legacy = parseChart(bms('#BPM02 90'), 'chart.bms');
  legacy.metadata.extras = { EXBPM01: '180', EXBPM02: '45' };

  const reparsed = parseChart(JSON.stringify(legacy), 'chart.json');
  expect(reparsed.resources.bpm).toEqual({ '01': 180, '02': 90 });
  expect(reparsed.metadata.extras).toEqual({});
});

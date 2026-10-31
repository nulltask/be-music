import { expect, test } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { stringifyBMS } from '@be-music/chart-writer';
import { createBeatResolver, createScrollTimeline, createTimingResolver } from './index.ts';

function chart(...lines: string[]) {
  return parseChart(
    ['#BPM 120', '#BPM01 100', '#BPM02 200', '#STOP01 48', '#STOP02 96', '#SCROLL01 2', '#SCROLL02 0.5', ...lines].join(
      '\n',
    ),
    'chart.bms',
  );
}

const tempoAtMeasure1 = (json: ReturnType<typeof chart>) => createTimingResolver(json).bpmAtBeat(4);
const stopSeconds = (json: ReturnType<typeof chart>) =>
  createTimingResolver(json).stopPoints.map((point) => point.seconds);
const scrollAtMeasure1 = (json: ReturnType<typeof chart>) =>
  createScrollTimeline(json, createBeatResolver(json))
    .filter((point) => point.beat === 4)
    .at(-1)?.speed;

// #133: duplicates on one channel at one position follow file order (the later line wins, as in beatoraja).
test.each([
  [['#00108:01', '#00108:02'], 200],
  [['#00108:02', '#00108:01'], 100],
])('the later of two #xxx08 lines at one position wins (%j)', (lines, bpm) => {
  expect(tempoAtMeasure1(chart(...lines))).toBe(bpm);
});

test.each([
  [['#00103:F0', '#00108:01'], 100],
  [['#00108:01', '#00103:F0'], 100],
])('#xxx08 still beats #xxx03 at one position whatever the line order, as in LR2 (%j)', (lines, bpm) => {
  expect(tempoAtMeasure1(chart(...lines))).toBe(bpm);
});

test.each([
  [['#00109:01', '#00109:02'], [1]],
  [['#00109:02', '#00109:01'], [0.5]],
])('two STOPs at one position apply once, the later line (%j)', (lines, seconds) => {
  expect(stopSeconds(chart(...lines))).toEqual(seconds);
});

test.each([
  [['#001SC:01', '#001SC:02'], 0.5],
  [['#001SC:02', '#001SC:01'], 2],
])('the later of two SCROLL lines at one position wins (%j)', (lines, speed) => {
  expect(scrollAtMeasure1(chart(...lines))).toBe(speed);
});

test('the winner survives Be-Music JSON and BMS round trips', () => {
  const source = chart('#00108:02', '#00108:01');
  expect(tempoAtMeasure1(parseChart(JSON.stringify(source), 'json'))).toBe(100);
  expect(tempoAtMeasure1(parseChart(stringifyBMS(source), 'chart.bms'))).toBe(100);
  source.metadata.title = 'Edited';
  source.preservation.bms.objectLines = [];
  expect(tempoAtMeasure1(parseChart(stringifyBMS(source), 'chart.bms'))).toBe(100);
});

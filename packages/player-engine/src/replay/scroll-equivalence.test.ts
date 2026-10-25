import { expect, test } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { preparePlaybackChart } from '../index.ts';
import { runRecordedPlay } from '../test-support/recorded-play.ts';
import { parseReplay, serializeReplay } from './format.ts';
import { simulateReplay } from './simulate.ts';

const variable = '#BPM 240\n#BPM01 480\n#STOP01 192\n#00111:01\n#00108:01\n#00209:01\n#00312:01';

test('scroll REMOVE preserves live judgment times, records actual effect and reproduces judgments and gauge', async () => {
  const json = parseChart(variable, 'bms');
  const inputs = [
    { seq: 0, timeUs: 1000000, action: 'down' as const, channels: ['11'] },
    { seq: 1, timeUs: 2500000, action: 'down' as const, channels: ['12'] },
  ];
  const run = await runRecordedPlay(json, inputs, 'beatoraja', { scrollModifier: 'REMOVE' });
  const replay = parseReplay(serializeReplay(run.replay));
  expect(run.summary.perfect).toBe(2);
  expect(replay.play).toMatchObject({ scrollModifier: 'REMOVE', scrollModifierChanged: true });
  expect(replay.chart.notes.map((note) => note.timeUs)).toEqual([1000000, 2500000]);
  const simulated = simulateReplay(replay, { ruleset: 'beatoraja' });
  expect(simulated.judge).toEqual(replay.results!.native!.judge);
  expect(simulated.gauge).toEqual(replay.results!.native!.gauge);
});

test('scroll REMOVE records selection without claiming a change on a constant chart', async () => {
  const run = await runRecordedPlay(parseChart('#BPM 240\n#00111:01', 'bms'), [], 'beatoraja', {
    scrollModifier: 'REMOVE',
  });
  expect(parseReplay(serializeReplay(run.replay)).play).toMatchObject({
    scrollModifier: 'REMOVE',
    scrollModifierChanged: false,
  });
});

test('scroll REMOVE rejects incompatible source rulesets', async () => {
  await expect(runRecordedPlay(parseChart(variable, 'bms'), [], 'lr2', { scrollModifier: 'REMOVE' })).rejects.toThrow(
    /only for beatoraja/,
  );
});

test('a shared scroll ADD chart records the effective curve and preserves live/replay judging', async () => {
  const json = parseChart(variable, 'bms');
  const preparedChart = preparePlaybackChart(
    resolveChart(json),
    { scrollModifier: 'ADD', scrollSection: 1, scrollRate: 1 },
    0,
    () => 0,
  );
  const run = await runRecordedPlay(
    json,
    [
      { seq: 0, timeUs: 1000000, action: 'down', channels: ['11'] },
      { seq: 1, timeUs: 2500000, action: 'down', channels: ['12'] },
    ],
    'beatoraja',
    { preparedChart },
  );
  const replay = parseReplay(serializeReplay(run.replay));
  expect(run.summary.perfect).toBe(2);
  expect(replay.play).toMatchObject({
    scrollModifier: 'ADD',
    scrollSection: 1,
    scrollRate: 1,
    scrollModifierTimeline: preparedChart.scrollModifierTimeline,
  });
  expect(replay.play.scrollModifierTimeline!.slice(0, 2)).toEqual([
    { beat: 0, speed: 1 },
    { beat: 0, speed: 0 },
  ]);
  const simulated = simulateReplay(replay, { ruleset: 'beatoraja' });
  expect(simulated.judge).toEqual(replay.results!.native!.judge);
  expect(simulated.gauge).toEqual(replay.results!.native!.gauge);
});

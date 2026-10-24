import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';
import { expect, test } from 'vite-plus/test';
import { runRecordedPlay } from '../test-support/recorded-play.ts';
import { parseReplay, serializeReplay, type ReplayInputEvent } from './format.ts';
import { simulateReplay } from './simulate.ts';

function chart(events: BeMusicJSON['events']): BeMusicJSON {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 240;
  json.metadata.rank = 2;
  json.events = events;
  return json;
}
function down(seq: number, timeUs: number, ...channels: string[]): ReplayInputEvent {
  return { seq, timeUs, action: 'down', channels };
}

test('BEST CLEAR records the original choice and resolves the highest surviving gauge in live/replay', async () => {
  const json = chart([
    { measure: 1, channel: '11', position: [0, 1], value: '01' },
    { measure: 2, channel: '12', position: [0, 1], value: '01' },
  ]);
  const run = await runRecordedPlay(json, [down(0, 2000000, '12')], 'beatoraja', {
    gauge: 'GROOVE',
    gaugeAutoShift: 'BEST_CLEAR',
    bottomShiftableGauge: 'EASY',
  });
  const replay = parseReplay(serializeReplay(run.replay));
  expect(replay.play).toMatchObject({ gauge: 'GROOVE', gaugeAutoShift: 'BEST_CLEAR', bottomShiftableGauge: 'EASY' });
  expect(run.summary.gauge).toMatchObject({ type: 'EX-HARD', cleared: true, failedMidPlay: false });
  expect(run.summary.gauge?.values?.HAZARD).toBe(0);
  expect(Object.keys(run.summary.gauge!.values!)).toHaveLength(6);
  const simulated = simulateReplay(replay, { ruleset: 'beatoraja' });
  expect(simulated.gauge).toEqual(replay.results!.native!.gauge);
  expect(simulated.judge).toEqual(replay.results!.native!.judge);
});

test('BEST CLEAR course replays restore every class gauge instead of refilling dead higher gauges', async () => {
  const json = chart([
    { measure: 1, channel: '11', position: [0, 1], value: '01' },
    { measure: 2, channel: '12', position: [0, 1], value: '01' },
  ]);
  const course = {
    kind: 'grade' as const,
    carryIn: { gauge: 40, combo: 0, maxCombo: 0, gauges: { CLASS: 60, EXCLASS: 40, EXHARDCLASS: 0 } },
  };
  const run = await runRecordedPlay(json, [down(0, 1000000, '11'), down(1, 2000000, '12')], 'beatoraja', {
    gauge: 'GROOVE',
    gaugeAutoShift: 'BEST_CLEAR',
    course,
  });
  const replay = parseReplay(serializeReplay(run.replay));
  expect(run.summary.gauge?.type).toBe('EXCLASS');
  expect(run.summary.gauge?.values?.EXHARDCLASS).toBe(0);
  expect(run.summary.gauge?.values?.CLASS).toBeGreaterThan(60);
  expect(replay.play.course?.carryIn?.gauges).toEqual(course.carryIn.gauges);
  const simulated = simulateReplay(replay, { ruleset: 'beatoraja' });
  expect(simulated.gauge).toEqual(replay.results!.native!.gauge);
  expect(simulated.judge).toEqual(replay.results!.native!.judge);
});

test('SELECT TO UNDER replay retains the original upper bound independently of the effective result', async () => {
  const json = chart([
    { measure: 1, channel: '11', position: [0, 1], value: '01' },
    { measure: 2, channel: '12', position: [0, 1], value: '01' },
  ]);
  const run = await runRecordedPlay(json, [], 'beatoraja', {
    gauge: 'GROOVE',
    gaugeAutoShift: 'SELECT_TO_UNDER',
    bottomShiftableGauge: 'EASY',
  });
  const replay = parseReplay(serializeReplay(run.replay));
  expect(replay.play).toMatchObject({
    gauge: 'GROOVE',
    gaugeAutoShift: 'SELECT_TO_UNDER',
    bottomShiftableGauge: 'EASY',
  });
  expect(run.summary.gauge?.type).toBe('EASY');
  expect(run.summary.gauge?.values?.['EX-HARD']).toBeGreaterThan(0);
  expect(run.summary.gauge?.cleared).toBe(false);
  expect(simulateReplay(replay, { ruleset: 'beatoraja' }).gauge).toEqual(replay.results!.native!.gauge);
});

import { expect, test } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { runRecordedPlay } from '../test-support/recorded-play.ts';
import { parseReplay, serializeReplay } from './format.ts';
import { simulateReplay } from './simulate.ts';

const json = parseChart('#BPM 240\n#00111:01\n#00212:01\n#00313:01', 'bms');

test('P.ATTACK records its identity and source deltas, with matching live/replay judgments and gauge', async () => {
  const run = await runRecordedPlay(
    json,
    [
      { seq: 0, timeUs: 1030000, action: 'down', channels: ['11'] },
      { seq: 1, timeUs: 2000000, action: 'down', channels: ['12'] },
      { seq: 2, timeUs: 3000000, action: 'down', channels: ['13'] },
    ],
    'lr2',
    { gauge: 'P-ATTACK' },
  );
  const replay = parseReplay(serializeReplay(run.replay));
  expect(replay.play.gauge).toBe('P-ATTACK');
  expect(run.summary.great).toBe(1);
  expect(run.summary.perfect).toBe(2);
  expect(run.summary.gauge!.current).toBeCloseTo(99.2);
  const simulated = simulateReplay(replay, { ruleset: 'lr2' });
  expect(simulated.judge).toEqual(replay.results!.native!.judge);
  expect(simulated.gauge).toEqual(replay.results!.native!.gauge);
});

test('P.ATTACK GOOD is fatal and remains fatal in replay simulation', async () => {
  const run = await runRecordedPlay(json, [{ seq: 0, timeUs: 1080000, action: 'down', channels: ['11'] }], 'lr2', {
    gauge: 'P-ATTACK',
  });
  const replay = parseReplay(serializeReplay(run.replay));
  expect(run.summary.good).toBe(1);
  expect(run.summary.gauge).toMatchObject({ current: 0, failedMidPlay: true, cleared: false });
  const simulated = simulateReplay(replay, { ruleset: 'lr2' });
  expect(simulated.judge).toEqual(replay.results!.native!.judge);
  expect(simulated.gauge).toEqual(replay.results!.native!.gauge);
});

test('P.ATTACK course carry is not refilled or softened at the next stage', async () => {
  const chart = parseChart('#BPM 240\n#00111:01', 'bms');
  const run = await runRecordedPlay(chart, [{ seq: 0, timeUs: 1030000, action: 'down', channels: ['11'] }], 'lr2', {
    gauge: 'P-ATTACK',
    course: { kind: 'grade', carryIn: { gauge: 31, combo: 0, maxCombo: 0 } },
  });
  expect(run.summary.gauge).toMatchObject({ type: 'P-ATTACK', initial: 31, current: 30, failedMidPlay: false });
  const replay = parseReplay(serializeReplay(run.replay));
  expect(simulateReplay(replay, { ruleset: 'lr2' }).gauge).toEqual(replay.results!.native!.gauge);
});

test('G.ATTACK records fixed GREAT damage and GOOD recovery with matching live/replay results', async () => {
  const run = await runRecordedPlay(
    json,
    [
      { seq: 0, timeUs: 1030000, action: 'down', channels: ['11'] },
      { seq: 1, timeUs: 2080000, action: 'down', channels: ['12'] },
      { seq: 2, timeUs: 3080000, action: 'down', channels: ['13'] },
    ],
    'lr2',
    { gauge: 'G-ATTACK' },
  );
  const replay = parseReplay(serializeReplay(run.replay));
  expect(replay.play.gauge).toBe('G-ATTACK');
  expect(run.summary).toMatchObject({ great: 1, good: 2, perfect: 0 });
  expect(run.summary.gauge!.current).toBeCloseTo(99.2);
  const simulated = simulateReplay(replay, { ruleset: 'lr2' });
  expect(simulated.judge).toEqual(replay.results!.native!.judge);
  expect(simulated.gauge).toEqual(replay.results!.native!.gauge);
});

test('G.ATTACK PGREAT on a very short chart is fatal, including in replay simulation', async () => {
  const run = await runRecordedPlay(json, [{ seq: 0, timeUs: 1000000, action: 'down', channels: ['11'] }], 'lr2', {
    gauge: 'G-ATTACK',
  });
  const replay = parseReplay(serializeReplay(run.replay));
  expect(run.summary.gauge).toMatchObject({ current: 0, failedMidPlay: true, cleared: false });
  const simulated = simulateReplay(replay, { ruleset: 'lr2' });
  expect(simulated.judge).toEqual(replay.results!.native!.judge);
  expect(simulated.gauge).toEqual(replay.results!.native!.gauge);
});

test('G.ATTACK expert-course carry retains its fixed GREAT drain across live/replay', async () => {
  const chart = parseChart('#BPM 240\n#00111:01', 'bms');
  const run = await runRecordedPlay(chart, [{ seq: 0, timeUs: 1030000, action: 'down', channels: ['11'] }], 'lr2', {
    gauge: 'G-ATTACK',
    course: { kind: 'expert', carryIn: { gauge: 31, combo: 0, maxCombo: 0 } },
  });
  expect(run.summary.gauge).toMatchObject({ type: 'G-ATTACK', initial: 31, current: 30 });
  const replay = parseReplay(serializeReplay(run.replay));
  expect(simulateReplay(replay, { ruleset: 'lr2' }).gauge).toEqual(replay.results!.native!.gauge);
});

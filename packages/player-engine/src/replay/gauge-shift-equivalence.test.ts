import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';
import { expect, test } from 'vite-plus/test';
import { runRecordedPlay } from '../test-support/recorded-play.ts';
import { parseReplay, serializeReplay, type ReplayInputEvent } from './format.ts';
import { rejudgeReplay } from './rejudge.ts';
import { simulateReplay } from './simulate.ts';

// Gauge auto-shift under every ruleset (#933): the live play and its replay agree, gauge by gauge.

function chart(events: BeMusicJSON['events']): BeMusicJSON {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 240;
  json.metadata.rank = 2;
  json.events = events;
  return json;
}
function down(seq: number, timeUs: number, ...channels: string[]): ReplayInputEvent {
  return { seq, timeUs, action: 'down', channels, source: 0 };
}
const NOTES = chart([
  { measure: 1, channel: '11', position: [0, 1], value: '01' },
  { measure: 2, channel: '12', position: [0, 1], value: '01' },
  { measure: 3, channel: '13', position: [0, 1], value: '01' },
]);

test('LR2 BEST CLEAR shifts down HAZARD, HARD, GROOVE, EASY and the replay re-simulates it', async () => {
  // The second note is missed: DEATH (LR2's HAZARD) dies, and so does HARD, whose damage a three-note chart multiplies
  // tenfold; GROOVE clears.
  const run = await runRecordedPlay(NOTES, [down(0, 1000000, '11'), down(1, 3000000, '13')], 'lr2', {
    gauge: 'GROOVE',
    gaugeAutoShift: 'BEST_CLEAR',
  });
  const replay = parseReplay(serializeReplay(run.replay));
  expect(replay.play).toMatchObject({ judgeRuleset: 'lr2', gauge: 'GROOVE', gaugeAutoShift: 'BEST_CLEAR' });
  expect(run.summary.gauge).toMatchObject({ type: 'GROOVE', cleared: true, failedMidPlay: false });
  expect(Object.keys(run.summary.gauge!.values!)).toEqual(['EASY', 'GROOVE', 'HARD', 'DEATH']);
  expect(run.summary.gauge?.values).toMatchObject({ HARD: 0, DEATH: 0 });
  const simulated = simulateReplay(replay, { ruleset: 'lr2' });
  expect(simulated.gauge).toEqual(replay.results!.native!.gauge);
  expect(simulated.judge).toEqual(replay.results!.native!.judge);
  // Deterministic: the same replay gives the same shift every time.
  expect(simulateReplay(replay, { ruleset: 'lr2' })).toEqual(simulated);
});

test('AC SURVIVAL TO GROOVE continues on NORMAL after EX-HARD empties, in the live play and the replay', async () => {
  // Eight missed notes empty AC's EX-HARD (18 per POOR).
  const misses = chart(
    Array.from({ length: 8 }, (_, index) => ({ measure: index + 1, channel: '11', position: [0, 1], value: '01' })),
  );
  const run = await runRecordedPlay(misses, [], '____', { gauge: 'EX-HARD', gaugeAutoShift: 'SURVIVAL_TO_GROOVE' });
  const replay = parseReplay(serializeReplay(run.replay));
  expect(run.summary.gauge?.type).toBe('NORMAL');
  expect(replay.play.endOnFailure).toBeUndefined();
  expect(simulateReplay(replay, { ruleset: '____' }).gauge).toEqual(replay.results!.native!.gauge);
});

test('LR2 SELECT TO UNDER never shifts above the picked gauge', async () => {
  const run = await runRecordedPlay(
    NOTES,
    [down(0, 1000000, '11'), down(1, 2000000, '12'), down(2, 3000000, '13')],
    'lr2',
    {
      gauge: 'HARD',
      gaugeAutoShift: 'SELECT_TO_UNDER',
    },
  );
  expect(run.summary.gauge?.type).toBe('HARD');
  expect(run.summary.gauge?.values?.DEATH).toBeGreaterThan(0);
  const replay = parseReplay(serializeReplay(run.replay));
  expect(simulateReplay(replay, { ruleset: 'lr2' }).gauge).toEqual(replay.results!.native!.gauge);
});

test('an LR2 grade course carries every grade gauge into the next stage', async () => {
  const course = {
    kind: 'grade' as const,
    carryIn: { gauge: 50, combo: 0, maxCombo: 0, gauges: { GRADE: 50, 'GRADE-HARD': 30, 'GRADE-DEATH': 0 } },
  };
  const run = await runRecordedPlay(
    NOTES,
    [down(0, 1000000, '11'), down(1, 2000000, '12'), down(2, 3000000, '13')],
    'lr2',
    {
      gauge: 'GROOVE',
      gaugeAutoShift: 'BEST_CLEAR',
      course,
    },
  );
  const replay = parseReplay(serializeReplay(run.replay));
  expect(run.summary.gauge?.type).toBe('GRADE-HARD');
  expect(run.summary.gauge?.values?.['GRADE-DEATH']).toBe(0);
  expect(replay.play.course?.carryIn?.gauges).toEqual(course.carryIn.gauges);
  expect(simulateReplay(replay, { ruleset: 'lr2' }).gauge).toEqual(replay.results!.native!.gauge);
});

test('a two-player play shifts both players’ gauges, as their replays re-simulate them', async () => {
  const json = chart([
    { measure: 1, channel: '11', position: [0, 1], value: '01' },
    { measure: 2, channel: '21', position: [0, 1], value: '01' },
  ]);
  const run = await runRecordedPlay(json, [down(0, 1000000, '11')], 'lr2', {
    gauge: 'DEATH',
    gauge2P: 'DEATH',
    battleMode: 'TWO-PLAYER',
    gaugeAutoShift: 'CONTINUE',
  });
  const replay = parseReplay(serializeReplay(run.replay));
  // The 2P note is missed: CONTINUE plays the 2P side to the end on its emptied gauge instead of stopping the play.
  expect(run.summary.secondPlayer?.gauge).toMatchObject({ type: 'DEATH', failedMidPlay: true });
  expect(run.summary.gauge).toMatchObject({ type: 'DEATH', failedMidPlay: false });
  expect(simulateReplay(replay, { ruleset: 'lr2', player: 2 }).gauge).toMatchObject({ failedMidPlay: true });
});

test('a beatoraja BEST CLEAR replay is re-judged under LR2 along LR2’s ladder', async () => {
  const run = await runRecordedPlay(NOTES, [down(0, 1000000, '11'), down(1, 3000000, '13')], 'beatoraja', {
    gauge: 'GROOVE',
    gaugeAutoShift: 'BEST_CLEAR',
  });
  const replay = parseReplay(serializeReplay(run.replay));
  const outcome = rejudgeReplay(replay, { ruleset: 'lr2' });
  expect(outcome.status).toBe('simulated');
  if (outcome.status !== 'simulated') return;
  expect(Object.keys(outcome.result.gauge.values ?? {})).toEqual(['EASY', 'GROOVE', 'HARD', 'DEATH']);
  expect(outcome.result.gauge.type).toBe('GROOVE');
  expect(outcome.result.gauge.values).toMatchObject({ HARD: 0, DEATH: 0 });
});

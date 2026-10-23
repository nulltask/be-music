import { createEmptyJSON } from '@be-music/chart-source';
import { expect, test } from 'vite-plus/test';
import { observePlay, tap } from './harness.ts';

test.each([
  [960, 0],
  [960.001, 1],
  [970, 1],
  [1000, 1],
  [1000.001, 0],
  [1010, 0],
] as const)('LR2 mine press at %d ms counts %d POOR', async (atMs, poor) => {
  const chart = createEmptyJSON('bms');
  chart.metadata.bpm = 240;
  chart.metadata.rank = 2;
  chart.metadata.total = 1;
  chart.events = [
    { measure: 1, channel: 'D1', position: [0, 1], value: '0A' },
    { measure: 2, channel: '12', position: [0, 1], value: '01' },
  ];
  const play = await observePlay({
    driver: 'manual',
    chart,
    options: { judgeRuleset: 'lr2' },
    script: [...tap(atMs, '11', 0.001), ...tap(2000, '12')],
  });
  expect(play.summary).toMatchObject({ total: 1, perfect: 1, poor, emptyPoor: 0, exScore: 2, maxCombo: 1 });
  expect(play.summary!.gauge!.current).toBe(poor ? 11 : 21);
  const { ruleset: _native, ...native } = play.replay!.results!.native!;
  const { ruleset: _simulated, ...simulated } = play.simulated!.lr2!;
  expect(native).toEqual(simulated);
});

test.each([
  ['lr2', 200, 1200, 1],
  ['lr2', 960, 990, 0],
  ['beatoraja', 200, 1200, 0],
  ['beatoraja', 970, 980, 0],
  ['____', 970, 980, 0],
] as const)('%s held from %d to %d ms counts %d POOR', async (judgeRuleset, downMs, upMs, poor) => {
  const chart = createEmptyJSON('bms');
  chart.metadata.bpm = 240;
  chart.metadata.rank = 2;
  chart.events = [{ measure: 1, channel: 'D1', position: [0, 1], value: '0A' }];
  const play = await observePlay({
    driver: 'manual',
    chart,
    options: { judgeRuleset },
    script: tap(downMs, '11', upMs - downMs),
  });
  expect(play.summary).toMatchObject({ total: 0, poor, exScore: 0, maxCombo: 0 });
  expect(play.summary!.gauge!.current).toBe(play.summary!.gauge!.initial - (downMs === 200 ? 10 : 0));
  const { ruleset: _native, ...native } = play.replay!.results!.native!;
  const { ruleset: _simulated, ...simulated } = play.simulated![judgeRuleset]!;
  expect(native).toEqual(simulated);
});

test('multiple presses cannot charge the same LR2 mine twice or break the note combo', async () => {
  const chart = createEmptyJSON('bms');
  chart.metadata.bpm = 240;
  chart.metadata.rank = 2;
  chart.events = [
    { measure: 0, channel: '12', position: [1, 2], value: '01' },
    { measure: 1, channel: 'D1', position: [0, 1], value: '0A' },
    { measure: 2, channel: '12', position: [0, 1], value: '01' },
  ];
  const play = await observePlay({
    driver: 'manual',
    chart,
    options: { judgeRuleset: 'lr2' },
    script: [...tap(500, '12'), ...tap(970, '11', 1), ...tap(980, '11', 1), ...tap(1010, '11', 1), ...tap(2000, '12')],
  });
  expect(play.summary).toMatchObject({ total: 2, perfect: 2, poor: 1, minePoor: 1, combo: 2, maxCombo: 2, exScore: 4 });
  expect(play.simulated!.lr2!).toMatchObject({ judge: { pgreat: 2, poor: 1 }, minePoor: 1, maxCombo: 2, exScore: 4 });
});

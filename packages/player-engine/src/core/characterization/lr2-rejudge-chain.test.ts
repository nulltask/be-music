import { createEmptyJSON } from '@be-music/chart-source';
import { expect, test } from 'vite-plus/test';
import { observePlay, tap } from './harness.ts';

test.each([
  [150, 1, 0, 0, 1, 1],
  [175, 0, 1, 0, 1, 1],
  [225, 0, 0, 1, 1, 1],
  [350, 0, 0, 0, 2, 1],
  [350.001, 0, 0, 0, 1, 2],
] as const)('LR2 one-press chain classifies the next tap at %d ms', async (nextMs, perfect, great, good, bad, poor) => {
  const chart = createEmptyJSON('bms');
  chart.metadata.bpm = 240;
  chart.metadata.rank = 2;
  chart.events = [0, nextMs, nextMs + 5].map((ms, index) => ({
    measure: 1,
    channel: '11',
    position: [Math.round(ms * 1000), 1_000_000],
    value: String(index + 1).padStart(2, '0'),
  }));
  const play = await observePlay({
    driver: 'manual',
    chart,
    options: { judgeRuleset: 'lr2' },
    script: tap(1150, '11'),
  });
  expect(play.summary).toMatchObject({ perfect, great, good, bad, poor, exScore: perfect * 2 + great });
  const { ruleset: _native, ...native } = play.replay!.results!.native!;
  const { ruleset: _simulated, ...simulated } = play.simulated!.lr2!;
  expect(native).toEqual(simulated);
});

test('LR2 chains multiple BADs, then stops after the first PGREAT', async () => {
  const chart = createEmptyJSON('bms');
  chart.metadata.bpm = 240;
  chart.metadata.rank = 2;
  chart.events = [0, 20, 150, 155].map((ms) => ({ measure: 1, channel: '11', position: [ms, 1000], value: '01' }));
  const play = await observePlay({
    driver: 'manual',
    chart,
    options: { judgeRuleset: 'lr2' },
    script: tap(1150, '11'),
  });
  expect(play.summary).toMatchObject({ perfect: 1, bad: 2, poor: 1, exScore: 2 });
  expect(play.simulated!.lr2!.judge).toMatchObject({ pgreat: 1, bad: 2, poor: 1 });
});

test.each(['lr2', 'beatoraja', 'iidx'] as const)('%s never chains through a long-note head', async (judgeRuleset) => {
  const chart = createEmptyJSON('bms');
  chart.metadata.bpm = 240;
  chart.metadata.rank = 2;
  chart.bms.lnObjs = ['AA'];
  chart.events = [
    { measure: 1, channel: '11', position: [0, 1000], value: '01' },
    { measure: 1, channel: '11', position: [100, 1000], value: '01' },
    { measure: 1, channel: '11', position: [400, 1000], value: 'AA' },
    { measure: 1, channel: '11', position: [450, 1000], value: '01' },
  ];
  const play = await observePlay({ driver: 'manual', chart, options: { judgeRuleset }, script: tap(1150, '11') });
  const { ruleset: _native, ...native } = play.replay!.results!.native!;
  const { ruleset: _simulated, ...simulated } = play.simulated![judgeRuleset]!;
  expect(native).toEqual(simulated);
  if (judgeRuleset === 'lr2') expect(native.judge).toMatchObject({ pgreat: 0, bad: 1, poor: 2 });
});

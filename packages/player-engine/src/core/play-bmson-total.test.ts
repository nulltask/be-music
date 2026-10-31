import { expect, test } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { observePlay, tap } from './characterization/harness.ts';
import { resolveRulesetConfig } from '../replay/rulesets.ts';
import { simulateReplay } from '../replay/simulate.ts';

const native = (total: number) =>
  parseChart(
    JSON.stringify({
      version: '1.0.0',
      info: { title: 'Zero TOTAL', mode_hint: 'beat-7k', init_bpm: 120, resolution: 240, judge_rank: 100, total },
      sound_channels: [
        {
          name: 'unused.wav',
          notes: [
            { x: 1, y: 240, l: 0, c: false },
            { x: 2, y: 480, l: 0, c: false },
          ],
        },
      ],
    }),
    'bmson',
  );

test.each(['lr2', 'beatoraja', '____'] as const)(
  '%s live play, recorded replay and simulation agree on no recovery',
  async (judgeRuleset) => {
    const play = await observePlay({
      driver: 'manual',
      chart: native(0),
      script: [...tap(500, '11'), ...tap(1000, '12')],
      options: { judgeRuleset, bmsonTotalMode: 'spec' },
    });
    expect(play.outcome).toBe('completed');
    expect(play.summary?.perfect).toBe(2);
    expect(play.replay?.play.bmsonTotalMode).toBe('spec');
    expect(play.replay?.chart.total).toBe(0);
    const replay = play.replay!;
    const initial = resolveRulesetConfig(replay, judgeRuleset).gauge.initial;
    expect(play.summary?.gauge?.current).toBe(initial);
    expect(simulateReplay(replay, { ruleset: judgeRuleset }).gauge.final).toBe(initial);
    delete replay.play.bmsonTotalMode;
    // Explicit viewer overrides never reinterpret a legacy replay.
    expect(
      resolveRulesetConfig(replay, judgeRuleset, { bmsonTotalMode: 'spec' }).gauge.recoveryDisabled,
    ).toBeUndefined();
  },
);

test('strict mode is a no-op for an authored positive total', async () => {
  const options = { driver: 'manual' as const, chart: native(100), script: [...tap(500, '11'), ...tap(1000, '12')] };
  const before = await observePlay(options);
  const after = await observePlay({ ...options, options: { bmsonTotalMode: 'spec' } });
  expect(after.summary).toEqual(before.summary);
  expect(after.replay?.chart.chartFingerprint).toBe(before.replay?.chart.chartFingerprint);
  expect(after.replay?.chart.playFingerprint).toBe(before.replay?.chart.playFingerprint);
});

test('negative native bmson TOTAL is normalized before strict play', async () => {
  const chart = native(-100);
  expect(chart.metadata.total).toBe(100);
  const play = await observePlay({
    driver: 'manual',
    chart,
    script: [...tap(500, '11'), ...tap(1000, '12')],
    options: { bmsonTotalMode: 'spec' },
  });
  expect(play.outcome).toBe('completed');
  expect(play.summary?.gauge?.current).toBeGreaterThan(20);
});

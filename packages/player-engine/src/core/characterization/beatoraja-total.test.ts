import { expect, test } from 'vite-plus/test';
import { simulateReplay } from '../../replay/simulate.ts';
import { longNoteChart } from './charts.ts';
import { observePlay } from './harness.ts';

test.each([2, 3] as const)(
  'CN/HCN mode %i gauge traces agree between engine and simulator with charge tails in TOTAL',
  async (lnMode) => {
    const chart = longNoteChart(lnMode);
    chart.metadata.total = 10;
    const checkpoints = [0.76, 1.26, 1.76, 2.26, 2.76, 3.76];
    const play = await observePlay({
      driver: 'auto',
      chart,
      options: { judgeRuleset: 'beatoraja' },
      captureAt: checkpoints,
    });
    expect(play.summary?.total).toBe(10);
    if (lnMode === 2) expect(play.summary?.gauge?.current).toBeCloseTo(30, 9);
    expect(play.summary?.gauge?.current).toBeCloseTo(play.simulated!.beatoraja!.gauge.final, 9);
    for (const seconds of checkpoints) {
      const replay = play.replay!;
      const partial = {
        ...replay,
        inputs: replay.inputs.filter((input) => input.timeUs < seconds * 1e6),
        play: { ...replay.play, aborted: true, abortedAtUs: seconds * 1e6 },
      };
      expect(play.captured?.[String(seconds)]?.gauge, `checkpoint ${seconds}`).toBeCloseTo(
        simulateReplay(partial, { ruleset: 'beatoraja' }).gauge.final,
        9,
      );
    }
  },
);

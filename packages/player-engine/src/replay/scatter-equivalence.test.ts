import { expect, test } from 'vite-plus/test';
import { createEmptyJSON } from '@be-music/chart-source';
import { resolveChart } from '@be-music/chart-model';
import { preparePlaybackChart } from '../index.ts';
import { randomizeLR2ScatterNotes } from '../lanes.ts';
import { runRecordedPlay } from '../test-support/recorded-play.ts';
import { parseReplay, serializeReplay } from './format.ts';
import { simulateReplay } from './simulate.ts';

test.each([false, true])(
  '9KEY SCATTER corrected=%s keeps unreachable objects scorable and replay judgments equivalent',
  async (correctedNineKey) => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 240;
    json.events = [{ measure: 1, channel: '11', position: [0, 1], value: '01' }];
    const preparedChart = preparePlaybackChart(resolveChart(json, { playVariant: '9' }));
    const lanes = ['11', '12', '13', '14', '15', '22', '23', '24', '25'];
    const [channel] = randomizeLR2ScatterNotes([{ channel: '11', timeMs: 1000 }], lanes, {
      random: () => 0.999,
      correctedNineKey,
    });
    preparedChart.notes[0]!.channel = channel!;
    const mode = correctedNineKey ? 'SCATTER-CORRECTED' : 'SCATTER';
    const run = await runRecordedPlay(json, [{ seq: 0, action: 'down', timeUs: 1000000, channels: ['25'] }], 'lr2', {
      preparedChart,
      recordReplay: { randomLane: { p1: mode }, options: { random1P: mode } },
    });
    expect(run.summary.total).toBe(1);
    expect(run.summary.perfect).toBe(correctedNineKey ? 1 : 0);
    expect(run.summary.poor).toBe(correctedNineKey ? 0 : 1);
    const replay = parseReplay(serializeReplay(run.replay));
    expect(replay.chart.notes[0]!.channel).toBe(correctedNineKey ? '25' : '26');
    expect(replay.play.options?.random1P).toBe(mode);
    const simulated = simulateReplay(replay, { ruleset: 'lr2' });
    expect(simulated.judge).toEqual(replay.results!.native!.judge);
    expect(simulated.gauge).toEqual(replay.results!.native!.gauge);
  },
);

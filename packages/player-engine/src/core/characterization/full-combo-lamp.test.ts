import { resolveChart } from '@be-music/chart-model';
import { expect, test } from 'vite-plus/test';
import { resolveRulesetResultLamp } from '../../replay/result-lamp.ts';
import { recordPlayFromSummary } from '../../records/best-record.ts';
import { basicChart } from './charts.ts';
import { observePlay, tap } from './harness.ts';

test('a low-TOTAL LR2 chart earns FULL COMBO even though its physical gauge never reaches the clear border', async () => {
  const chart = basicChart();
  chart.metadata.total = 1;
  const play = await observePlay({
    driver: 'manual',
    chart,
    script: resolveChart(chart).notes.flatMap((note) => tap(note.seconds * 1000, note.channel)),
  });
  expect(play.summary).toMatchObject({ perfect: 11, gauge: { cleared: false } });
  expect(resolveRulesetResultLamp(play.replay!.results!.native!, 'lr2')).toBe('FULL_COMBO');
  expect(recordPlayFromSummary(play.summary!, 11, 'lr2').lamp).toBe('FULL_COMBO');
});

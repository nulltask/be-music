import { resolveChart } from '@be-music/chart-model';
import { expect, test } from 'vite-plus/test';
import { basicChart } from './charts.ts';
import { observePlay, tap } from './harness.ts';

test('VERY EASY beatoraja presses inside the expanded BAD window agree between engine and replay simulation', async () => {
  const chart = basicChart();
  chart.metadata.rank = 4;
  const play = await observePlay({
    driver: 'manual',
    chart,
    options: { judgeRuleset: 'beatoraja' },
    script: resolveChart(chart).notes.flatMap((note, index) =>
      tap(note.seconds * 1000 + (index === 0 ? -250 : index === 1 ? 300 : 0), note.channel),
    ),
  });
  expect(play.summary).toMatchObject({ perfect: 9, bad: 2, poor: 0, emptyPoor: 0 });
  expect(play.simulated?.['beatoraja']?.judge).toMatchObject({ pgreat: 9, bad: 2, poor: 0, emptyPoor: 0 });
});

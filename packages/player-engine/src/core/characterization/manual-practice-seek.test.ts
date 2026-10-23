import { describe, expect, test } from 'vite-plus/test';
import { basicChart, longNoteChart } from './charts.ts';
import { command, observePlay, tap } from './harness.ts';

describe('manual practice seek', () => {
  for (const judgeRuleset of ['lr2', 'beatoraja', '____'] as const) {
    test(`${judgeRuleset}: resets score and skips earlier notes without recording a replay`, async () => {
      const play = await observePlay({
        driver: 'manual',
        chart: basicChart(),
        options: { judgeRuleset, endOnFailure: false },
        script: [...tap(500, '11'), command(600, { kind: 'seek', seconds: 3 }), ...tap(600, '12')],
      });
      expect(play.summary!.perfect).toBe(1);
      expect(play.summary!.poor).toBe(1);
      expect(play.summary!.exScore).toBe(2);
      expect(play.replay).toBeUndefined();
    });
    test(`${judgeRuleset}: seeking back creates fresh input and judge state`, async () => {
      const play = await observePlay({
        driver: 'manual',
        chart: basicChart(),
        options: { judgeRuleset, endOnFailure: false },
        script: [...tap(500, '11'), command(700, { kind: 'seek', seconds: 0 }), ...tap(1200, '11')],
      });
      expect(play.summary!.perfect).toBe(1);
      expect(play.summary!.exScore).toBe(2);
      expect(play.replay).toBeUndefined();
    });
  }
  test('skips the tail of a long note held before the seek', async () => {
    const play = await observePlay({
      driver: 'manual',
      chart: longNoteChart(3),
      options: { judgeRuleset: 'beatoraja', endOnFailure: false },
      script: [...tap(500, '11', 1500), command(700, { kind: 'seek', seconds: 1.2 })],
    });
    expect(play.summary!.perfect).toBe(0);
    expect(play.replay).toBeUndefined();
  });
});

test('manual practice seeks preserve pause and reset the gauge after earlier misses', async () => {
  const play = await observePlay({
    driver: 'manual',
    chart: basicChart(),
    options: { endOnFailure: false },
    script: [
      command(2000, { kind: 'toggle-pause' }),
      command(2100, { kind: 'seek', seconds: 3 }),
      command(2300, { kind: 'seek', seconds: 0 }),
      command(2500, { kind: 'toggle-pause' }),
    ],
  });
  expect(play.frames.generations?.[0]).toMatch(/seconds=3 .*paused/);
  expect(play.frames.generations?.[1]).toMatch(/seconds=0 .*paused/);
  expect(play.ui.filter((entry) => entry.includes('seek'))).toHaveLength(2);
});

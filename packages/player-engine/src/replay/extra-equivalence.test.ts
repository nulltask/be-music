import { expect, test } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { preparePlaybackChart } from '../index.ts';
import { runRecordedPlay } from '../test-support/recorded-play.ts';
import { parseReplay, serializeReplay } from './format.ts';
import { simulateReplay } from './simulate.ts';

for (const extraNoteScratch of [false, true]) {
  test(`EXTRA records the effective population and simulates with scratch=${extraNoteScratch}`, async () => {
    const json = parseChart('#BPM 240\n#00101:01\n#00101:01\n#00201:02\n#00212:03', 'bms');
    const options = { extraNoteDepth: 2, extraNoteScratch };
    const preparedChart = preparePlaybackChart(resolveChart(json), options);
    const inputs = preparedChart.notes
      .flatMap((note, index) => [
        { seq: index * 2, action: 'down' as const, channels: [note.channel], timeUs: Math.round(note.seconds * 1e6) },
        {
          seq: index * 2 + 1,
          action: 'up' as const,
          channels: [note.channel],
          timeUs: Math.round(note.seconds * 1e6) + 20000,
        },
      ])
      .sort((a, b) => a.timeUs - b.timeUs)
      .map((input, seq) => ({ ...input, seq }));
    const played = await runRecordedPlay(json, inputs, 'beatoraja', { ...options, preparedChart });
    expect(played.summary.perfect).toBe(3);
    const replay = parseReplay(serializeReplay(played.replay));
    expect(replay.play).toMatchObject({ ...options, extraNoteChangeCount: 3 });
    expect(replay.chart.noteCount).toBe(3);
    const simulated = simulateReplay(replay, { ruleset: 'beatoraja' });
    expect(simulated.judge).toMatchObject({ pgreat: 3, great: 0, good: 0, bad: 0, poor: 0 });
    expect(simulated.gauge.final).toBeCloseTo(played.summary.gauge!.current);
  });
}

test('EXTRA plays and records under every judge ruleset, including a host-prepared chart', async () => {
  const json = parseChart('#BPM 240\n#00101:01', 'bms');
  for (const ruleset of ['lr2', '____'] as const) {
    const preparedChart = preparePlaybackChart(resolveChart(json), { extraNoteDepth: 1 });
    const played = await runRecordedPlay(json, [], ruleset, { preparedChart });
    expect(played.replay.play).toMatchObject({ judgeRuleset: ruleset, extraNoteDepth: 1, extraNoteChangeCount: 1 });
  }
});

test('host-prepared EXTRA is recorded even when the host omits the duplicated engine selection', async () => {
  const json = parseChart('#BPM 240\n#00101:01', 'bms');
  const preparedChart = preparePlaybackChart(resolveChart(json), { extraNoteDepth: 1, extraNoteScratch: true });
  const played = await runRecordedPlay(json, [], 'beatoraja', { preparedChart });
  expect(played.replay.play).toMatchObject({ extraNoteDepth: 1, extraNoteScratch: true, extraNoteChangeCount: 1 });
  await expect(runRecordedPlay(json, [], 'beatoraja', { preparedChart, extraNoteDepth: 0 })).rejects.toThrow(
    /shared prepared chart/,
  );
});

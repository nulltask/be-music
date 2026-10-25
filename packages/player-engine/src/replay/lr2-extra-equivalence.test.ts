import { expect, test } from 'vite-plus/test';
import { parseBMSBytes } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { preparePlaybackChart } from '../index.ts';
import { runRecordedPlay } from '../test-support/recorded-play.ts';
import { parseReplay, serializeReplay } from './format.ts';
import { simulateReplay } from './simulate.ts';

const json = () =>
  parseBMSBytes(
    new TextEncoder().encode('#BPM 240\n#WAV01 ki-1.wav\n#WAV02 ki-2.wav\n#00111:01\n#00201:02\n#00311:01'),
  );

test('LR2 EXTRA records its source parameters, effective notes and deterministic simulation', async () => {
  const chart = json();
  const options = { lr2ExtraMode: true, lr2ExtraLevel: 0 } as const;
  const preparedChart = preparePlaybackChart(resolveChart(chart), { ...options, speed: 16 });
  const input = preparedChart.notes.flatMap((note, index) => [
    { seq: index * 2, timeUs: Math.round(note.seconds * 1e6), action: 'down' as const, channels: [note.channel] },
    {
      seq: index * 2 + 1,
      timeUs: Math.round(note.seconds * 1e6) + 20000,
      action: 'up' as const,
      channels: [note.channel],
    },
  ]);
  const played = await runRecordedPlay(chart, input, 'lr2', { ...options, preparedChart });
  const replay = parseReplay(serializeReplay(played.replay));
  expect(replay.play).toMatchObject({
    ...options,
    lr2ExtraEffectiveLevel: 0,
    lr2ExtraConvertedObjectCount: 1,
    lr2ExtraTempo: 16,
  });
  expect(replay.chart.noteCount).toBe(3);
  expect(played.summary.perfect).toBe(3);
  expect(simulateReplay(replay, { ruleset: 'lr2' }).judge).toMatchObject({
    pgreat: 3,
    great: 0,
    good: 0,
    bad: 0,
    poor: 0,
  });
});

test('LR2 EXTRA remains selected outside a course but has no effective conversion inside one', () => {
  const chart = parseBMSBytes(new TextEncoder().encode('#BPM 120\n#LNOBJ ZZ\n#00111:01\n#00211:ZZ\n#00101:01'));
  const prepared = preparePlaybackChart(resolveChart(chart), {
    lr2ExtraMode: true,
    lr2ExtraLevel: 2,
    course: { kind: 'expert' },
  });
  expect(prepared).toMatchObject({ lr2ExtraMode: false, lr2ExtraLevel: 2, lr2ExtraConvertedObjectCount: 0 });
  expect(prepared.notes).toHaveLength(1);
  expect(prepared.notes[0]!.endSeconds).toBeDefined();
});

test('the engine rejects incompatible rulesets and mismatched host-prepared EXTRA selections', async () => {
  const chart = json();
  const preparedChart = preparePlaybackChart(resolveChart(chart), { lr2ExtraMode: true, lr2ExtraLevel: 1 });
  await expect(runRecordedPlay(chart, [], 'beatoraja', { preparedChart })).rejects.toThrow(/requires LR2/);
  await expect(runRecordedPlay(chart, [], 'lr2', { preparedChart, lr2ExtraMode: false })).rejects.toThrow(
    /shared prepared chart/,
  );
  await expect(runRecordedPlay(chart, [], 'lr2', { preparedChart, lr2ExtraLevel: 2 })).rejects.toThrow(/EXTRA level/);
});

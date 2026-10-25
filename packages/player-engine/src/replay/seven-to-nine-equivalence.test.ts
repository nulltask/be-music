import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { autoPlay, preparePlaybackChart } from '../index.ts';
import { applySevenToNine } from '../lanes.ts';
import { runRecordedPlay } from '../test-support/recorded-play.ts';
import { parseReplay, serializeReplay, type BeMusicReplay } from './format.ts';
import { simulateReplay } from './simulate.ts';

const chart = () => parseBMS('#BPM 240\n#WAV01 ki.wav\n#LNOBJ ZZ\n#00116:01\n#00111:0001\n#00218:01\n#00318:ZZ');

test('7-to-9 records effective nine-key input, source parameters and holds and re-simulates them', async () => {
  const json = chart();
  const preparedChart = preparePlaybackChart(resolveChart(json, { playVariant: '7' }));
  applySevenToNine(preparedChart, { sevenToNinePattern: 6, sevenToNineType: 2, hRandomThresholdBPM: 180 });
  const inputs = preparedChart.notes
    .flatMap((note, index) => [
      { seq: index * 2, timeUs: Math.round(note.seconds * 1e6), action: 'down' as const, channels: [note.channel] },
      {
        seq: index * 2 + 1,
        timeUs: Math.round((note.endSeconds ?? note.seconds + 0.01) * 1e6),
        action: 'up' as const,
        channels: [note.channel],
      },
    ])
    .sort((a, b) => a.timeUs - b.timeUs)
    .map((input, seq) => ({ ...input, seq }));
  const played = await runRecordedPlay(json, inputs, 'beatoraja', { preparedChart });
  const replay = parseReplay(serializeReplay(played.replay));
  expect(replay.play).toMatchObject({
    sevenToNinePattern: 6,
    sevenToNineType: 2,
    sevenToNineThresholdBPM: 180,
    sevenToNineApplied: true,
  });
  expect(replay.chart.laneMode).toContain('9 KEY');
  expect(replay.chart.notes.some((note) => note.type === 'long')).toBe(true);
  expect(played.summary.perfect).toBe(3);
  expect(simulateReplay(replay, { ruleset: 'beatoraja' }).judge).toMatchObject({
    pgreat: 3,
    great: 0,
    good: 0,
    bad: 0,
    poor: 0,
  });
});

test('the engine applies 7-to-9 itself when a host does not supply prepared notes', async () => {
  let recorded: BeMusicReplay | undefined;
  await autoPlay(chart(), {
    audio: false,
    tui: false,
    speed: 16,
    leadInMs: 0,
    judgeRuleset: 'beatoraja',
    sevenToNinePattern: 3,
    sevenToNineType: 1,
    recordReplay: {},
    onReplayRecorded: (replay) => {
      recorded = replay;
    },
  });
  expect(recorded?.chart.laneMode).toContain('9 KEY');
  expect(recorded?.play).toMatchObject({ sevenToNinePattern: 3, sevenToNineApplied: true });
  await expect(
    autoPlay(chart(), { audio: false, tui: false, judgeRuleset: 'lr2', sevenToNinePattern: 3 }),
  ).rejects.toThrow(/only for beatoraja/);
});

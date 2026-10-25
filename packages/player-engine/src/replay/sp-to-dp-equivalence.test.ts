import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { autoPlay, preparePlaybackChart } from '../index.ts';
import { runRecordedPlay } from '../test-support/recorded-play.ts';
import { parseReplay, serializeReplay, type BeMusicReplay } from './format.ts';
import { simulateReplay } from './simulate.ts';

const chart = () => parseBMS('#BPM 240\n#WAV01 ki.wav\n#WAV02 cl.wav\n#00111:01\n#00112:0002\n#00211:01\n#00212:0002');

for (const playVariant of ['5', '7'] as const) {
  test(`SP TO DP records effective ${playVariant === '5' ? '10' : '14'}KEY notes and re-simulates both sides`, async () => {
    const json = chart();
    const preparedChart = preparePlaybackChart(resolveChart(json, { playVariant }), {
      battleMode: 'SP-TO-DP',
      speed: 16,
    });
    const inputs = preparedChart.notes.flatMap((note, index) => [
      { seq: index * 2, timeUs: Math.round(note.seconds * 1e6), action: 'down' as const, channels: [note.channel] },
      {
        seq: index * 2 + 1,
        timeUs: Math.round(note.seconds * 1e6) + 10000,
        action: 'up' as const,
        channels: [note.channel],
      },
    ]);
    const played = await runRecordedPlay(json, inputs, 'lr2', { preparedChart, battleMode: 'SP-TO-DP' });
    const replay = parseReplay(serializeReplay(played.replay));
    expect(replay.play).toMatchObject({
      battleMode: 'SP-TO-DP',
      battleSourceVariant: playVariant,
      battleTempo: 16,
      battleAssist1P: false,
      battleAssist2P: false,
    });
    // The 10-key mode is labelled `5 KEY DP`, the 14-key one `14 KEY DP`.
    expect(replay.chart.laneMode).toBe(playVariant === '5' ? '5 KEY DP' : '14 KEY DP');
    expect(replay.chart.noteCount).toBe(4);
    expect(replay.chart.notes.some((note) => note.channel.startsWith('2'))).toBe(true);
    expect(played.summary.perfect).toBe(4);
    expect(simulateReplay(replay, { ruleset: 'lr2' }).judge).toMatchObject({
      pgreat: 4,
      great: 0,
      good: 0,
      bad: 0,
      poor: 0,
    });
  });
}

test('AUTO keeps the source scratch configuration for layout reproduction independently of manual assists', async () => {
  const json = parseBMS('#BPM 240\n#00116:01\n#00111:0001\n#00113:000001');
  let recorded: BeMusicReplay | undefined;
  await autoPlay(json, {
    audio: false,
    tui: false,
    speed: 16,
    leadInMs: 0,
    judgeRuleset: 'lr2',
    battleMode: 'SP-TO-DP',
    autoScratch2P: true,
    recordReplay: {},
    onReplayRecorded: (replay) => {
      recorded = replay;
    },
  });
  const replay = parseReplay(serializeReplay(recorded!));
  expect(replay.play).toMatchObject({
    mode: 'auto',
    battleMode: 'SP-TO-DP',
    battleAssist2P: true,
    autoScratch2P: false,
  });
});

test('source-only battle modes and mismatched prepared layouts fail before judging', async () => {
  const json = chart();
  const preparedChart = preparePlaybackChart(resolveChart(json, { playVariant: '7' }), { battleMode: 'SP-TO-DP' });
  await expect(runRecordedPlay(json, [], 'beatoraja', { preparedChart })).rejects.toThrow(/requires LR2/);
  await expect(runRecordedPlay(json, [], 'lr2', { preparedChart, battleMode: 'OFF' })).rejects.toThrow(
    /shared prepared chart/,
  );
});

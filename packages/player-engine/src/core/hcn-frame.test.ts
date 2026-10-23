import { describe, expect, test } from 'vite-plus/test';
import { basicChart, longNoteChart } from './characterization/charts.ts';
import { command, observePlay, type CharacterizationPlay } from './characterization/harness.ts';

async function states(options: Partial<CharacterizationPlay> = {}) {
  const samples: Array<{ seconds: number; gaining?: boolean }> = [];
  await observePlay({
    driver: 'manual',
    chart: longNoteChart(3),
    options: { judgeRuleset: 'beatoraja' },
    reportsKeyReleases: true,
    script: [
      { atMs: 500, down: ['11'] },
      { atMs: 800, up: ['11'] },
      { atMs: 1100, down: ['11'] },
    ],
    ...options,
    onFrame: (frame) => {
      options.onFrame?.(frame);
      samples.push({
        seconds: frame.currentSeconds,
        gaining: frame.hcnLanes?.find((lane) => lane.channel === '11')?.gaining,
      });
    },
  });
  return samples;
}

describe('HCN UI frame facts from the existing judge', () => {
  test('switches active, damage and rehold state, then stops at the tail', async () => {
    const samples = await states();
    const at = (seconds: number) => samples.find((sample) => sample.seconds >= seconds)?.gaining;
    expect(at(0.4)).toBeUndefined();
    expect(at(0.6)).toBe(true);
    expect(at(0.9)).toBe(false);
    expect(at(1.2)).toBe(true);
    expect(at(1.6)).toBeUndefined();
  });
  test('AUTO reports HCNs as gaining; LR2 plain LNs never report HCN state', async () => {
    const auto = await states({ driver: 'auto', script: [] });
    expect(auto.find((sample) => sample.seconds >= 0.6)?.gaining).toBe(true);
    const lr2 = await states({ options: { judgeRuleset: 'lr2' } });
    expect(lr2.every((sample) => sample.gaining === undefined)).toBe(true);
  });
  test('a missed HCN head begins damage only once judged, and a later hold gains again', async () => {
    const samples = await states({ script: [{ atMs: 1000, down: ['11'] }] });
    expect(samples.find((sample) => sample.seconds >= 0.5)?.gaining).toBeUndefined();
    expect(samples.find((sample) => sample.seconds >= 0.9)?.gaining).toBe(false);
    expect(samples.find((sample) => sample.seconds >= 1.1)?.gaining).toBe(true);
    expect(samples.find((sample) => sample.seconds >= 1.5)?.gaining).toBeUndefined();
  });
  test('a replay uses the same HCN display states as manual play', async () => {
    const replayInputs = [
      { timeUs: 500000, action: 'down', channels: ['11'] },
      { timeUs: 800000, action: 'up', channels: ['11'] },
      { timeUs: 1100000, action: 'down', channels: ['11'] },
    ] as const;
    const replay = await states({
      script: [],
      options: {
        judgeRuleset: 'beatoraja',
        replayInputs: [...replayInputs].map((input, seq) => ({ ...input, seq, channels: [...input.channels] })),
      },
    });
    for (const [at, expected] of [
      [0.6, true],
      [0.9, false],
      [1.2, true],
      [1.6, undefined],
    ] as const) {
      expect(replay.find((sample) => sample.seconds >= at)?.gaining).toBe(expected);
    }
  });
  test('an AUTO seek rebuilds a held HCN and clears it again when seeking before the head', async () => {
    const samples: Array<{ generation: number; channel?: string }> = [];
    await states({
      driver: 'auto',
      script: [command(300, { kind: 'seek', seconds: 1.2 }), command(600, { kind: 'seek', seconds: 0.2 })],
      onFrame: (frame) => {
        samples.push({ generation: frame.generation ?? 0, channel: frame.hcnLanes?.[0]?.channel });
      },
    });
    expect(samples.find((sample) => sample.generation === 1)?.channel).toBe('11');
    expect(samples.find((sample) => sample.generation === 2)?.channel).toBeUndefined();
  });
  test('the judged-note count excludes empty POOR under every ruleset', async () => {
    for (const judgeRuleset of ['lr2', 'beatoraja', 'iidx'] as const) {
      let atEarlyPress: number | undefined;
      await observePlay({
        driver: 'manual',
        chart: basicChart(),
        options: { judgeRuleset },
        script: [{ atMs: 100, down: ['11'] }],
        onFrame: (frame) => {
          if (frame.currentSeconds >= 0.2 && frame.currentSeconds < 0.3) atEarlyPress = frame.judgedNoteCount;
        },
      });
      expect(atEarlyPress).toBe(0);
    }
  });
  test('AUTO SCRATCH reports an HCN wheel while its existing pending hold gains', async () => {
    const samples: Array<{ seconds: number; gaining?: boolean }> = [];
    await states({
      options: { judgeRuleset: 'beatoraja', autoScratch: true },
      script: [],
      onFrame: (frame) =>
        samples.push({
          seconds: frame.currentSeconds,
          gaining: frame.hcnLanes?.find((lane) => lane.channel === '16')?.gaining,
        }),
    });
    expect(samples.find((sample) => sample.seconds >= 2.1)?.gaining).toBe(true);
    expect(samples.find((sample) => sample.seconds >= 2.6)?.gaining).toBeUndefined();
  });
});

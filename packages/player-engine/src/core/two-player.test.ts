import { expect, test } from 'vite-plus/test';
import { parseBMS } from '@be-music/chart-parser';
import { observePlay } from './characterization/harness.ts';

// 120 BPM: the notes on key 1 are at 0.5 s and 1.0 s.
const chart = (): ReturnType<typeof parseBMS> =>
  parseBMS('#PLAYER 1\n#BPM 120\n#TOTAL 200\n#WAV01 a.wav\n#00011:00010100');

test.each(['lr2', '____'] as const)(
  '%s: two players judge their own side with their own score, combo and gauge',
  async (ruleset) => {
    const play = await observePlay({
      driver: 'manual',
      chart: chart(),
      script: [
        { atMs: 500, down: ['11'] },
        { atMs: 550, up: ['11'] },
        { atMs: 1000, down: ['21'] },
        { atMs: 1050, up: ['21'] },
      ],
      options: { judgeRuleset: ruleset, battleMode: 'TWO-PLAYER', gauge: 'HARD', gauge2P: 'EASY' },
    });
    expect(play.outcome).toBe('completed');
    const first = play.summary!;
    const second = first.secondPlayer!;
    expect([first.total, first.perfect, first.poor, first.maxCombo]).toEqual([2, 1, 1, 1]);
    expect([second.total, second.perfect, second.poor, second.maxCombo]).toEqual([2, 1, 1, 1]);
    expect(first.gauge?.type).not.toBe(second.gauge?.type);
    const replay = play.replay!;
    expect(replay.play).toMatchObject({ battleMode: 'TWO-PLAYER', gauge2P: 'EASY' });
    expect(replay.results?.secondPlayer).toMatchObject({ judge: { pgreat: 1, poor: 1 } });
    expect(replay.inputs.map((input) => input.channels.join(','))).toEqual(['11', '11', '21', '21']);

    // The replay plays both players again.
    const replayed = await observePlay({
      driver: 'manual',
      chart: chart(),
      options: {
        judgeRuleset: ruleset,
        battleMode: 'TWO-PLAYER',
        gauge: 'HARD',
        gauge2P: 'EASY',
        replayInputs: replay.inputs,
      },
    });
    expect(replayed.summary?.perfect).toBe(1);
    expect(replayed.summary?.secondPlayer?.perfect).toBe(1);
  },
);

test('beatoraja has no two-player play', async () => {
  const play = await observePlay({
    driver: 'auto',
    chart: chart(),
    options: { judgeRuleset: 'beatoraja', battleMode: 'TWO-PLAYER' },
  });
  expect(play.outcome).toMatch(/^error: .*two-player/);
});

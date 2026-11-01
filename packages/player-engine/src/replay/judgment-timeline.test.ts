import { describe, expect, test } from 'vite-plus/test';
import {
  BE_MUSIC_REPLAY_FORMAT,
  BE_MUSIC_REPLAY_VERSION,
  type BeMusicReplay,
  type ReplayInputEvent,
  type ReplayNote,
} from './format.ts';
import { resolveReplayJudgmentTimeline } from './judgment-timeline.ts';
import { simulateReplay } from './simulate.ts';

function makeReplay(
  notes: ReplayNote[],
  inputs: Array<Omit<ReplayInputEvent, 'seq'>>,
  lnMode: 1 | 2 = 1,
): BeMusicReplay {
  return {
    format: BE_MUSIC_REPLAY_FORMAT,
    version: BE_MUSIC_REPLAY_VERSION,
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode,
      judgeRank: { percent: 75, sourceRank: 2 },
      noteCount: notes.length,
      notes: notes.map((note, id) => ({ ...note, id })),
    },
    inputs: inputs.map((input, seq) => ({ ...input, seq })),
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE' },
  };
}

const tap = (timeUs: number, channel = '11'): ReplayNote => ({ id: 0, channel, type: 'normal', timeUs });
const down = (timeUs: number, channel = '11'): Omit<ReplayInputEvent, 'seq'> => ({
  timeUs,
  action: 'down',
  channels: [channel],
});
const up = (timeUs: number, channel = '11'): Omit<ReplayInputEvent, 'seq'> => ({
  timeUs,
  action: 'up',
  channels: [channel],
});

describe('resolveReplayJudgmentTimeline', () => {
  test('lists each judgment with its lane, note, time and the running totals', () => {
    const replay = makeReplay(
      [tap(1_000_000), tap(2_000_000, '12'), tap(3_000_000)],
      [down(1_000_000), up(1_050_000), down(1_200_000, '12'), up(1_250_000, '12')],
    );
    const { events, result } = resolveReplayJudgmentTimeline(replay, { ruleset: 'lr2' });
    expect(events.map((event) => [event.judgment, event.channel, event.noteTimeUs, event.settlesNote])).toEqual([
      ['pgreat', '11', 1_000_000, true],
      ['empty-poor', '12', undefined, false],
      ['poor', '12', 2_000_000, true],
      ['poor', '11', 3_000_000, true],
    ]);
    expect(events[0]).toMatchObject({ atUs: 1_000_000, deltaUs: 0, combo: 1, maxCombo: 1, exScore: 2 });
    // A missed note is settled at its miss deadline, after its time.
    expect(events[2]!.atUs).toBeGreaterThan(2_000_000);
    expect(events.at(-1)).toMatchObject({ combo: 0, maxCombo: 1, exScore: 2 });
    for (let index = 1; index < events.length; index += 1)
      expect(events[index]!.atUs).toBeGreaterThanOrEqual(events[index - 1]!.atUs);
    expect(result).toEqual(simulateReplay(replay, { ruleset: 'lr2' }));
  });

  test('a charge note scores its head without settling the note, and its tail settles it', () => {
    const replay = makeReplay(
      [{ id: 0, channel: '11', type: 'long', timeUs: 1_000_000, endTimeUs: 2_000_000, lnMode: 2 }],
      [down(1_000_000), up(2_000_000)],
      2,
    );
    const { events } = resolveReplayJudgmentTimeline(replay, { ruleset: 'beatoraja' });
    expect(events.map((event) => [event.judgment, event.settlesNote, event.atUs])).toEqual([
      ['pgreat', false, 1_000_000],
      ['pgreat', true, 2_000_000],
    ]);
    expect(events.every((event) => event.noteTimeUs === 1_000_000)).toBe(true);
  });

  test('records the gauge in percent after each judgment', () => {
    const { events, result } = resolveReplayJudgmentTimeline(makeReplay([tap(1_000_000)], [down(1_000_000)]), {
      ruleset: 'lr2',
    });
    expect(events.at(-1)!.gauge).toBeCloseTo(result.gauge.final);
  });
});

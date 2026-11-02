import { describe, expect, test } from 'vite-plus/test';
import {
  BE_MUSIC_REPLAY_FORMAT,
  BE_MUSIC_REPLAY_VERSION,
  type BeMusicReplay,
  type ReplayInputEvent,
  type ReplayNote,
} from '@be-music/player-engine/replay';
import { buildGhostTimeline, findGhostStepAt, isSinglePlayReplay } from './ghost-timeline.ts';

function makeGhostReplay(
  notes: ReplayNote[],
  inputs: Array<Omit<ReplayInputEvent, 'seq'>>,
  play: Partial<BeMusicReplay['play']> = {},
): BeMusicReplay {
  return {
    format: BE_MUSIC_REPLAY_FORMAT,
    version: BE_MUSIC_REPLAY_VERSION,
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode: 1,
      judgeRank: { percent: 75, sourceRank: 2 },
      noteCount: notes.filter((note) => note.type === 'normal' || note.type === 'long').length,
      notes: notes.map((note, id) => ({ ...note, id })),
    },
    inputs: inputs.map((input, seq) => ({ ...input, seq })),
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', ...play },
  };
}

const tap = (timeUs: number, channel = '11'): ReplayNote => ({ id: 0, channel, type: 'normal', timeUs });
const press = (timeUs: number, channel = '11'): Array<Omit<ReplayInputEvent, 'seq'>> => [
  { timeUs, action: 'down', channels: [channel] },
  { timeUs: timeUs + 50_000, action: 'up', channels: [channel] },
];

describe('buildGhostTimeline', () => {
  const replay = makeGhostReplay(
    [tap(1_000_000), tap(2_000_000, '12'), { id: 0, channel: '13', type: 'mine', timeUs: 2_500_000, damage: 10 }],
    press(1_000_000),
  );

  test('settles each note when the replay judged it, and keeps the mines apart', () => {
    const timeline = buildGhostTimeline(replay);
    expect(timeline.notes).toHaveLength(2);
    expect(timeline.notes[0]).toEqual({ channel: '11', seconds: 1, settledAtSeconds: 1 });
    // Never pressed: settled at its miss deadline, after its own time.
    expect(timeline.notes[1]!.settledAtSeconds).toBeGreaterThan(2);
    expect(timeline.mines).toEqual([{ channel: '13', seconds: 2.5 }]);
    expect(timeline.noteCount).toBe(2);
    expect(timeline.ruleset).toBe('lr2');
  });

  test('lists the judgments with the running totals, as the plates and HUD show them', () => {
    const { judgments } = buildGhostTimeline(replay);
    expect(judgments.map((step) => [step.judgment, step.channel, step.combo, step.exScore])).toEqual([
      ['PERFECT', '11', 1, 2],
      ['POOR', '12', 0, 2],
    ]);
    expect(judgments[1]!.counts).toEqual({ perfect: 1, great: 0, good: 0, bad: 0, poor: 1, emptyPoor: 0 });
    expect(judgments[1]!.maxCombo).toBe(1);
  });

  test('lists every press and release in time order', () => {
    expect(buildGhostTimeline(replay).inputs).toEqual([
      { seconds: 1, channel: '11', pressed: true },
      { seconds: 1.05, channel: '11', pressed: false },
    ]);
  });

  test('re-simulates under the replay’s own ruleset unless told another', () => {
    expect(buildGhostTimeline(makeGhostReplay([tap(1_000_000)], [], { judgeRuleset: 'beatoraja' })).ruleset).toBe(
      'beatoraja',
    );
    expect(buildGhostTimeline(replay, 'beatoraja').ruleset).toBe('beatoraja');
  });

  test('a long note goes with its last judgment', () => {
    const timeline = buildGhostTimeline(
      makeGhostReplay(
        [{ id: 0, channel: '11', type: 'long', timeUs: 1_000_000, endTimeUs: 2_000_000, lnMode: 1 }],
        [
          { timeUs: 1_000_000, action: 'down', channels: ['11'] },
          { timeUs: 2_000_000, action: 'up', channels: ['11'] },
        ],
      ),
    );
    expect(timeline.notes[0]).toMatchObject({ seconds: 1, endSeconds: 2, longNoteMode: 1, settledAtSeconds: 2 });
  });
});

describe('findGhostStepAt', () => {
  const steps = [{ seconds: 1 }, { seconds: 2 }, { seconds: 2 }, { seconds: 3 }];
  test('finds the last step at or before a second', () => {
    expect(findGhostStepAt(steps, 0.5)).toBe(-1);
    expect(findGhostStepAt(steps, 1)).toBe(0);
    expect(findGhostStepAt(steps, 2.5)).toBe(2);
    expect(findGhostStepAt(steps, 9)).toBe(3);
    expect(findGhostStepAt([], 1)).toBe(-1);
  });
});

describe('isSinglePlayReplay', () => {
  test('takes a replay whose notes are all on 1P lanes', () => {
    expect(isSinglePlayReplay(makeGhostReplay([tap(1), tap(2, '16')], []))).toBe(true);
    expect(isSinglePlayReplay(makeGhostReplay([tap(1), tap(2, '21')], []))).toBe(false);
  });
});

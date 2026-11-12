import { describe, expect, test } from 'vite-plus/test';
import {
  BE_MUSIC_REPLAY_FORMAT,
  BE_MUSIC_REPLAY_VERSION,
  type BeMusicReplay,
  type ReplayInputEvent,
  type ReplayNote,
} from './format.ts';
import { resolveReplayGaugeHistories } from './gauge-histories.ts';
import { resolveReplayJudgmentTimeline } from './judgment-timeline.ts';

function makeReplay(
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
      noteCount: notes.length,
      notes: notes.map((note, id) => ({ ...note, id })),
    },
    inputs: inputs.map((input, seq) => ({ ...input, seq })),
    play: { inputSources: [], mode: 'manual', autoScratch: false, gauge: 'GROOVE', ...play },
  };
}

const tap = (timeUs: number): ReplayNote => ({ id: 0, channel: '11', type: 'normal', timeUs });
const press = (timeUs: number): Array<Omit<ReplayInputEvent, 'seq'>> => [
  { timeUs, action: 'down', channels: ['11'], source: 0 },
  { timeUs: timeUs + 50_000, action: 'up', channels: ['11'], source: 0 },
];

/** Ten notes a second apart: the first four hit on time, the rest missed. */
const NOTES = Array.from({ length: 10 }, (_, index) => tap((index + 1) * 1_000_000));
const INPUTS = [1, 2, 3, 4].flatMap((second) => press(second * 1_000_000));

describe('resolveReplayGaugeHistories', () => {
  test('runs each gauge of the ruleset’s line-up, gentlest first, from its own starting value', () => {
    const replay = makeReplay(NOTES, INPUTS, { judgeRuleset: 'beatoraja', gauge: 'GROOVE' });
    const histories = resolveReplayGaugeHistories(replay);
    expect(histories.map((history) => history.gauge)).toEqual([
      'ASSIST-EASY',
      'EASY',
      'NORMAL',
      'HARD',
      'EX-HARD',
      'HAZARD',
    ]);
    // The groove gauges start at 20 % and the survival ones full.
    expect(histories.map((history) => history.initial)).toEqual([20, 20, 20, 100, 100, 100]);
    // One sample per judgment, the same judgments under every gauge.
    for (const history of histories) {
      expect(history.samples).toHaveLength(10);
      expect(history.samples.map((sample) => sample.atUs)).toEqual(histories[0]!.samples.map((sample) => sample.atUs));
    }
    // HAZARD empties at the first miss and stays there; a groove gauge rises over the hits and falls over the misses.
    const hazard = histories.at(-1)!.samples.map((sample) => sample.gauge);
    expect(hazard.slice(0, 4).every((value) => value === 100)).toBe(true);
    expect(hazard.slice(4).every((value) => value === 0)).toBe(true);
    const normal = histories[2]!.samples.map((sample) => sample.gauge);
    expect(normal[3]!).toBeGreaterThan(20);
    expect(normal.at(-1)!).toBeLessThan(normal[3]!);
  });

  test('each history is the gauge of the replay simulated on that gauge alone', () => {
    const replay = makeReplay(NOTES, INPUTS, { gauge: 'HARD', gaugeAutoShift: 'BEST_CLEAR' as never });
    for (const history of resolveReplayGaugeHistories(replay, { ruleset: 'lr2' })) {
      const { events } = resolveReplayJudgmentTimeline(replay, {
        ruleset: 'lr2',
        gauge: history.gauge,
        gaugeAutoShift: 'NONE',
        endOnFailure: false,
      });
      expect(history.samples).toEqual(events.map((event) => ({ atUs: event.atUs, gauge: event.gauge })));
    }
    expect(resolveReplayGaugeHistories(replay, { ruleset: 'lr2' }).map((history) => history.gauge)).toEqual([
      'EASY',
      'GROOVE',
      'HARD',
      'DEATH',
    ]);
  });

  test('leaves out the judgments after the play stopped', () => {
    const replay = makeReplay(NOTES, INPUTS, { judgeRuleset: 'beatoraja' });
    const stopped = resolveReplayGaugeHistories(replay, { untilUs: 5_500_000 });
    for (const history of stopped) expect(history.samples.every((sample) => sample.atUs <= 5_500_000)).toBe(true);
    expect(stopped[0]!.samples.length).toBeLessThan(10);
    expect(stopped[0]!.samples.length).toBeGreaterThanOrEqual(4);
  });
});

import { describe, expect, test } from 'vite-plus/test';
import {
  BE_MUSIC_REPLAY_FORMAT,
  BE_MUSIC_REPLAY_VERSION,
  type BeMusicReplay,
  type ReplayInputEvent,
  type ReplayNote,
} from './format.ts';
import { simulateReplay } from './simulate.ts';

// plugout at rank 2: PGREAT 18 ms, GREAT 40 ms, GOOD 100 ms, BAD 200 ms.
const KEY = '11';
const SCRATCH = '16';

const note = (timeUs: number, overrides: Partial<ReplayNote> = {}): ReplayNote => ({
  id: 0,
  channel: KEY,
  type: 'normal',
  timeUs,
  ...overrides,
});
const long = (channel: string, timeUs: number, endTimeUs: number): ReplayNote =>
  note(timeUs, { channel, type: 'long', endTimeUs, lnMode: 2 });
const down = (timeUs: number, channel = KEY): Omit<ReplayInputEvent, 'seq'> => ({
  timeUs,
  action: 'down',
  channels: [channel],
  source: 0,
});
const up = (timeUs: number, channel = KEY): Omit<ReplayInputEvent, 'seq'> => ({
  timeUs,
  action: 'up',
  channels: [channel],
  source: 0,
});

function simulate(notes: ReplayNote[], inputs: Array<Omit<ReplayInputEvent, 'seq'>>) {
  const replay: BeMusicReplay = {
    format: BE_MUSIC_REPLAY_FORMAT,
    version: BE_MUSIC_REPLAY_VERSION,
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode: 2,
      judgeRank: { percent: 75, sourceRank: 2 },
      noteCount: notes.length,
      notes: notes.map((entry, id) => ({ ...entry, id })),
    },
    inputs: inputs.map((input, seq) => ({ ...input, seq })),
    play: {
      mode: 'manual',
      autoScratch: false,
      gauge: 'GROOVE',
      inputSources: [{ id: 0, kind: 'key', device: 'keyboard', label: 'z' }],
    },
  };
  return simulateReplay(replay, { ruleset: 'plugout' });
}

const judged = (counts: Partial<Record<'pgreat' | 'great' | 'good' | 'bad' | 'poor' | 'emptyPoor', number>>) => ({
  pgreat: 0,
  great: 0,
  good: 0,
  bad: 0,
  poor: 0,
  emptyPoor: 0,
  ...counts,
});

describe('plugout judging', () => {
  test('judges a tap by the rank windows, BAD out to 200 ms', () => {
    const cases: [number, string][] = [
      [15_000, 'pgreat'],
      [-35_000, 'great'],
      [90_000, 'good'],
      [-190_000, 'bad'],
    ];
    for (const [dmUs, kind] of cases) {
      expect(simulate([note(1_000_000)], [down(1_000_000 - dmUs)]).judge, kind).toEqual(judged({ [kind]: 1 }));
    }
  });

  test('a press 200 ms to 1 s before a note is an empty POOR', () => {
    expect(simulate([note(1_000_000)], [down(500_000)]).judge).toEqual(judged({ emptyPoor: 1, poor: 1 }));
  });

  test('scores 100000 for all PGREATs and splits it by the judgment', () => {
    const notes = [note(1_000_000), note(2_000_000)];
    expect(simulate(notes, [down(1_000_000), up(1_100_000), down(2_000_000)]).score).toBe(100000);
    expect(simulate(notes, [down(1_000_000), up(1_100_000), down(2_030_000)]).score).toBe(75000);
  });
});

describe('plugout long notes', () => {
  const ln = [long(KEY, 1_000_000, 2_000_000)];

  test('a release from the GOOD window before the end to 200 ms past it is a PGREAT', () => {
    expect(simulate(ln, [down(1_000_000), up(1_950_000)]).judge).toEqual(judged({ pgreat: 2 }));
    expect(simulate(ln, [down(1_000_000), up(2_150_000)]).judge).toEqual(judged({ pgreat: 2 }));
  });

  test('an earlier release is a BAD, however early', () => {
    expect(simulate(ln, [down(1_000_000), up(1_850_000)]).judge).toEqual(judged({ pgreat: 1, bad: 1 }));
    expect(simulate(ln, [down(1_000_000), up(1_300_000)]).judge).toEqual(judged({ pgreat: 1, bad: 1 }));
  });

  test('a key held 200 ms past the end is a BAD', () => {
    expect(simulate(ln, [down(1_000_000), up(3_000_000)]).judge).toEqual(judged({ pgreat: 1, bad: 1 }));
  });

  test('a scratch held to the end is a PGREAT at the end, and released early a BAD', () => {
    const scratch = [long(SCRATCH, 1_000_000, 2_000_000)];
    expect(simulate(scratch, [down(1_000_000, SCRATCH), up(3_000_000, SCRATCH)]).judge).toEqual(judged({ pgreat: 2 }));
    expect(simulate(scratch, [down(1_000_000, SCRATCH), up(1_500_000, SCRATCH)]).judge).toEqual(
      judged({ pgreat: 1, bad: 1 }),
    );
  });

  test('a BAD head settles the note without its tail', () => {
    expect(simulate(ln, [down(850_000), up(2_000_000)]).judge).toEqual(judged({ bad: 1 }));
  });

  test('after a BAD the press judges the next note too, but only one it has reached', () => {
    // Two notes 50 ms apart; a press 120 ms late on the first is a BAD, and the second, 70 ms before it, is a GOOD.
    expect(simulate([note(1_000_000), note(1_050_000)], [down(1_120_000)]).judge).toEqual(judged({ bad: 1, good: 1 }));
    // A press 150 ms early is a BAD; the next note, 50 ms after the first, lies ahead of it and waits for its own press.
    expect(simulate([note(1_000_000), note(1_050_000)], [down(850_000), up(900_000), down(1_050_000)]).judge).toEqual(
      judged({ bad: 1, pgreat: 1 }),
    );
  });
});

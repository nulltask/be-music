import { describe, expect, test } from 'vite-plus/test';
import { createHiSpeedState } from './hi-speed.ts';
import {
  createPlayState,
  playEventFromUICommand,
  playProgress,
  recentJudgeTimings,
  reducePlayState,
  type PlayEvent,
  type PlayState,
} from './state.ts';

const frame = (exScore: number, current: number, extra: { cleared?: boolean; total?: number } = {}): PlayEvent => ({
  type: 'frame',
  frame: {
    totalSeconds: extra.total ?? 100,
    summary: { exScore, gauge: { current, max: 100, cleared: extra.cleared ?? false, type: 'GROOVE' } },
  },
});
const judge = (name: string, combo: number, seconds: number, deltaMs?: number, channel?: string): PlayEvent => ({
  type: 'judge',
  judge: { judge: name, combo, ...(deltaMs !== undefined ? { deltaMs } : {}), ...(channel ? { channel } : {}) },
  seconds,
  atMs: seconds * 1000,
});
const run = (state: PlayState, ...events: PlayEvent[]): PlayState => events.reduce(reducePlayState, state);

describe('graphs', () => {
  test('start at the gauge the play starts with and sample the gauge and EX score at each judgment', () => {
    const state = run(
      createPlayState({ gauge: 20, totalSeconds: 100 }),
      frame(2, 22),
      judge('PERFECT', 1, 25),
      frame(3, 23),
      judge('GREAT', 2, 50),
    );
    expect(state.gaugeHistory).toEqual([
      { progress: 0, value: 20 },
      { progress: 0.25, value: 22 },
      { progress: 0.5, value: 23 },
    ]);
    expect(state.scoreHistory).toEqual([
      { progress: 0, exScore: 0 },
      { progress: 0.25, exScore: 2 },
      { progress: 0.5, exScore: 3 },
    ]);
  });

  test('start at the first frame when the starting gauge was not given', () => {
    const state = run(createPlayState(), frame(0, 100));
    expect(state.gaugeHistory).toEqual([{ progress: 0, value: 100 }]);
    expect(state.scoreHistory).toEqual([{ progress: 0, exScore: 0 }]);
    expect(state.totalSeconds).toBe(100);
  });

  test('sample an empty POOR, which moves the gauge without a judgment of a note', () => {
    const state = run(createPlayState({ gauge: 20, totalSeconds: 100 }), frame(0, 18), {
      type: 'empty-poor',
      seconds: 40,
    });
    expect(state.gaugeHistory.at(-1)).toEqual({ progress: 0.4, value: 18 });
    expect(playEventFromUICommand({ kind: 'trigger-poor-bga', seconds: 40 })).toEqual({
      type: 'empty-poor',
      seconds: 40,
    });
    expect(playEventFromUICommand({ kind: 'clear-poor-bga' })).toBeUndefined();
  });

  test('read the gauge in percent of its maximum', () => {
    const state = run(createPlayState(), {
      type: 'frame',
      frame: { totalSeconds: 10, summary: { exScore: 0, gauge: { current: 5, max: 10, cleared: true } } },
    });
    expect(state.gauge).toBe(50);
    expect(state.cleared).toBe(true);
  });

  test('take the chart-time fraction over the chart, clamped, and 0 before its length is known', () => {
    expect(playProgress({ totalSeconds: 200 }, 50)).toBe(0.25);
    expect(playProgress({ totalSeconds: 200 }, 500)).toBe(1);
    expect(playProgress({ totalSeconds: 0 }, 50)).toBe(0);
  });
});

describe('combo', () => {
  test('follows the published combo and keeps the longest', () => {
    const state = run(
      createPlayState(),
      judge('PERFECT', 1, 1),
      judge('GREAT', 2, 2),
      judge('POOR', 0, 3),
      judge('PERFECT', 1, 4),
    );
    expect(state.combo).toBe(1);
    expect(state.maxCombo).toBe(2);
  });

  test('ignores the engine READY reset', () => {
    const state = run(createPlayState(), judge('PERFECT', 3, 1));
    expect(reducePlayState(state, judge('READY', 0, 2))).toBe(state);
  });

  test('does not fabricate a full combo when empty POOR broke it', () => {
    const state = run(createPlayState(), judge('PERFECT', 3, 1), {
      type: 'finish',
      summary: { total: 5, perfect: 5, great: 0, good: 0, bad: 0, poor: 0, fullCombo: false },
    });
    expect(state.maxCombo).toBe(3);
  });
  test('reads a full combo as every note once the play is over, even when combos went unpublished', () => {
    const state = run(createPlayState(), judge('PERFECT', 3, 1), {
      type: 'finish',
      summary: { total: 5, perfect: 4, great: 1, good: 0, bad: 0, poor: 0 },
    });
    expect(state.maxCombo).toBe(5);
    const broken = run(createPlayState(), judge('PERFECT', 3, 1), {
      type: 'finish',
      summary: { total: 5, perfect: 4, great: 0, good: 0, bad: 0, poor: 1 },
    });
    expect(broken.maxCombo).toBe(3);
  });

  test('runs the course combo on from the stage carried in', () => {
    const state = run(
      createPlayState({ courseCarryIn: { combo: 40, maxCombo: 55 } }),
      judge('PERFECT', 1, 1),
      judge('PERFECT', 2, 2),
      judge('BAD', 0, 3),
      judge('PERFECT', 1, 4),
    );
    expect(state.courseCombo).toEqual({ combo: 1, maxCombo: 55, stageCombo: 1 });
    expect(createPlayState().courseCombo).toBeUndefined();
  });
});

describe('judge timings', () => {
  test('record the timed judgments with their channel, and count each judgment early and late', () => {
    const state = run(
      createPlayState(),
      judge('PERFECT', 1, 1, -4, '11'),
      judge('GREAT', 2, 2, 15),
      judge('GREAT', 3, 3, -20),
      judge('PERFECT', 4, 4, 0),
    );
    expect(state.judgeTimings).toEqual([
      { atMs: 1000, deltaMs: -4, judge: 'PERFECT', channel: '11' },
      { atMs: 2000, deltaMs: 15, judge: 'GREAT' },
      { atMs: 3000, deltaMs: -20, judge: 'GREAT' },
      { atMs: 4000, deltaMs: 0, judge: 'PERFECT' },
    ]);
    expect(state.earlyLate.PERFECT).toEqual({ early: 1, late: 0 });
    expect(state.earlyLate.GREAT).toEqual({ early: 1, late: 1 });
    expect(state.lastJudgeDeltaMs).toBe(0);
  });

  test('skip judgments without a finite timing or a known grade', () => {
    const state = run(
      createPlayState(),
      judge('PERFECT', 1, 1),
      judge('POOR', 0, 2, Number.NaN),
      judge('MISS', 0, 3, 5),
    );
    expect(state.judgeTimings).toEqual([]);
    expect(state.lastJudgeDeltaMs).toBeUndefined();
  });

  test('keep the latest ones for a live meter, the same array until a judgment arrives', () => {
    let state = createPlayState();
    for (let index = 0; index < 70; index += 1) state = reducePlayState(state, judge('GOOD', index, index, index));
    const recent = recentJudgeTimings(state);
    expect(recent).toHaveLength(64);
    expect(recent[0]!.deltaMs).toBe(6);
    expect(recentJudgeTimings(state)).toBe(recent);
    expect(recentJudgeTimings(state, 3).map((timing) => timing.deltaMs)).toEqual([67, 68, 69]);
  });
});

describe('reducePlayState', () => {
  test('returns the same state for a frame that changes nothing', () => {
    const state = run(createPlayState({ gauge: 20, totalSeconds: 100 }), frame(4, 30));
    expect(reducePlayState(state, frame(4, 30))).toBe(state);
  });

  test('never changes the state it is given', () => {
    const state = createPlayState({ gauge: 20, totalSeconds: 100 });
    const before = JSON.stringify(state);
    run(state, frame(4, 30), judge('PERFECT', 1, 10, 3), { type: 'empty-poor', seconds: 20 });
    expect(JSON.stringify(state)).toBe(before);
  });

  test('routes hi-speed and lane cover commands to the view', () => {
    const state = createPlayState({
      view: {
        hiSpeed: createHiSpeedState({ hiSpeed: 2 }),
        covers: [{ side: '1P', sudden: 0.25, suddenOn: false, hidden: 0.25, hiddenOn: false, lift: 0 }],
      },
    });
    const faster = reducePlayState(state, { type: 'hi-speed-step', delta: 0.5 });
    expect(faster.view.hiSpeed.drawn).toBe(2.5);
    const covered = reducePlayState(faster, { type: 'cover-adjust', part: 'sudden', delta: 0.05 });
    expect(covered.view.covers[0]).toMatchObject({ sudden: 0.3, suddenOn: true });
    expect(reducePlayState(covered, { type: 'cover-adjust', part: 'lift', delta: Number.NaN })).toBe(covered);
  });

  test('locks the hi-speed and the covers together for a course that forbids changing them', () => {
    const state = createPlayState({
      view: {
        hiSpeed: createHiSpeedState({ hiSpeed: 2, locked: true }),
        covers: [{ side: '1P', sudden: 0.25, suddenOn: true, hidden: 0, hiddenOn: false, lift: 0 }],
      },
    });
    expect(reducePlayState(state, { type: 'hi-speed-step', delta: 0.5 })).toBe(state);
    expect(reducePlayState(state, { type: 'cover-adjust', part: 'sudden', delta: 0.1 })).toBe(state);
    // A replay's recorded covers and hi-speed still apply.
    const replayed = reducePlayState(state, { type: 'cover-set', covers: [{ side: '1P', sudden: 0.5 }] });
    expect(replayed.view.covers[0]!.sudden).toBe(0.5);
    const replayedSpeed = reducePlayState(replayed, { type: 'hi-speed-drawn', value: 3 });
    expect(replayedSpeed.view.hiSpeed).toMatchObject({ player: 3, drawn: 3, locked: true });
    expect(replayedSpeed.view.covers).toBe(replayed.view.covers);
  });
});

describe('engine combos on frames', () => {
  const comboFrame = (combo: number, maxCombo: number, course?: { combo: number; maxCombo: number }): PlayEvent => ({
    type: 'frame',
    frame: { totalSeconds: 100, summary: { exScore: 0, combo, maxCombo, ...(course ? { course } : {}) } },
  });

  test('win over the combos the judgments counted', () => {
    const state = run(createPlayState(), judge('PERFECT', 1, 1), comboFrame(4, 6));
    expect(state).toMatchObject({ combo: 4, maxCombo: 6 });
    expect(reducePlayState(state, comboFrame(4, 6))).toBe(state);
  });

  test('take the course combo of a course stage', () => {
    const state = run(
      createPlayState({ courseCarryIn: { combo: 40, maxCombo: 55 } }),
      comboFrame(3, 3, { combo: 43, maxCombo: 55 }),
    );
    expect(state.courseCombo).toEqual({ combo: 43, maxCombo: 55, stageCombo: 3 });
    expect(reducePlayState(state, comboFrame(3, 3, { combo: 43, maxCombo: 55 }))).toBe(state);
  });
});

describe('seek', () => {
  const gauge = (current: number) => ({ current, max: 100, initial: 20, cleared: false, type: 'GROOVE' });
  const emptySnapshot = { summary: { exScore: 0, gauge: gauge(20) }, combo: 0, maxCombo: 0, judgments: [] };

  test('rebuilds the state a play reaches by judging the same notes', () => {
    // Played live: each frame carries the gauge and EX score right after the judgment that follows it.
    const played = run(
      createPlayState({ gauge: 20, totalSeconds: 100 }),
      frame(2, 22),
      judge('PERFECT', 1, 10, -3, '11'),
      frame(3, 23),
      judge('GREAT', 2, 20, 8, '12'),
      frame(3, 21),
      judge('POOR', 0, 30),
      frame(5, 23),
      judge('PERFECT', 1, 40, 0, '13'),
    );
    const sought = reducePlayState(createPlayState({ gauge: 20, totalSeconds: 100 }), {
      type: 'seek',
      seconds: 45,
      atMs: 45_000,
      snapshot: {
        summary: { exScore: 5, gauge: gauge(23) },
        combo: 1,
        maxCombo: 2,
        judgments: [
          { judge: 'PERFECT', combo: 1, channel: '11', deltaMs: -3, seconds: 10, gauge: 22, exScore: 2 },
          { judge: 'GREAT', combo: 2, channel: '12', deltaMs: 8, seconds: 20, gauge: 23, exScore: 3 },
          { judge: 'POOR', combo: 0, seconds: 30, gauge: 21, exScore: 3 },
          { judge: 'PERFECT', combo: 1, channel: '13', deltaMs: 0, seconds: 40, gauge: 23, exScore: 5 },
        ],
      },
    });
    expect(sought).toEqual({ ...played, gaugeType: 'GROOVE' });
  });

  test('goes back: what came after the second sought is gone, the view and the chart length stay', () => {
    const view = { hiSpeed: createHiSpeedState({ hiSpeed: 3 }) };
    const played = run(
      createPlayState({ gauge: 20, totalSeconds: 100, view }),
      frame(4, 30),
      judge('PERFECT', 1, 10, 5),
      judge('PERFECT', 2, 50, -5),
    );
    const sought = reducePlayState(played, {
      type: 'seek',
      seconds: 20,
      atMs: 70_000,
      tempo: 2,
      snapshot: {
        summary: { exScore: 2, gauge: gauge(22) },
        combo: 1,
        maxCombo: 1,
        judgments: [{ judge: 'PERFECT', combo: 1, deltaMs: 5, seconds: 10, gauge: 22, exScore: 2 }],
      },
    });
    expect(sought).toMatchObject({
      totalSeconds: 100,
      gauge: 22,
      exScore: 2,
      combo: 1,
      maxCombo: 1,
      lastJudgeDeltaMs: 5,
    });
    expect(sought.view).toBe(played.view);
    // Chart time ran twice as fast as the play clock: 10 chart seconds before the seek are 5 s of play clock.
    expect(sought.judgeTimings).toEqual([{ atMs: 65_000, deltaMs: 5, judge: 'PERFECT' }]);
    expect(sought.earlyLate.PERFECT).toEqual({ early: 0, late: 1 });
    expect(sought.gaugeHistory).toEqual([
      { progress: 0, value: 20 },
      { progress: 0.1, value: 22 },
    ]);
  });

  test('to the start empties the play, starting the graphs at the gauge the play starts with', () => {
    const played = run(createPlayState({ totalSeconds: 100 }), frame(4, 30), judge('PERFECT', 1, 10, 5));
    const sought = reducePlayState(played, { type: 'seek', seconds: 0, atMs: 0, snapshot: emptySnapshot });
    expect(sought).toMatchObject({ gauge: 20, exScore: 0, combo: 0, maxCombo: 0, judgeTimings: [] });
    // The graphs keep the start sample of the play (the first frame's gauge here).
    expect(sought.gaugeHistory).toEqual([{ progress: 0, value: 30 }]);
    expect(sought.lastJudgeDeltaMs).toBeUndefined();
    // Without a start sample yet, the gauge's initial value starts the graphs.
    const fresh = reducePlayState(createPlayState({ totalSeconds: 100 }), {
      type: 'seek',
      seconds: 0,
      atMs: 0,
      snapshot: emptySnapshot,
    });
    expect(fresh.gaugeHistory).toEqual([{ progress: 0, value: 20 }]);
    expect(fresh.scoreHistory).toEqual([{ progress: 0, exScore: 0 }]);
  });

  test('takes a course stage course combo from the snapshot', () => {
    const sought = reducePlayState(createPlayState({ courseCarryIn: { combo: 40, maxCombo: 55 } }), {
      type: 'seek',
      seconds: 10,
      atMs: 0,
      snapshot: { summary: { exScore: 4, course: { combo: 42, maxCombo: 55 } }, combo: 2, maxCombo: 2, judgments: [] },
    });
    expect(sought.courseCombo).toEqual({ combo: 42, maxCombo: 55, stageCombo: 2 });
  });

  test('never changes the state it is given', () => {
    const state = run(createPlayState({ gauge: 20, totalSeconds: 100 }), frame(4, 30), judge('PERFECT', 1, 10, 3));
    const before = JSON.stringify(state);
    reducePlayState(state, { type: 'seek', seconds: 0, atMs: 0, snapshot: emptySnapshot });
    expect(JSON.stringify(state)).toBe(before);
  });
});

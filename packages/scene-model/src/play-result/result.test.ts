import { describe, expect, test } from 'vite-plus/test';
import { createPlayState, reducePlayState, type PlayEvent, type PlayState } from '../play-state/state.ts';
import { makeChart } from '../test-support/library.ts';
import {
  beatorajaCompletionFromPlayResult,
  playResultFromBeatoraja,
  playResultFromPlayState,
  playResultRun,
  resolveResultPresentation,
} from './result.ts';

const song = makeChart('song', 'Pack/x');
const score = { total: 4, perfect: 3, great: 1, good: 0, bad: 0, poor: 0, emptyPoor: 0, exScore: 7, score: 7 };

function played(...events: PlayEvent[]): PlayState {
  return events.reduce(reducePlayState, createPlayState({ gauge: 20, totalSeconds: 100 }));
}

describe('playResultFromPlayState', () => {
  const frame = (exScore: number, current: number, cleared = false): PlayEvent => ({
    type: 'frame',
    frame: { totalSeconds: 100, summary: { exScore, gauge: { current, max: 100, cleared, type: 'GROOVE' } } },
  });
  const judge = (combo: number, seconds: number, deltaMs?: number): PlayEvent => ({
    type: 'judge',
    judge: { judge: 'PERFECT', combo, ...(deltaMs !== undefined ? { deltaMs } : {}) },
    seconds,
    atMs: seconds * 1000,
  });

  test('reads the score, gauge, combo and graphs, ending the graphs where the play ended', () => {
    const state = played(frame(2, 24), judge(1, 10, -3), frame(7, 82, true), judge(4, 60, 5));
    const result = playResultFromPlayState(state, { song, score, seconds: 90, judgeRuleset: 'lr2' });
    expect(result).toMatchObject({
      score,
      maxCombo: 4,
      gauge: 82,
      cleared: true,
      playSeconds: 90,
      gaugeType: 'GROOVE',
      judgeRuleset: 'lr2',
    });
    expect(result.gaugeHistory).toEqual([
      { progress: 0, value: 20 },
      { progress: 0.1, value: 24 },
      { progress: 0.6, value: 82 },
      { progress: 0.9, value: 82 },
    ]);
    expect(result.scoreHistory.at(-1)).toEqual({ progress: 0.9, exScore: 7 });
    expect(result.judgeTimings).toHaveLength(2);
    expect(result.earlyLate?.PERFECT).toEqual({ early: 1, late: 1 });
  });

  test('lamps the play by the one clear-lamp rule', () => {
    const cleared = played(frame(7, 82, true));
    // Every note judged GREAT or better on a cleared gauge: LR2 tops out at FULL COMBO.
    expect(playResultFromPlayState(cleared, { song, score, seconds: 100, judgeRuleset: 'lr2' }).lamp).toBe(
      'FULL_COMBO',
    );
    expect(playResultFromPlayState(cleared, { song, score, seconds: 100, judgeRuleset: 'beatoraja' }).lamp).toBe(
      'PERFECT',
    );
    expect(playResultFromPlayState(played(frame(7, 40)), { song, score, seconds: 100 }).lamp).toBe('FAILED');
  });

  test('carries the run and the course a stage belongs to, and the play time apart from the chart time', () => {
    const course = { kind: 'grade' as const, title: 'Dan', stages: [{ title: 'song' }], stageIndex: 0 };
    const result = playResultFromPlayState(played(), {
      song,
      score,
      seconds: 100,
      playSeconds: 125,
      run: 'stage',
      course,
    });
    expect(result).toMatchObject({ run: 'stage', course, playSeconds: 125 });
  });
});

describe('playResultFromBeatoraja', () => {
  const completion = {
    summary: {
      ...score,
      fast: 1,
      slow: 2,
      gauge: { current: 80, max: 100, initial: 20, cleared: true, type: 'NORMAL' },
    },
    maxCombo: 4,
    history: {
      scoreHistory: [{ progress: 0.5, exScore: 3 }],
      gaugeHistory: [{ progress: 0.5, value: 50 }],
      timingHistory: [
        { deltaMs: -4, kind: 'PERFECT' },
        { deltaMs: 12, kind: 'GREAT' },
        { deltaMs: 0, kind: 'MISS' },
      ],
    },
  };

  test('reads the summary, max combo and graphs into the one payload', () => {
    const result = playResultFromBeatoraja(completion, { song, judgeRuleset: 'beatoraja', playSeconds: 95 });
    expect(result).toMatchObject({
      score,
      maxCombo: 4,
      gauge: 80,
      cleared: true,
      gaugeType: 'NORMAL',
      fast: 1,
      slow: 2,
      playSeconds: 95,
      lamp: 'PERFECT',
    });
  });

  test('gives the graphs the start and end samples the built-in and LR2 scenes take', () => {
    const result = playResultFromBeatoraja(completion, { song });
    expect(result.gaugeHistory).toEqual([
      { progress: 0, value: 20 },
      { progress: 0.5, value: 50 },
      { progress: 1, value: 80 },
    ]);
    expect(result.scoreHistory).toEqual([
      { progress: 0, exScore: 0 },
      { progress: 0.5, exScore: 3 },
      { progress: 1, exScore: 7 },
    ]);
  });

  test("keeps the gauge's clear border, in percent, and the TOTAL it ran on", () => {
    const result = playResultFromBeatoraja(
      {
        ...completion,
        summary: {
          ...completion.summary,
          gauge: { current: 40, max: 50, cleared: false, clearThreshold: 30, effectiveTotal: 260 },
        },
      },
      { song },
    );
    expect(result).toMatchObject({ gauge: 80, gaugeBorder: 60, gaugeTotal: 260 });
    expect(beatorajaCompletionFromPlayResult(result).summary.gauge).toMatchObject({
      current: 80,
      max: 100,
      clearThreshold: 60,
      effectiveTotal: 260,
    });
    expect(playResultFromBeatoraja(completion, { song })).not.toHaveProperty('gaugeBorder');
    expect(playResultFromBeatoraja(completion, { song })).not.toHaveProperty('gaugeTotal');
  });

  test('keeps the five judgments of the timing samples, without a time of their own', () => {
    expect(playResultFromBeatoraja(completion, { song }).judgeTimings).toEqual([
      { atMs: 0, deltaMs: -4, judge: 'PERFECT' },
      { atMs: 0, deltaMs: 12, judge: 'GREAT' },
    ]);
  });

  test('goes back to the shape the beatoraja result scene reads', () => {
    const back = beatorajaCompletionFromPlayResult(playResultFromBeatoraja(completion, { song }));
    expect(back.summary).toMatchObject({ ...score, fast: 1, slow: 2, gauge: { current: 80, max: 100, cleared: true } });
    expect(back.maxCombo).toBe(4);
    expect(back.history.timingHistory).toEqual([
      { deltaMs: -4, kind: 'PERFECT' },
      { deltaMs: 12, kind: 'GREAT' },
    ]);
  });
});

describe('playResultRun', () => {
  test('reads a result without a run as a single play', () => {
    expect(playResultRun({})).toBe('single');
    expect(playResultRun({ run: 'nonstop' })).toBe('nonstop');
  });
});

describe('resolveResultPresentation', () => {
  test('shows a course run on the course-result skin with the course jingles and no retry', () => {
    expect(resolveResultPresentation('course')).toEqual({
      courseResultSkin: true,
      courseJingles: true,
      quickRetry: false,
    });
  });

  test('shows a NONSTOP run as LR2 does: the result skin, the clear / fail jingles and quick retry', () => {
    expect(resolveResultPresentation('nonstop')).toEqual({
      courseResultSkin: false,
      courseJingles: false,
      quickRetry: true,
    });
  });

  test('offers quick retry on a single play only, not on a course stage', () => {
    expect(resolveResultPresentation('single').quickRetry).toBe(true);
    expect(resolveResultPresentation('stage').quickRetry).toBe(false);
  });
});

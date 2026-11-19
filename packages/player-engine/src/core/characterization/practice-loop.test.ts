import { describe, expect, test } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { command, observePlay, tap } from './harness.ts';
import type { PlayPractice } from '../practice.ts';

// 120 BPM, a bar every 2 s: taps on 11 at 1.0, 4.0, 5.0, 6.0, 7.0 and 9.0. The range [4.5, 6.5) holds the taps at 5.0 and
// 6.0. It starts in bar 2 and ends in bar 3 (#954), so the play starts at the head of bar 1 (2.0) on the play clock's 0
// and loops at the head of bar 4 (8.0), 6000 ms later.
const loopChart = () =>
  parseChart(
    [
      '#PLAYER 1',
      '#TITLE loop',
      '#BPM 120',
      '#RANK 2',
      '#TOTAL 160',
      '#WAV02 key.wav',
      '#00011:0002',
      '#00211:0202',
      '#00311:0202',
      '#00411:0002',
      '',
    ].join('\n'),
    'bms',
  );
const range = { startMs: 4500, endMs: 6500, gauge: 'NORMAL', startGauge: 20 } satisfies PlayPractice;

describe('PRACTICE loop (#949)', () => {
  test('goes back to the start in place once the play is over, with the practice score and gauge', async () => {
    const play = await observePlay({
      driver: 'manual',
      chart: loopChart(),
      options: { judgeRuleset: 'beatoraja', practice: { ...range, loop: true } },
      // The first time through, 11 @ 5.0 is hit; the second time through, nothing is.
      script: [...tap(3000, '11'), command(11_950, { kind: 'interrupt', reason: 'escape' })],
      captureAt: [4.4, 7.9],
    });
    // The play was never finished and made again: after the seek to its start, one more back to 2.0 on the first tick past
    // the head of bar 4 (8.0), seamlessly (the 10 ms past 8.0 carried over), of the next generation, and the same audio
    // session from the start to the ESC.
    expect(play.frames.generations).toEqual([
      '0.000 generation=1 seconds=2 output=0 tempo=1',
      '6010.000 generation=2 seconds=2.01 output=6.01 tempo=1',
    ]);
    expect(play.audio.filter((entry) => / (start|seek 2(\.01)?|dispose|finish)$/.test(entry))).toEqual([
      '0.000 start',
      '0.000 seek 2',
      '6010.000 seek 2.01',
      '11950.000 dispose',
    ]);
    // The second time through starts from nothing: no judgment yet just before the range, the starting gauge, and by
    // its end two misses and none of the first time's hit.
    expect(play.captured?.['4.4']?.counts).toMatchObject({ perfect: 0, great: 0, poor: 0, exScore: 0, combo: 0 });
    expect(play.captured?.['4.4']?.gauge).toBe(20);
    expect(play.captured?.['4.4']?.notes).toEqual([]);
    expect(play.captured?.['7.9']?.counts).toMatchObject({ perfect: 0, poor: 2, exScore: 0 });
    expect(play.summary).toMatchObject({ perfect: 0, poor: 2, exScore: 0 });
    expect(play.replay).toBeUndefined();
  });

  test('goes back to the start when a survival gauge empties instead of ending the play', async () => {
    const play = await observePlay({
      driver: 'manual',
      chart: loopChart(),
      options: {
        judgeRuleset: 'beatoraja',
        endOnFailure: true,
        practice: { ...range, gauge: 'HARD', startGauge: 2, loop: true },
      },
      script: [command(5000, { kind: 'interrupt', reason: 'escape' })],
    });
    expect(play.outcome).toBe('completed');
    // The first miss at 5.0 + the BAD reach empties the 2 % gauge; the play starts again from 2.0 at once, before the
    // range is over.
    const restarts = play.frames.generations?.slice(1) ?? [];
    expect(restarts.length).toBeGreaterThanOrEqual(1);
    expect(restarts[0]).toMatch(/generation=2 seconds=2 /);
    expect(Number.parseFloat(restarts[0]!)).toBeLessThan(4500);
    expect(play.summary?.gauge?.failedMidPlay).not.toBe(true);
  });

  test('with no rest, leads the first round in by a bar and loops back to the range at its end, seamlessly', async () => {
    // Bar 2 alone, [4.0, 6.0): the first round starts at the head of bar 1 (2.0); each loop goes back to 4.0 the moment
    // the play reaches 6.0, carrying the time past it, without waiting for 11 @ 6.0's judgment.
    const play = await observePlay({
      driver: 'manual',
      chart: loopChart(),
      options: {
        judgeRuleset: 'beatoraja',
        practice: { ...range, startMs: 4000, endMs: 6000, restBarsBefore: 0, restBarsAfter: 0, loop: true },
      },
      script: [command(7_000, { kind: 'interrupt', reason: 'escape' })],
    });
    const generations = play.frames.generations ?? [];
    expect(generations[0]).toBe('0.000 generation=1 seconds=2 output=0 tempo=1');
    // The play reaches 6.0 on the play clock's 4000 and goes on from 4.0 plus the overshoot.
    const loop = /^(\S+) generation=2 seconds=(\S+) /.exec(generations[1] ?? '');
    expect(loop).not.toBeNull();
    const [atMs, seconds] = [Number(loop![1]), Number(loop![2])];
    expect(atMs).toBeGreaterThanOrEqual(4000);
    expect(atMs).toBeLessThan(4050);
    expect(seconds).toBeCloseTo(4 + (atMs - 4000) / 1000, 3);
    // The next loop is the range's two seconds later: it starts at 4.0, not 2.0.
    expect(generations[2]).toMatch(/generation=3 seconds=4(\.0\d*)? /);
  });

  test('a seamless loop leaves the note on the range’s first beat to be hit, though it went past its start', async () => {
    // Bar 2 alone, [4.0, 6.0), with 11 @ 4.0 on its first beat. The play loops a tick past 6.0 (the play clock's 4000)
    // to just past 4.0, and a press there still hits 11 @ 4.0 instead of finding it consumed.
    const play = await observePlay({
      driver: 'manual',
      chart: loopChart(),
      options: {
        judgeRuleset: 'beatoraja',
        practice: { ...range, startMs: 4000, endMs: 6000, restBarsBefore: 0, restBarsAfter: 0, loop: true },
      },
      script: [...tap(4030, '11'), command(4_500, { kind: 'interrupt', reason: 'escape' })],
    });
    expect(play.frames.generations?.[1]).toMatch(/generation=2 seconds=4\.0\d* /);
    expect(play.summary?.poor).toBe(0);
    expect((play.summary?.perfect ?? 0) + (play.summary?.great ?? 0)).toBe(1);
  });

  test('AUTO plays the range’s first beat each time round, on its tick rather than as a sound already ringing', async () => {
    const play = await observePlay({
      driver: 'auto',
      chart: loopChart(),
      options: {
        judgeRuleset: 'beatoraja',
        practice: { ...range, startMs: 4000, endMs: 6000, restBarsBefore: 0, restBarsAfter: 0, loop: true },
      },
      script: [command(4_500, { kind: 'interrupt', reason: 'escape' })],
    });
    expect(play.frames.generations?.[1]).toMatch(/generation=2 seconds=4\.0\d* /);
    // After the loop's seek 11 @ 4.0 is no sound started partway: it is played (and judged) on the next tick.
    const seek = play.audio.findIndex((entry) => / seek 4\.0\d*$/.test(entry));
    expect(seek).toBeGreaterThan(0);
    const after = play.audio.slice(seek + 1);
    expect(after.some((entry) => /trigger-at .*11/.test(entry))).toBe(false);
    expect(after.some((entry) => / trigger .*11/.test(entry))).toBe(true);
    expect(play.summary?.perfect).toBe(1);
  });

  test('a practice play without the loop ends at the head of the bar after its range', async () => {
    const play = await observePlay({
      driver: 'manual',
      chart: loopChart(),
      options: { judgeRuleset: 'beatoraja', practice: range },
      script: tap(3000, '11'),
      audio: false,
    });
    expect(play.outcome).toBe('completed');
    expect(play.frames.generations).toHaveLength(1);
    expect(play.summary).toMatchObject({ perfect: 1, poor: 1 });
    // Without audio to play out, the play ends once its chart (to 8.0) is over and judged: 6000 ms after its start.
    expect(play.endedAtMs).toBeGreaterThanOrEqual(6000);
    expect(play.endedAtMs).toBeLessThan(6100);
  });
});

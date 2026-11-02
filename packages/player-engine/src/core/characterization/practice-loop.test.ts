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
    // the head of bar 4 (8.0), of the next generation, and the same audio session from the start to the ESC.
    expect(play.frames.generations).toEqual([
      '0.000 generation=1 seconds=2 output=0 tempo=1',
      '6010.000 generation=2 seconds=2 output=6.01 tempo=1',
    ]);
    expect(play.audio.filter((entry) => / (start|seek 2|dispose|finish)$/.test(entry))).toEqual([
      '0.000 start',
      '0.000 seek 2',
      '6010.000 seek 2',
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

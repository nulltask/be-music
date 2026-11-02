import { describe, expect, test } from 'vite-plus/test';
import { basicChart } from './charts.ts';
import { command, observePlay, tap } from './harness.ts';
import type { PlayPractice } from '../practice.ts';

// The range [2.0, 3.2) of the basic chart holds 19 @ 2.0, 11 @ 2.5 and 12 @ 3.0. The play starts at 1.0 (1000 ms before
// the range) on the play clock's 0 and ends at 4.2 (the range's end + 1000 ms), 3200 ms later.
const range = { startMs: 2000, endMs: 3200, gauge: 'NORMAL', startGauge: 20 } satisfies PlayPractice;

describe('PRACTICE loop (#949)', () => {
  test('goes back to the start in place once the play is over, with the practice score and gauge', async () => {
    const play = await observePlay({
      driver: 'manual',
      chart: basicChart(),
      options: { judgeRuleset: 'beatoraja', practice: { ...range, loop: true } },
      // The first time through, 11 @ 2.5 is hit; the second time through, nothing is.
      script: [...tap(1500, '11'), command(6300, { kind: 'interrupt', reason: 'escape' })],
      captureAt: [1.9, 3.9],
    });
    // The play was never finished and made again: after the seek to its start, one more back to 1.0 on the first tick
    // past 4.2, of the next generation, and the same audio session from the start to the ESC.
    expect(play.frames.generations).toEqual([
      '0.000 generation=1 seconds=1 output=0 tempo=1',
      '3210.000 generation=2 seconds=1 output=3.21 tempo=1',
    ]);
    expect(play.ui.filter((entry) => entry.includes('seek'))).toHaveLength(2);
    expect(play.audio.filter((entry) => / (start|seek 1|dispose|finish)$/.test(entry))).toEqual([
      '0.000 start',
      '0.000 seek 1',
      '3210.000 seek 1',
      '6300.000 dispose',
    ]);
    // The second time through starts from nothing: no judgment yet just before the range, the starting gauge, and by
    // its end three misses and none of the first time's hit.
    expect(play.captured?.['1.9']?.counts).toMatchObject({ perfect: 0, great: 0, poor: 0, exScore: 0, combo: 0 });
    expect(play.captured?.['1.9']?.gauge).toBe(20);
    expect(play.captured?.['1.9']?.notes).toEqual([]);
    expect(play.captured?.['3.9']?.counts).toMatchObject({ perfect: 0, poor: 3, exScore: 0 });
    expect(play.summary).toMatchObject({ perfect: 0, poor: 3, exScore: 0 });
    expect(play.replay).toBeUndefined();
  });

  test('goes back to the start when a survival gauge empties instead of ending the play', async () => {
    const play = await observePlay({
      driver: 'manual',
      chart: basicChart(),
      options: {
        judgeRuleset: 'beatoraja',
        endOnFailure: true,
        practice: { ...range, gauge: 'HARD', startGauge: 2, loop: true },
      },
      script: [command(4000, { kind: 'interrupt', reason: 'escape' })],
    });
    expect(play.outcome).toBe('completed');
    // The first miss at 2.0 + the BAD reach empties the 2 % gauge; the play starts again from 1.0 at once, before the
    // range is over.
    const restarts = play.frames.generations?.slice(1) ?? [];
    expect(restarts.length).toBeGreaterThanOrEqual(1);
    expect(restarts[0]).toMatch(/generation=2 seconds=1 /);
    expect(Number.parseFloat(restarts[0]!)).toBeLessThan(3200);
    expect(play.summary?.gauge?.failedMidPlay).not.toBe(true);
  });

  test('a practice play without the loop ends at the end of its range as before', async () => {
    const play = await observePlay({
      driver: 'manual',
      chart: basicChart(),
      options: { judgeRuleset: 'beatoraja', practice: range },
      script: tap(1500, '11'),
    });
    expect(play.outcome).toBe('completed');
    expect(play.frames.generations).toHaveLength(1);
    expect(play.summary).toMatchObject({ perfect: 1, poor: 2 });
  });
});

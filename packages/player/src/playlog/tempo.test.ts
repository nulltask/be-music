import { createEmptyJson } from '../../../json/src/index.ts';
import { describe, expect, test } from 'vite-plus/test';
import { manualPlay } from '../index.ts';
import type { PlayerInputCommand } from '../core/input-signal-bus.ts';
import { createScheduledInputRuntime } from '../test-support/player-fixtures.ts';
import type { BeMusicPlaylog } from './format.ts';
import { simulatePlaylog } from './simulate.ts';

/**
 * A play at another tempo (`speed`) runs its clock `speed` times as fast, but judges and records in chart time, so its
 * play log re-simulates to the same judgments as the live play, and records the tempo for a replay.
 */

/** Four notes on lane 11, a beat apart at 120 BPM: chart 0.5, 1.0, 1.5 and 2.0 s. */
function chart() {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 120;
  json.events = [
    { measure: 0, channel: '11', position: [1, 4] as const, value: '01' },
    { measure: 0, channel: '11', position: [2, 4] as const, value: '01' },
    { measure: 0, channel: '11', position: [3, 4] as const, value: '01' },
    { measure: 1, channel: '11', position: [0, 4] as const, value: '01' },
  ];
  return json;
}

const tap = (delayMs: number) => ({ delayMs, command: { kind: 'lane-input', tokens: ['z'] } as PlayerInputCommand });
const escape = (delayMs: number) => ({
  delayMs,
  command: { kind: 'interrupt', reason: 'escape' } as PlayerInputCommand,
});

async function playAt(speed: number, schedule: Array<{ delayMs: number; command: PlayerInputCommand }>) {
  let playlog: BeMusicPlaylog | undefined;
  const summary = await manualPlay(chart(), {
    speed,
    leadInMs: 0,
    audio: false,
    tui: false,
    writeOutput: () => undefined,
    createInputRuntime: createScheduledInputRuntime(schedule),
    recordPlaylog: {},
    onPlaylogRecorded: (recorded) => {
      playlog = recorded;
    },
  }).catch(() => undefined);
  return { summary, playlog: playlog! };
}

describe('play tempo', () => {
  test('a play at tempo 0.5 records its tempo and chart-time inputs, and re-simulates to the same judgments', async () => {
    // At tempo 0.5 a note at chart t is due at wall clock 2t: on time, 30 ms of chart time late, 50 ms early, and one
    // left to pass, so the comparison spans several judges.
    const { summary, playlog } = await playAt(0.5, [tap(1000), tap(2060), tap(2900), tap(4400)]);
    expect(summary).toBeDefined();
    expect(playlog.play.tempo).toBe(0.5);
    const downs = playlog.inputs.filter((input) => input.action === 'down');
    expect(downs.length).toBeGreaterThanOrEqual(3);
    // Recorded in chart time: the first tap, 1 s of wall clock in, lands at chart 0.5 s (not 1 s).
    expect(downs[0]!.timeUs).toBeGreaterThan(400_000);
    expect(downs[0]!.timeUs).toBeLessThan(700_000);

    const simulated = simulatePlaylog(playlog, { ruleset: 'lr2' });
    expect([summary!.perfect, summary!.great, summary!.good, summary!.bad, summary!.poor, summary!.emptyPoor]).toEqual([
      simulated.judge.pgreat,
      simulated.judge.great,
      simulated.judge.good,
      simulated.judge.bad,
      simulated.judge.poor,
      simulated.judge.emptyPoor,
    ]);
    expect(summary!.exScore).toBe(simulated.exScore);
    expect(summary!.perfect + summary!.great).toBeGreaterThan(0);
  }, 20_000);

  test('a play at tempo 1 records no tempo', async () => {
    const { playlog } = await playAt(1, [escape(100)]);
    expect(playlog.play).not.toHaveProperty('tempo');
  });
});

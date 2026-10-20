import { createEmptyJSON } from '../../../json/src/index.ts';
import { describe, expect, test } from 'vite-plus/test';
import { autoPlay, manualPlay } from '../index.ts';
import type { PlayerInputCommand } from '../core/input-signal-bus.ts';
import type { AudioSession, PlayerTempoChange } from '../core/engine-types.ts';
import { createScheduledInputRuntime } from '../test-support/player-fixtures.ts';
import type { BeMusicReplay } from './format.ts';
import { simulateReplay } from './simulate.ts';

/**
 * A play at another tempo (`speed`) runs its clock `speed` times as fast, but judges and records in chart time, so its
 * replay re-simulates to the same judgments as the live play, and records the tempo for a replay.
 */

/** Four notes on lane 11, a beat apart at 120 BPM: chart 0.5, 1.0, 1.5 and 2.0 s. */
function chart() {
  const json = createEmptyJSON('bms');
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
const tempoTo = (delayMs: number, tempo: number) => ({
  delayMs,
  command: { kind: 'tempo', tempo } as PlayerInputCommand,
});
const escape = (delayMs: number) => ({
  delayMs,
  command: { kind: 'interrupt', reason: 'escape' } as PlayerInputCommand,
});

async function playAt(speed: number, schedule: Array<{ delayMs: number; command: PlayerInputCommand }>) {
  let replay: BeMusicReplay | undefined;
  const summary = await manualPlay(chart(), {
    speed,
    leadInMs: 0,
    audio: false,
    tui: false,
    writeOutput: () => undefined,
    createInputRuntime: createScheduledInputRuntime(schedule),
    recordReplay: {},
    onReplayRecorded: (recorded) => {
      replay = recorded;
    },
  }).catch(() => undefined);
  return { summary, replay: replay! };
}

describe('play tempo', () => {
  test('a play at tempo 0.5 records its tempo and chart-time inputs, and re-simulates to the same judgments', async () => {
    // At tempo 0.5 a note at chart t is due at wall clock 2t: on time, 30 ms of chart time late, 50 ms early, and one
    // left to pass, so the comparison spans several judges.
    const { summary, replay } = await playAt(0.5, [tap(1000), tap(2060), tap(2900), tap(4400)]);
    expect(summary).toBeDefined();
    expect(replay.play.tempo).toBe(0.5);
    const downs = replay.inputs.filter((input) => input.action === 'down');
    expect(downs.length).toBeGreaterThanOrEqual(3);
    // Recorded in chart time: the first tap, 1 s of wall clock in, lands at chart 0.5 s (not 1 s).
    expect(downs[0]!.timeUs).toBeGreaterThan(400_000);
    expect(downs[0]!.timeUs).toBeLessThan(700_000);

    const simulated = simulateReplay(replay, { ruleset: 'lr2' });
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

  test('a replay records no tempo: its speed only sets how fast it is re-driven', async () => {
    const live = await playAt(1, [tap(500), escape(1200)]);
    let replayed: BeMusicReplay | undefined;
    await manualPlay(chart(), {
      speed: 8,
      leadInMs: 0,
      audio: false,
      tui: false,
      writeOutput: () => undefined,
      replayInputs: live.replay.inputs,
      recordReplay: {},
      onReplayRecorded: (recorded) => {
        replayed = recorded;
      },
    });
    expect(replayed?.play).not.toHaveProperty('tempo');
  });

  test('a play at tempo 1 records no tempo', async () => {
    const { replay } = await playAt(1, [escape(100)]);
    expect(replay.play).not.toHaveProperty('tempo');
  });

  test('a tempo change during the play keeps chart time continuous, is recorded, and re-simulates the same', async () => {
    // At tempo 1 until wall 700 ms (chart 0.7 s), then 0.5: chart 1.0 s is due at wall 1300 ms, 1.5 s at 2300 ms and
    // 2.0 s at 3300 ms.
    const changes: PlayerTempoChange[] = [];
    let replay: BeMusicReplay | undefined;
    const summary = await manualPlay(chart(), {
      leadInMs: 0,
      audio: false,
      tui: false,
      writeOutput: () => undefined,
      createInputRuntime: createScheduledInputRuntime([tap(500), tempoTo(700, 0.5), tap(1300), tap(2330), tap(3250)]),
      recordReplay: {},
      onTempoChange: (change) => changes.push(change),
      onReplayRecorded: (recorded) => {
        replay = recorded;
      },
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.tempo).toBe(0.5);
    expect(changes[0]!.seconds).toBeGreaterThan(0.65);
    expect(changes[0]!.seconds).toBeLessThan(0.8);
    expect(replay!.play).not.toHaveProperty('tempo');
    expect(replay!.play.tempoChanges).toEqual([{ timeUs: Math.round(changes[0]!.seconds * 1e6), tempo: 0.5 }]);
    // Chart time runs at half speed after the change: the tap 600 ms of wall clock after it lands near chart 1.0 s.
    const downs = replay!.inputs.filter((input) => input.action === 'down');
    expect(downs[1]!.timeUs).toBeGreaterThan(950_000);
    expect(downs[1]!.timeUs).toBeLessThan(1_080_000);

    const simulated = simulateReplay(replay!, { ruleset: 'lr2' });
    expect([summary.perfect, summary.great, summary.good, summary.bad, summary.poor, summary.emptyPoor]).toEqual([
      simulated.judge.pgreat,
      simulated.judge.great,
      simulated.judge.good,
      simulated.judge.bad,
      simulated.judge.poor,
      simulated.judge.emptyPoor,
    ]);
    expect(summary.exScore).toBe(simulated.exScore);
    expect(summary.perfect + summary.great).toBeGreaterThanOrEqual(3);
  }, 20_000);

  test('a replay follows its recorded tempo changes and tells the audio backend, recording none itself', async () => {
    const live = await playAt(1, [tap(500), tap(1000), tap(1500), tap(2000)]);
    const audioTempos: number[] = [];
    const audioSession: AudioSession = {
      start: () => undefined,
      finish: async () => undefined,
      dispose: async () => undefined,
      pause: () => undefined,
      resume: () => undefined,
      chartStartDelayMs: 0,
      backendLabel: 'test',
      setTempo: (tempo) => audioTempos.push(tempo),
    };
    const changes: PlayerTempoChange[] = [];
    let replayed: BeMusicReplay | undefined;
    const summary = await manualPlay(chart(), {
      leadInMs: 0,
      tui: false,
      writeOutput: () => undefined,
      createAudioSession: async () => audioSession,
      replayInputs: live.replay.inputs,
      replayTempoChanges: [{ timeUs: 300_000, tempo: 2 }],
      onTempoChange: (change) => changes.push(change),
      recordReplay: {},
      onReplayRecorded: (recorded) => {
        replayed = recorded;
      },
    });
    expect(changes.map((change) => change.tempo)).toEqual([2]);
    expect(changes[0]!.seconds).toBeGreaterThanOrEqual(0.3);
    expect(audioTempos).toEqual([2]);
    expect(replayed?.play).not.toHaveProperty('tempoChanges');
    expect(summary.exScore).toBe(live.summary!.exScore);
  }, 20_000);

  test('an auto replay follows its log’s tempo changes, and an auto play records where ESC stopped it', async () => {
    const audioTempos: number[] = [];
    const audioSession: AudioSession = {
      start: () => undefined,
      finish: async () => undefined,
      dispose: async () => undefined,
      pause: () => undefined,
      resume: () => undefined,
      chartStartDelayMs: 0,
      backendLabel: 'test',
      setTempo: (tempo) => audioTempos.push(tempo),
    };
    const changes: PlayerTempoChange[] = [];
    await autoPlay(chart(), {
      leadInMs: 0,
      tui: false,
      writeOutput: () => undefined,
      createAudioSession: async () => audioSession,
      // A replay of an AUTO-played log: its inputs are empty.
      replayInputs: [],
      replayTempoChanges: [{ timeUs: 300_000, tempo: 2 }],
      onTempoChange: (change) => changes.push(change),
    });
    expect(changes.map((change) => change.tempo)).toEqual([2]);
    expect(audioTempos).toEqual([2]);
    // A live AUTO play leaves them alone.
    const liveChanges: PlayerTempoChange[] = [];
    await autoPlay(chart(), {
      leadInMs: 0,
      audio: false,
      tui: false,
      writeOutput: () => undefined,
      replayTempoChanges: [{ timeUs: 300_000, tempo: 2 }],
      onTempoChange: (change) => liveChanges.push(change),
    });
    expect(liveChanges).toEqual([]);

    let given: BeMusicReplay | undefined;
    await autoPlay(chart(), {
      leadInMs: 0,
      audio: false,
      tui: false,
      writeOutput: () => undefined,
      createInputRuntime: createScheduledInputRuntime([escape(800)]),
      recordReplay: {},
      onReplayRecorded: (recorded) => {
        given = recorded;
      },
    }).catch(() => undefined);
    expect(given?.play.aborted).toBe(true);
    // About 0.8 s into the chart, so a course counts the stage's time up to there.
    expect(given?.play.abortedAtUs).toBeGreaterThan(500_000);
    expect(given?.play.abortedAtUs).toBeLessThan(1_500_000);
  }, 20_000);
});

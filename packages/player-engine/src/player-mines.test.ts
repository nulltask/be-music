import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';

// The engine writes to a mocked Node audio sink (shared state in test-support/player-fixtures.ts).
vi.mock('./audio-sink.ts', async () => (await import('./test-support/player-fixtures.ts')).mockAudioSinkModule());

import { createEmptyJSON } from '../../chart-source/src/index.ts';
import { manualPlay } from './index.ts';
import { createVirtualClock } from './core/characterization/virtual-clock.ts';
import { resetAudioSinkState, createScheduledInputRuntime } from './test-support/player-fixtures.ts';

beforeEach(resetAudioSinkState);

/**
 * Runs a play on a fresh virtual clock, so the scheduled input lands exactly at its delay. The mine tests hinge on a
 * tap's distance from the crossing (PGREAT window, press grace), which a late host timer under load could move.
 */
const onVirtualClock = <T>(play: () => Promise<T>): Promise<T> => createVirtualClock().run(play);

describe('player', () => {
  test('player: holding a key through a passing mine detonates it (LR2 hold-through)', async () => {
    // BPM 120 → measure 1 = 2.0 s. Hold the lane from ~0.2 s via kitty press state (no release) and let the mine
    // cross the judge line at 2.0 s — LR2 explodes mines that pass while the key is ON.
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 1, channel: 'D1', position: [0, 1] as const, value: '0A' }]; // raw 10 %

    const summary = await onVirtualClock(() =>
      manualPlay(json, {
        speed: 1,
        leadInMs: 0,
        audio: false,
        tui: false,
        createInputRuntime: createScheduledInputRuntime([
          { delayMs: 200, command: { kind: 'kitty-state', pressTokens: ['z'], repeatTokens: [], releaseTokens: [] } },
          { delayMs: 2300, command: { kind: 'interrupt', reason: 'escape' } },
        ]),
      }),
    );

    expect(summary.bad).toBe(0);
    expect(summary.gauge?.current).toBeCloseTo(10, 9); // 20 - 10
  });

  test('player: a mine passing with the key up is harmless (LR2)', async () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 1, channel: 'D1', position: [0, 1] as const, value: '0A' }];

    const summary = await onVirtualClock(() =>
      manualPlay(json, {
        speed: 1,
        leadInMs: 0,
        audio: false,
        tui: false,
        createInputRuntime: createScheduledInputRuntime([
          { delayMs: 2300, command: { kind: 'interrupt', reason: 'escape' } },
        ]),
      }),
    );

    expect(summary.bad).toBe(0);
    expect(summary.gauge?.current).toBeCloseTo(20, 9);
  });

  test('player: a press outside the PGREAT window does not detonate an approaching mine (LR2)', async () => {
    // BPM 120, NORMAL rank → PGREAT window ±18 ms. The mine sits at 2.0 s; a tap at ~1.7 s is 300 ms early —
    // far outside the detonation range — and the key is up again (grace expired) by the time the mine crosses.
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 1, channel: 'D1', position: [0, 1] as const, value: '0A' }];

    const summary = await onVirtualClock(() =>
      manualPlay(json, {
        speed: 1,
        leadInMs: 0,
        audio: false,
        tui: false,
        createInputRuntime: createScheduledInputRuntime([
          { delayMs: 1700, command: { kind: 'lane-input', tokens: ['z'] } },
          { delayMs: 2300, command: { kind: 'interrupt', reason: 'escape' } },
        ]),
      }),
    );

    expect(summary.bad).toBe(0);
    expect(summary.gauge?.current).toBeCloseTo(20, 9);
  });

  test('player: a press inside GOOD but outside the PGREAT window does not detonate a mine (LR2)', async () => {
    // LR2's changelog pins the press-detonation range to the PGREAT window (±18 ms at NORMAL rank), not GOOD
    // (±100 ms). The mine passes at 2.0 s; a tap at ~2.04 s — 40 ms late, still inside GOOD — must not detonate
    // it: the press missed PGREAT, and the crossing-anchored hold-through leg ignores presses that land after the
    // crossing, so this holds even when the tap is the first processing past the window.
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 1, channel: 'D1', position: [0, 1] as const, value: '0A' }];

    const summary = await onVirtualClock(() =>
      manualPlay(json, {
        speed: 1,
        leadInMs: 0,
        audio: false,
        tui: false,
        createInputRuntime: createScheduledInputRuntime([
          { delayMs: 2040, command: { kind: 'lane-input', tokens: ['z'] } },
          { delayMs: 2300, command: { kind: 'interrupt', reason: 'escape' } },
        ]),
      }),
    );

    expect(summary.bad).toBe(0);
    expect(summary.gauge?.current).toBeCloseTo(20, 9);
  });

  test('player: a tap shortly before a passing mine detonates it (LR2 hold-through via the press grace)', async () => {
    // Non-kitty input has no release events, so a tap counts as "held" for the LN hold-grace window (120 ms).
    // A tap at 1.95 s (exact on the virtual clock) therefore covers the mine's 2.0 s crossing, and the
    // crossing-anchored hold-through leg detonates it deterministically once the PGREAT window closes — no
    // positive-coverage dependence on a frame tick sampling the ±18 ms window itself.
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.events = [{ measure: 1, channel: 'D1', position: [0, 1] as const, value: '0A' }]; // raw 10 %

    const summary = await onVirtualClock(() =>
      manualPlay(json, {
        speed: 1,
        leadInMs: 0,
        audio: false,
        tui: false,
        createInputRuntime: createScheduledInputRuntime([
          { delayMs: 1950, command: { kind: 'lane-input', tokens: ['z'] } },
          { delayMs: 2300, command: { kind: 'interrupt', reason: 'escape' } },
        ]),
      }),
    );

    expect(summary.bad).toBe(0);
    expect(summary.gauge?.current).toBeCloseTo(10, 9); // 20 - 10
  });

  test('player: LR2 negative BPM freezes judging and audio at the reversal (manual)', async () => {
    // BPM 240 → measure = 1 s. A note+BGM at 1 s, the reversal (#BPM02 -240 via channel 08) at 2 s, and a
    // note+BGM at 3 s (|−240| keeps one measure per second). The pre-reversal note misses normally; everything
    // behind the reversal must stay silent and unjudged — not swept into POORs at the end of the run.
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 240;
    json.resources.bpm['02'] = -240;
    json.resources.wav = { '01': 'a.wav', '02': 'b.wav', '03': 'bgm.wav' };
    json.events = [
      { measure: 1, channel: '11', position: [0, 1] as const, value: '01' },
      { measure: 1, channel: '01', position: [0, 1] as const, value: '03' },
      { measure: 2, channel: '08', position: [0, 1] as const, value: '02' },
      { measure: 3, channel: '11', position: [0, 1] as const, value: '02' },
      { measure: 3, channel: '01', position: [0, 1] as const, value: '03' },
    ];

    const triggeredEvents: string[] = [];
    const summary = await manualPlay(json, {
      speed: 4,
      leadInMs: 0,
      audio: true,
      tui: false,
      createAudioSession: async () => ({
        backendLabel: 'recording-audio',
        chartStartDelayMs: 0,
        start: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        finish: async () => undefined,
        dispose: async () => undefined,
        triggerEvent: (event) => {
          triggeredEvents.push(event.value);
        },
        stopChannel: () => undefined,
      }),
      createInputRuntime: createScheduledInputRuntime([]),
    });

    // Only the pre-reversal BGM sounded; the 3 s BGM sits behind the frozen pump.
    expect(triggeredEvents).toEqual(['03']);
    // The 1 s note missed on time; the 3 s note ends the run unjudged (total still counts it).
    expect(summary.poor).toBe(1);
    expect(summary.total).toBe(2);
    expect(summary.perfect + summary.great + summary.good + summary.bad + summary.poor).toBe(1);
    // ...which leaves the run FAILED with the gauge at 0 (LR2 zeroes HP when a play ends with notes outstanding).
    expect(summary.gauge?.current).toBe(0);
    expect(summary.gauge?.cleared).toBe(false);
  });
});

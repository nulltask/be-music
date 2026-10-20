import { describe, expect, test } from 'vite-plus/test';
import { createEmptyJSON } from '../../chart-source/src/index.ts';
import {
  collectSampleTriggers,
  createTimingBuildContext,
  createTimingResolver,
  createTimingResolverWithContext,
  firesBeforeTempoReversal,
  mirrorBeatAtTempoReversal,
  resolveChart,
} from './index.ts';

describe('timing', () => {
  test('integrates BPM changes and stops into seconds', () => {
    const json = createEmptyJSON();
    json.metadata.bpm = 120;
    json.resources.bpm['01'] = 240;
    json.resources.stop['01'] = 48;
    json.events = [
      { measure: 1, channel: '08', position: [0, 1], value: '01' },
      { measure: 1, channel: '09', position: [1, 2], value: '01' },
      { measure: 2, channel: '11', position: [0, 1], value: '0A' },
    ];
    const timing = createTimingResolver(json);
    expect(timing.tempoPoints).toEqual([
      { beat: 0, bpm: 120, seconds: 0 },
      { beat: 4, bpm: 240, seconds: 2 },
    ]);
    // 48 / 192 of a 240 BPM measure = 0.25 s.
    expect(timing.stopPoints).toEqual([{ beat: 6, seconds: 0.25, cumulativeSeconds: 0.25 }]);
    // Measure 2 starts at beat 8: 2 s + 4 beats at 240 BPM + the stop.
    expect(timing.beatToSeconds(8)).toBeCloseTo(3.25);
    expect(timing.bpmAtBeat(5)).toBe(240);
  });

  test('keeps the last BMS #STOP at one position, as LR2 and beatoraja do', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.resources.stop['01'] = 48;
    json.resources.stop['02'] = 96;
    json.bms.stp = ['001.000 500'];
    json.events = [
      { measure: 1, channel: '09', position: [0, 1], value: '01' },
      { measure: 1, channel: '09', position: [0, 1], value: '02' },
    ];
    // 96 / 192 of a 120 BPM measure = 1 s replaces the 0.5 s stop; `#STP` lines still add up (0.5 s).
    expect(createTimingResolver(json).stopPoints.map((point) => point.seconds)).toEqual([0.5, 1]);
  });

  test('adds up bmson stop_events on one pulse, as the bmson spec says', () => {
    const json = createEmptyJSON('bmson');
    json.metadata.bpm = 120;
    json.resources.stop['01'] = 48;
    json.resources.stop['02'] = 96;
    json.events = [
      { measure: 1, channel: '09', position: [0, 1], value: '01' },
      { measure: 1, channel: '09', position: [0, 1], value: '02' },
    ];
    expect(createTimingResolver(json).stopPoints.at(-1)?.cumulativeSeconds).toBeCloseTo(1.5);
  });

  test('reads #STP stops in milliseconds', () => {
    const json = createEmptyJSON();
    json.metadata.bpm = 120;
    json.bms.stp = ['001.500 1000'];
    const timing = createTimingResolver(json);
    expect(timing.stopPoints).toEqual([{ beat: 6, seconds: 1, cumulativeSeconds: 1 }]);
  });

  test('the context variant gives the same resolver', () => {
    const json = createEmptyJSON();
    json.metadata.bpm = 150;
    json.events = [{ measure: 0, channel: '03', position: [1, 2], value: '78' }];
    const context = createTimingBuildContext(json);
    expect(createTimingResolverWithContext(json, context).tempoPoints).toEqual(createTimingResolver(json).tempoPoints);
  });
});

describe('sample triggers', () => {
  test('collects BGM and lane keysounds but not mines or #LNOBJ tails', () => {
    const json = createEmptyJSON();
    json.metadata.bpm = 120;
    json.bms.lnObjs = ['ZZ'];
    json.resources.wav['01'] = 'a.wav';
    json.events = [
      { measure: 0, channel: '01', position: [0, 1], value: '01' },
      { measure: 0, channel: '11', position: [1, 2], value: '01' },
      { measure: 1, channel: '11', position: [0, 1], value: 'ZZ' },
      { measure: 1, channel: 'D1', position: [0, 1], value: '0A' },
    ];
    expect(
      collectSampleTriggers(json).map((trigger) => [
        trigger.seconds,
        trigger.channel,
        trigger.sampleKey,
        trigger.samplePath,
      ]),
    ).toEqual([
      [0, '01', '01', 'a.wav'],
      [1, '11', '01', 'a.wav'],
    ]);
  });
});

describe('LR2 negative-BPM reversal', () => {
  test('integrates negative #BPMxx at |BPM| and exposes the LR2 reversal point', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.resources.bpm['02'] = -60;
    json.events = [
      { measure: 1, channel: '08', position: [0, 1], value: '02' },
      { measure: 2, channel: '01', position: [0, 1], value: '01' },
    ];

    const resolver = createTimingResolver(json);
    // LR2 integrates the timeline at |BPM| (LR2_bmsload.cpp:2841-2843): measure 1 opens at 2 s (BPM 120), and the
    // following measure runs at |−60|, so measure 2 lands at 2 + 4 s.
    expect(resolver.reversal?.beat).toBeCloseTo(4, 9);
    expect(resolver.reversal?.seconds).toBeCloseTo(2, 9);
    expect(resolver.bpmAtBeat(6)).toBeCloseTo(60, 9);
    expect(resolver.beatToSeconds(8)).toBeCloseTo(6, 9);
  });

  test('mirrors the display beat in chart-position space past the LR2 reversal', () => {
    // LR2: `songtimer = 2 * bpmChangedBmstime - songtimer` on the FORWARD position (LR2body.exe 0x406d81) — the
    // mirror is in beats, so how fast the chart recedes is however fast the forward beat advances past the reversal.
    const reversal = { beat: 16, seconds: 7.38 };
    expect(mirrorBeatAtTempoReversal(reversal, 5, 10)).toBe(10); // before the reversal: unchanged
    expect(mirrorBeatAtTempoReversal(reversal, 7.38, 16)).toBe(16); // exactly at it: not mirrored yet
    expect(mirrorBeatAtTempoReversal(reversal, 9, 17.5)).toBeCloseTo(14.5, 9); // 1.5 beats past → 1.5 beats back
    expect(mirrorBeatAtTempoReversal(reversal, 60, 40)).toBe(0); // pinned at the chart head (documented deviation)
    expect(mirrorBeatAtTempoReversal(undefined, 60, 40)).toBe(40); // no reversal armed
  });

  test('truncates a negative #BPMxx to an integer before arming the LR2 reversal', () => {
    // LR2 converts the BPM to int before its `< 0` check (LR2body.exe 0x42b960 `__ftol`): -1 < BPM < 0 never
    // reverses, but timing still integrates the full |BPM|. NOWBPM shows |trunc(BPM)|.
    const fractional = createEmptyJSON('bms');
    fractional.metadata.bpm = 120;
    fractional.resources.bpm['02'] = -0.5;
    fractional.events = [{ measure: 1, channel: '08', position: [0, 1], value: '02' }];
    const slow = createTimingResolver(fractional);
    expect(slow.reversal).toBeUndefined();
    expect(slow.bpmAtBeat(6)).toBeCloseTo(0.5, 9);
    expect(slow.beatToSeconds(5)).toBeCloseTo(2 + 120, 9); // one beat at 0.5 BPM = 120 s
    expect(slow.displayBPMAtBeat(6)).toBe(0);
    expect(slow.displayBPMAtBeat(2)).toBe(120);

    const truncated = createEmptyJSON('bms');
    truncated.metadata.bpm = 120;
    truncated.resources.bpm['02'] = -65.5;
    truncated.events = [{ measure: 1, channel: '08', position: [0, 1], value: '02' }];
    const reversing = createTimingResolver(truncated);
    expect(reversing.reversal?.beat).toBeCloseTo(4, 9);
    expect(reversing.bpmAtBeat(6)).toBeCloseTo(65.5, 9);
    expect(reversing.displayBPMAtBeat(6)).toBe(65);
  });

  test('keeps dropping zero and undefined #BPMxx references (no reversal)', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.resources.bpm['02'] = 0;
    json.events = [
      { measure: 1, channel: '08', position: [0, 1], value: '02' },
      { measure: 2, channel: '08', position: [0, 1], value: 'ZZ' },
    ];

    const resolver = createTimingResolver(json);
    expect(resolver.reversal).toBeUndefined();
    // Both events are ignored: the previous tempo continues (real LR2 degenerates on both — documented deviation).
    expect(resolver.bpmAtBeat(10)).toBeCloseTo(120, 9);
    expect(resolver.beatToSeconds(8)).toBeCloseTo(4, 9);
  });

  test('fires only BGM, BPM and BGA on the LR2 reversal tick, and nothing behind it', () => {
    // LR2 orders same-tick events by op (`CMP_NotesByRealTimingOp`): BGM (1), BPM (3) and the BGA layers (4 / 6 / 7)
    // precede the negative BPM (op 8); STOP (9), lane sounds (10+) and invisible objects (30+) come after it.
    const reversal = { beat: 16, seconds: 7.5 };
    expect(firesBeforeTempoReversal(reversal, 7, '11')).toBe(true); // strictly before: everything fires
    for (const channel of ['01', '03', '04', '06', '07', '0A', '0a']) {
      expect(firesBeforeTempoReversal(reversal, 7.5, channel)).toBe(true);
    }
    for (const channel of ['09', '11', '16', '31', 'D1', '97']) {
      expect(firesBeforeTempoReversal(reversal, 7.5, channel)).toBe(false);
    }
    expect(firesBeforeTempoReversal(reversal, 7.6, '01')).toBe(false); // strictly behind: nothing fires
    expect(firesBeforeTempoReversal(undefined, 60, '11')).toBe(true); // no reversal armed
  });

  test('the resolved chart exposes the reversal of its tempo map', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.resources.bpm['02'] = -60;
    json.events = [{ measure: 1, channel: '08', position: [0, 1], value: '02' }];
    expect(resolveChart(json).reversal).toEqual({ beat: 4, seconds: 2 });
    expect(resolveChart(createEmptyJSON('bms')).reversal).toBeUndefined();
  });
});

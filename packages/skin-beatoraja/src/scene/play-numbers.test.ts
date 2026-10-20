import type { LaneCoverState } from '@be-music/player-scene-model';
import { describe, expect, it } from 'vite-plus/test';
import {
  BEATORAJA_NUM,
  SYNTHETIC_NUM_JUDGE_COMBO_1P,
  SYNTHETIC_NUM_JUDGE_COMBO_2P,
  SYNTHETIC_NUM_JUDGE_COMBO_3P,
} from '../runtime-ids.ts';
import { beatorajaBPMAt, resolveBeatorajaPlayNumber, type BeatorajaPlayNumberInput } from './play-numbers.ts';

function cover(overrides: Partial<LaneCoverState> = {}): LaneCoverState {
  return { side: '1P', sudden: 0, suddenOn: false, hidden: 0, hiddenOn: false, lift: 0, ...overrides };
}

function input(overrides: Partial<BeatorajaPlayNumberInput> = {}): BeatorajaPlayNumberInput {
  return {
    combo: 0,
    maxCombo: 0,
    hiSpeed: 1,
    chart: { bpm: 130, minBPM: 130, maxBPM: 130 },
    ...overrides,
  };
}

describe('resolveBeatorajaPlayNumber — hi-speed and covers', () => {
  it('splits the hi-speed as beatoraja casts it', () => {
    const numbers = input({ hiSpeed: 3.42 });
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.HISPEED, numbers)).toBe(3);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.HISPEED_AFTERDOT, numbers)).toBe(42);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.HISPEED_LR2, numbers)).toBe(342);
    // (int)(1.555 * 100) truncates to 155.
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.HISPEED_AFTERDOT, input({ hiSpeed: 1.555 }))).toBe(55);
  });

  it('reads the lane cover and LIFT in per mille, the lane cover of the lane above the LIFT', () => {
    // IntegerPropertyFactory: (int) (lanecover * 1000) and (int) (lift * 1000).
    const numbers = input({ cover: cover({ sudden: 0.25, suddenOn: true, lift: 0.104 }) });
    // 0.25 of the whole lane is 0.25 / 0.896 = 0.2790... of the lane above the LIFT.
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.LANECOVER1, numbers)).toBe(279);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.LIFT1, numbers)).toBe(104);
    // Ten 0.01 steps add up to 0.09999999999999999: on beatoraja's floats that reads 100, not the 99 a double gives.
    const noLift = input({ cover: cover({ sudden: 0.09999999999999999, suddenOn: true }) });
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.LANECOVER1, noLift)).toBe(100);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.LIFT1, noLift)).toBe(0);
    // beatoraja reads the stored lane cover while it is off.
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.LANECOVER1, input({ cover: cover({ sudden: 0.25 }) }))).toBe(250);
    expect(
      resolveBeatorajaPlayNumber(BEATORAJA_NUM.LANECOVER1, input({ cover: cover({ sudden: 0.8, lift: 0.5 }) })),
    ).toBe(1000);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.LANECOVER1, input())).toBe(0);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.HIDDEN1, numbers)).toBe(0);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.JUDGETIMING, numbers)).toBe(0);
  });
});

describe('resolveBeatorajaPlayNumber — white and green numbers', () => {
  it('follows LaneRenderer: 240000 / BPM / hi-speed, less the lane cover, LIFT ignored', () => {
    // 240000 / 140 / 3.42 = 501.25.
    expect(
      resolveBeatorajaPlayNumber(
        BEATORAJA_NUM.DURATION,
        input({ hiSpeed: 3.42, chart: { bpm: 140, minBPM: 140, maxBPM: 140 } }),
      ),
    ).toBe(501);
    const covered = input({ cover: cover({ sudden: 0.5, suddenOn: true, lift: 0.3 }) });
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.DURATION, covered)).toBe(923);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.DURATION_LANECOVER_ON, covered)).toBe(923);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.DURATION_LANECOVER_OFF, covered)).toBe(1846);
    // Green: three fifths of the rounded white number.
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.DURATION_GREEN, input())).toBe(1108);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.DURATION_GREEN_LANECOVER_ON, covered)).toBe(554);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.DURATION_GREEN_LANECOVER_OFF, covered)).toBe(1108);
  });

  it('reads the main, lowest and highest BPM for their variants', () => {
    const numbers = input({ chart: { bpm: 150, mainBPM: 120, minBPM: 60, maxBPM: 240 } });
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.MAINBPM_DURATION_LANECOVER_OFF, numbers)).toBe(2000);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.MAINBPM_DURATION_GREEN_LANECOVER_OFF, numbers)).toBe(1200);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.MINBPM_DURATION_LANECOVER_OFF, numbers)).toBe(4000);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.MINBPM_DURATION_GREEN_LANECOVER_OFF, numbers)).toBe(2400);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.MAXBPM_DURATION_LANECOVER_OFF, numbers)).toBe(1000);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.MAXBPM_DURATION_GREEN_LANECOVER_OFF, numbers)).toBe(600);
    const covered = { ...numbers, cover: cover({ sudden: 0.5, suddenOn: true }) };
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.MAINBPM_DURATION_LANECOVER_ON, covered)).toBe(1000);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.MAINBPM_DURATION_GREEN_LANECOVER_ON, covered)).toBe(600);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.MINBPM_DURATION_LANECOVER_ON, covered)).toBe(2000);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.MINBPM_DURATION_GREEN_LANECOVER_ON, covered)).toBe(1200);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.MAXBPM_DURATION_LANECOVER_ON, covered)).toBe(500);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.MAXBPM_DURATION_GREEN_LANECOVER_ON, covered)).toBe(300);
  });

  it('reads 0 for a BPM or hi-speed that is not positive', () => {
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.DURATION, input({ chart: { bpm: 0, minBPM: 0, maxBPM: 0 } }))).toBe(
      0,
    );
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.DURATION, input({ hiSpeed: 0 }))).toBe(0);
  });
});

describe('resolveBeatorajaPlayNumber — BPMs and time', () => {
  const segments = [
    { timeMs: 0, bpm: 120 },
    { timeMs: 10_000, bpm: 240 },
    { timeMs: 20_000, bpm: 0 },
    { timeMs: 21_000, bpm: 90 },
  ];
  const chart = { bpm: 120, mainBPM: 150, minBPM: 90, maxBPM: 240, bpmSegments: segments, playLevel: '☆12' };

  it('reads the chart BPMs and #PLAYLEVEL', () => {
    const numbers = input({ chart: { ...chart, minBPM: 89.6, maxBPM: 240.4 } });
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.MAXBPM, numbers)).toBe(240);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.MINBPM, numbers)).toBe(90);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.MAINBPM, numbers)).toBe(150);
    // The main BPM falls back on the header BPM.
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.MAINBPM, input({ chart: { ...chart, mainBPM: 0 } }))).toBe(120);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.PLAYLEVEL, input({ chart: { ...chart, playLevel: '12' } }))).toBe(
      12,
    );
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.PLAYLEVEL, input({ chart: { ...chart, playLevel: 7.9 } }))).toBe(7);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.PLAYLEVEL, numbers)).toBe(0);
  });

  it('tracks the BPM at the playhead, a STOP holding the BPM before it', () => {
    const at = (currentSeconds: number): number | undefined =>
      resolveBeatorajaPlayNumber(BEATORAJA_NUM.NOWBPM, input({ chart, clock: { currentSeconds, totalSeconds: 60 } }));
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.NOWBPM, input({ chart }))).toBe(120);
    expect(at(5)).toBe(120);
    expect(at(15)).toBe(240);
    expect(at(20.5)).toBe(240);
    expect(at(30)).toBe(90);
  });

  it('holds the BPM at an LR2 negative-BPM reversal', () => {
    const numbers = input({ chart, clock: { currentSeconds: 30, totalSeconds: 60, reversalSeconds: 12 } });
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.NOWBPM, numbers)).toBe(240);
  });

  it('times the play, the time left and the song from the engine clock', () => {
    const numbers = input({ clock: { currentSeconds: 125.5, totalSeconds: 190 } });
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.PLAYTIME_MINUTE, numbers)).toBe(2);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.PLAYTIME_SECOND, numbers)).toBe(5);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.TIMELEFT_MINUTE, numbers)).toBe(1);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.TIMELEFT_SECOND, numbers)).toBe(4);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.SONGLENGTH_MINUTE, numbers)).toBe(3);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.SONGLENGTH_SECOND, numbers)).toBe(10);
    // Past the end the time left stays at 0; before the first frame everything reads 0.
    const overrun = input({ clock: { currentSeconds: 200, totalSeconds: 190 } });
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.TIMELEFT_SECOND, overrun)).toBe(0);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.PLAYTIME_SECOND, input())).toBe(0);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.SONGLENGTH_MINUTE, input())).toBe(0);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.LOADING_PROGRESS, input())).toBe(100);
  });

  it('shows the clock, the time running and the frame rate as given', () => {
    const numbers = input({
      wallClock: { year: 2026, month: 10, day: 16, hour: 9, minute: 5, second: 42 },
      operatingMs: 3 * 3_600_000 + 25 * 60_000 + 7_900,
      fps: 120,
    });
    expect(
      [
        BEATORAJA_NUM.TIME_YEAR,
        BEATORAJA_NUM.TIME_MONTH,
        BEATORAJA_NUM.TIME_DAY,
        BEATORAJA_NUM.TIME_HOUR,
        BEATORAJA_NUM.TIME_MINUTE,
        BEATORAJA_NUM.TIME_SECOND,
      ].map((id) => resolveBeatorajaPlayNumber(id, numbers)),
    ).toEqual([2026, 10, 16, 9, 5, 42]);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.OPERATING_TIME_HOUR, numbers)).toBe(3);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.OPERATING_TIME_MINUTE, numbers)).toBe(25);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.OPERATING_TIME_SECOND, numbers)).toBe(7);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.CURRENT_FPS, numbers)).toBe(120);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.TIME_YEAR, input())).toBeUndefined();
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.CURRENT_FPS, input())).toBe(0);
  });
});

describe('resolveBeatorajaPlayNumber — score rates', () => {
  const score = { total: 100, perfect: 30, great: 8, good: 2, bad: 0, poor: 0, exScore: 68, score: 0 };

  it('rates the EX score over the notes judged so far on 102 / 103, over every note on 115 / 116', () => {
    // 68 / (40 × 2) = 85 % so far; 68 / 200 = 34 % of the chart.
    const numbers = input({ score });
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.SCORE_RATE, numbers)).toBe(85);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.SCORE_RATE_AFTERDOT, numbers)).toBe(0);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.TOTAL_RATE, numbers)).toBe(34);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.TOTAL_RATE_AFTERDOT, numbers)).toBe(0);
    const odd = input({ score: { ...score, perfect: 2, great: 1, good: 0, exScore: 5 } });
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.SCORE_RATE, odd)).toBe(83);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.SCORE_RATE_AFTERDOT, odd)).toBe(33);
  });

  it('reads 100 % before the first note is judged and 0 before the engine reports a score', () => {
    const start = input({ score: { ...score, perfect: 0, great: 0, good: 0, exScore: 0 } });
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.SCORE_RATE, start)).toBe(100);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.TOTAL_RATE, start)).toBe(0);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.SCORE_RATE, input())).toBe(0);
  });
});

describe('resolveBeatorajaPlayNumber — judge popup and records', () => {
  it("reads each plate's combo at its latest judgment and the latest offset, truncated", () => {
    const numbers = input({ plateCombos: [12, 0, 7], lastJudgeDeltaMs: -12.7, maxCombo: 40 });
    expect(resolveBeatorajaPlayNumber(SYNTHETIC_NUM_JUDGE_COMBO_1P, numbers)).toBe(12);
    expect(resolveBeatorajaPlayNumber(SYNTHETIC_NUM_JUDGE_COMBO_2P, numbers)).toBe(0);
    expect(resolveBeatorajaPlayNumber(SYNTHETIC_NUM_JUDGE_COMBO_3P, numbers)).toBe(7);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.JUDGE_1P_OFFSET_MS, numbers)).toBe(-12);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.JUDGE_1P_OFFSET_MS, input())).toBe(0);
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.BEST_MAXCOMBO, numbers)).toBe(40);
  });

  it('reads 0 for the records and targets nothing feeds, and the score numbers through the shared table', () => {
    for (const id of [
      BEATORAJA_NUM.BEST_SCORE,
      BEATORAJA_NUM.PLAYCOUNT,
      BEATORAJA_NUM.TARGET_SCORE,
      BEATORAJA_NUM.DIFF_EXSCORE,
      BEATORAJA_NUM.TOTALPLAYTIME_HOUR,
    ]) {
      expect(resolveBeatorajaPlayNumber(id, input())).toBe(0);
    }
    expect(resolveBeatorajaPlayNumber(BEATORAJA_NUM.COMBO, input({ combo: 9 }))).toBe(9);
    expect(resolveBeatorajaPlayNumber(99_999, input())).toBeUndefined();
  });
});

describe('beatorajaBPMAt', () => {
  it('walks segments out of time order in their order, up to the first one after the time', () => {
    const unordered = [
      { timeMs: 0, bpm: 100 },
      { timeMs: 5000, bpm: 200 },
      { timeMs: 3000, bpm: 150 },
      { timeMs: 9000, bpm: 300 },
    ];
    expect(beatorajaBPMAt(unordered, 6000, 120)).toBe(150);
    expect(beatorajaBPMAt([], 1000, 150)).toBe(150);
    // A chart starting on a STOP reads the header BPM until the first positive one.
    expect(
      beatorajaBPMAt(
        [
          { timeMs: 0, bpm: 0 },
          { timeMs: 500, bpm: 180 },
        ],
        100,
        150,
      ),
    ).toBe(150);
  });
});

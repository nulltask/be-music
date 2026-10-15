import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';

// The engine writes to a mocked Node audio sink (shared state in test-support/player-fixtures.ts).
vi.mock('./audio-sink.ts', async () => (await import('./test-support/player-fixtures.ts')).mockAudioSinkModule());

import { resolveChart } from '@be-music/chart';
import { createEmptyJson } from '../../json/src/index.ts';
import {
  applyFastSlowForJudge,
  applyHighSpeedControlAction,
  extractPlayableNotes,
  manualPlay,
  resolveBgmHeadroomGain,
  shouldUseAutoMixBgmHeadroomControl,
  resolveHighSpeedControlActionFromLaneChannels,
  resolveJudgeWindowsMs,
} from './index.ts';
import type { PlayerInputCommand } from './core/input-signal-bus.ts';
import { resolveChartVolWavGain, resolveDisplayedJudgeRankLabel, resolveDisplayedJudgeRankValue } from './utils.ts';
import {
  resetAudioSinkState,
  createLnobjLongNoteChart,
  createDynamicExRankChart,
  createScheduledInputRuntime,
} from './test-support/player-fixtures.ts';

beforeEach(resetAudioSinkState);

describe('player', () => {
  test('player: LNMODE=1 treats early release as BAD', async () => {
    const summary = await manualPlay(createLnobjLongNoteChart(1), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 520, command: { kind: 'kitty-state', pressTokens: ['z'], repeatTokens: [], releaseTokens: [] } },
        { delayMs: 520, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 900, command: { kind: 'kitty-state', pressTokens: [], repeatTokens: [], releaseTokens: ['z'] } },
        { delayMs: 1200, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(summary.total).toBe(1);
    expect(summary.bad).toBe(1);
    expect(summary.poor).toBe(0);
  });

  test('player: LNMODE=2 keeps long notes active until the end timing', async () => {
    const summary = await manualPlay(createLnobjLongNoteChart(2), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 520, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1100, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(summary.total).toBe(1);
    expect(summary.perfect).toBe(0);
    expect(summary.great).toBe(0);
    expect(summary.good).toBe(0);
    expect(summary.bad + summary.poor).toBe(1);
  });

  test('player: mine notes inside an active LN hold deal silent gauge damage (upstream JudgeManager.java:253-259)', async () => {
    // When a mine passes the judge line while the same lane's LN is being held, upstream
    // beatoraja applies the mine's gauge damage but emits NO verdict — the player's combo
    // and score are preserved. Without this guard, an HCN-style chart that routes mine
    // columns through active holds was unclear-able: every mine inside a hold cost a BAD
    // (combo reset + scoreboard slot waste) on top of the gauge hit.
    //
    // BPM 480 → measure 1 = 0.5 sec, measure 3 = 1.5 sec.  Schedule:
    //   - Player taps 'z' at 520 ms (real time) → LN head at chart 0.5 sec (PERFECT).
    //   - Mine on D1 lands at chart 0.75 sec (measure 1.5) → 230 ms after head, inside
    //     the 380 ms initial hold grace window.
    //   - LN tail at chart 1.5 sec; the per-frame loop reaches it before the interrupt
    //     and finalizes with the head's PERFECT verdict.
    //   - Interrupt fires at 1700 ms (200 ms after tail) — well within the tail-finalize
    //     window, matching the LNMODE=3 baseline test's timing.
    //
    // We run a baseline scenario without the mine to capture the reference gauge value
    // (PERFECT-only run), then assert the mine-present run lands the SAME verdict counts
    // but a STRICTLY LOWER gauge — proving the mine drained gauge silently.
    // The first lane-input tap hits the LN head; the rest tap again around the mine time so
    // `handleMappedInputTokens` is called with the LN still active — that's the codepath that
    // resolves a mine candidate (the engine only looks for landmines on lane-input dispatches,
    // not as a per-frame sweep). Without such a tap, the mine expires silently via
    // `markExpiredLandmines` and the silent-damage branch never runs. The taps are real-time
    // timers, so one tap exactly at the mine missed its window whenever a loaded CI runner
    // delayed it; a burst every 50 ms across 600–950 ms keeps one inside the window. Re-taps
    // during the hold are neutral (no verdict, no empty POOR), and the baseline run replays the
    // same schedule, so the verdict comparison below is unaffected.
    const inputSchedule: Array<{ delayMs: number; command: PlayerInputCommand }> = [
      { delayMs: 520, command: { kind: 'lane-input', tokens: ['z'] } },
      ...Array.from({ length: 8 }, (_, index) => ({
        delayMs: 600 + index * 50,
        command: { kind: 'lane-input', tokens: ['z'] } as PlayerInputCommand,
      })),
      { delayMs: 1700, command: { kind: 'interrupt', reason: 'escape' } },
    ];
    const baselineSummary = await manualPlay(createLnobjLongNoteChart(2), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime(inputSchedule),
    });

    const json = createLnobjLongNoteChart(2);
    json.events.push({ measure: 1, channel: 'D1', position: [1, 2] as const, value: '08' });

    const summary = await manualPlay(json, {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime(inputSchedule),
    });

    // Verdict counts MATCH the mine-free baseline — adding a mine inside the hold doesn't
    // add a BAD/POOR slot, doesn't reset combo. We compare against the baseline (rather
    // than pinning specific values) because the LN's tail-finalize verdict depends on
    // tick alignment that's independent of the mine-handling code path being verified.
    expect(summary.perfect).toBe(baselineSummary.perfect);
    expect(summary.great).toBe(baselineSummary.great);
    expect(summary.good).toBe(baselineSummary.good);
    expect(summary.bad).toBe(baselineSummary.bad);
    expect(summary.poor).toBe(baselineSummary.poor);
    expect(summary.total).toBe(baselineSummary.total);
    // Gauge took the mine's damage despite the silent treatment — strictly below the
    // mine-free baseline. This is the affirmative half: silent doesn't mean free.
    const baselineGauge = baselineSummary.gauge?.current ?? 100;
    const withMineGauge = summary.gauge?.current ?? 100;
    expect(withMineGauge).toBeLessThan(baselineGauge);
  });

  test('player: LNMODE=3 drains groove gauge while the hold is broken', async () => {
    expect(extractPlayableNotes(createLnobjLongNoteChart(3))[0]?.longNoteMode).toBe(3);
    // HCN is a beatoraja mechanic — the chart's `#LNMODE` only reaches the engine under the rulesets that honour
    // it. LR2 plays every long note as a plain LN (asserted below).
    const mode2Summary = await manualPlay(createLnobjLongNoteChart(2), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      judgeRuleset: 'beatoraja',
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 520, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1100, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });
    const mode3Summary = await manualPlay(createLnobjLongNoteChart(3), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      judgeRuleset: 'beatoraja',
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 520, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1700, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    // A charge note is two judgments: the head on the press, the tail on the release.
    expect(mode3Summary.total).toBe(2);
    expect(mode3Summary.bad + mode3Summary.poor).toBe(1);
    expect(mode3Summary.gauge?.current ?? 0).toBeLessThan(mode2Summary.gauge?.current ?? Number.POSITIVE_INFINITY);
  });

  test('player: LR2 plays every long note as an LN, whatever #LNMODE says', async () => {
    // `longNoteStyle: 'ln'` — LR2 has neither CN nor HCN, so a `#LNMODE 3` chart is one deferred judgment with no
    // hold-drain, exactly like a `#LNMODE 1` chart.
    const summary = await manualPlay(createLnobjLongNoteChart(3), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 520, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1700, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(summary.total).toBe(1);
    expect(summary.perfect + summary.great + summary.good + summary.bad + summary.poor).toBe(1);
  });

  test('player: no-TUI logs long-note, gauge, combo, sample-stop, and result events', async () => {
    const output: string[] = [];

    await manualPlay(createLnobjLongNoteChart(3), {
      speed: 1,
      leadInMs: 0,
      audio: false,
      tui: false,
      // The hold-drain ticks this asserts on are an HCN mechanic, which only beatoraja runs.
      judgeRuleset: 'beatoraja',
      writeOutput: (text) => {
        output.push(text);
      },
      createInputRuntime: createScheduledInputRuntime([
        { delayMs: 520, command: { kind: 'lane-input', tokens: ['z'] } },
        { delayMs: 1700, command: { kind: 'interrupt', reason: 'escape' } },
      ]),
    });

    expect(
      output.some(
        (line) =>
          line.includes('kind:long-note') &&
          line.includes('state:start') &&
          line.includes('mode:3') &&
          line.includes('file:ln.wav'),
      ),
    ).toBe(true);
    expect(
      output.some(
        (line) =>
          line.includes('kind:long-note') &&
          line.includes('state:release') &&
          line.includes('mode:3') &&
          line.includes('file:ln.wav'),
      ),
    ).toBe(true);
    expect(
      output.some(
        (line) =>
          line.includes('kind:sample-stop') &&
          line.includes('reason:long-note-release') &&
          line.includes('sample:01') &&
          line.includes('file:ln.wav'),
      ),
    ).toBe(true);
    expect(output.some((line) => line.includes('kind:gauge-change') && line.includes('reason:hold-drain'))).toBe(true);
    expect(
      output.some(
        (line) => line.includes('kind:combo-change') && line.includes('value:0') && line.includes('judge:POOR'),
      ),
    ).toBe(true);
    const resultLine = output.find((line) => line.includes('kind:result') && line.includes('reason:complete'));
    expect(resultLine).toBeDefined();
    // One HCN is two judgments under beatoraja: the head scored on the press, the tail POORed by the early release; the
    // gauge then keeps draining in 200 ms ticks while the note passes with the lane up.
    expect(resultLine).toContain('total:2');
    expect(resultLine).toContain('great:1');
    expect(resultLine).toContain('poor:1');
  });

  test('player: uses baseline judge windows for bms RANK=2', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 2;
    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo(18, 6);
    expect(windows.great).toBeCloseTo(40, 6);
    expect(windows.good).toBeCloseTo(100, 6);
    expect(windows.bad).toBe(200);
  });

  test('player: FAST/SLOW are counted only for GREAT/GOOD', () => {
    const summary = {
      fast: 0,
      slow: 0,
    };

    applyFastSlowForJudge(summary, 'PERFECT', -12);
    applyFastSlowForJudge(summary, 'PERFECT', 8);
    expect(summary.fast).toBe(0);
    expect(summary.slow).toBe(0);

    applyFastSlowForJudge(summary, 'GREAT', -18);
    applyFastSlowForJudge(summary, 'GOOD', 27);
    applyFastSlowForJudge(summary, 'GOOD', 0);
    expect(summary.fast).toBe(1);
    expect(summary.slow).toBe(1);
  });

  test('player: bgm headroom gain does not mute BGM when play lane already clips', () => {
    const playable = {
      sampleRate: 44_100,
      left: new Float32Array([1.2, 0.8]),
      right: new Float32Array([1.1, 0.8]),
      durationSeconds: 2 / 44_100,
      peak: 1.2,
    };
    const bgm = {
      sampleRate: 44_100,
      left: new Float32Array([0.5, 0.5]),
      right: new Float32Array([0.5, 0.5]),
      durationSeconds: 2 / 44_100,
      peak: 0.5,
    };

    const gain = resolveBgmHeadroomGain(playable, bgm);
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeLessThanOrEqual(1);
  });

  test('player: auto mix headroom control is disabled while limiter is enabled', () => {
    expect(shouldUseAutoMixBgmHeadroomControl({})).toBe(false);
    expect(shouldUseAutoMixBgmHeadroomControl({ limiter: true })).toBe(false);
    expect(shouldUseAutoMixBgmHeadroomControl({ limiter: false })).toBe(true);
  });

  test('player: resolves #VOLWAV gain with 100 as default baseline', () => {
    const defaultChart = createEmptyJson('bms');
    expect(resolveChartVolWavGain(defaultChart)).toBe(1);

    defaultChart.bms.volWav = 100;
    expect(resolveChartVolWavGain(defaultChart)).toBe(1);

    defaultChart.bms.volWav = 150;
    expect(resolveChartVolWavGain(defaultChart)).toBe(1.5);

    // beatoraja applies #VOLWAV only for 0 < n < 200, so 200 plays at the original volume.
    defaultChart.bms.volWav = 200;
    expect(resolveChartVolWavGain(defaultChart)).toBe(1);
  });

  test('player: narrows judge windows for bms RANK=0 (LR2 VERY HARD)', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 0;
    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo(8, 6);
    expect(windows.great).toBeCloseTo(24, 6);
    expect(windows.good).toBeCloseTo(40, 6);
    expect(windows.bad).toBe(200);
  });

  test('player: bms RANK=4 maps onto NORMAL windows (LR2 behavior)', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 4;
    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo(18, 6);
    expect(windows.great).toBeCloseTo(40, 6);
    expect(windows.good).toBeCloseTo(100, 6);
    expect(windows.bad).toBe(200);
  });

  test('player: scales judge windows from bms DEFEXRANK via the LR2 anchor interpolation', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 0;
    json.bms.defExRank = 120; // percent 90 — between NORMAL (75) and EASY (100)
    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo(19.8, 6);
    expect(windows.great).toBeCloseTo(52, 6);
    expect(windows.good).toBeCloseTo(112, 6);
    expect(windows.bad).toBe(200);
  });

  test('player: resolves displayed judge rank from bms DEFEXRANK and defaults', () => {
    const defExRankChart = createEmptyJson('bms');
    defExRankChart.metadata.rank = 1;
    defExRankChart.bms.defExRank = 199.97;
    expect(resolveDisplayedJudgeRankValue(defExRankChart)).toBe(199.97);

    const defaultChart = createEmptyJson('bms');
    expect(resolveDisplayedJudgeRankValue(defaultChart)).toBe(2);

    const truncatedRankChart = createEmptyJson('bms');
    truncatedRankChart.metadata.rank = 3.9;
    expect(resolveDisplayedJudgeRankValue(truncatedRankChart)).toBe(3);
  });

  test('player: shows RANDOM label when dynamic EXRANK changes exist', () => {
    const json = createDynamicExRankChart();
    expect(resolveDisplayedJudgeRankLabel(json)).toBe('RANDOM');
  });

  test('player: reads the displayed judge rank from a resolved chart', () => {
    const json = createDynamicExRankChart();
    const resolved = resolveChart(json);
    expect(resolveDisplayedJudgeRankValue(resolved)).toBe(2);
    expect(resolveDisplayedJudgeRankLabel(resolved)).toBe('RANDOM');

    json.bms.exRank['AA'] = '0';
    json.bms.exRank['CC'] = '-5';
    json.bms.defExRank = 120;
    expect(resolveDisplayedJudgeRankLabel(resolveChart(json))).toBe('120');

    const bmson = createEmptyJson('bmson');
    expect(resolveDisplayedJudgeRankLabel(resolveChart(bmson))).toBe('100');
  });

  test('player: resolves displayed judge rank from bmson judge rank', () => {
    const json = createEmptyJson('bmson');
    expect(resolveDisplayedJudgeRankValue(json)).toBe(100);

    json.bmson.info.judgeRank = 199.97;
    expect(resolveDisplayedJudgeRankValue(json)).toBe(199.97);
  });

  test('player: updates manual judge windows from dynamic EXRANK events', async () => {
    const json = createDynamicExRankChart();
    const summary = await manualPlay(json, {
      audio: false,
      tui: false,
      leadInMs: 0,
      createInputRuntime: createScheduledInputRuntime([
        {
          delayMs: 580,
          command: { kind: 'lane-input', tokens: ['z'] },
        },
        {
          delayMs: 1580,
          command: { kind: 'lane-input', tokens: ['z'] },
        },
      ]),
    });

    expect(summary.total).toBe(2);
    expect(summary.bad).toBe(1);
    expect(summary.good).toBe(1);
    expect(summary.perfect).toBe(0);
    expect(summary.great).toBe(0);
  });

  test('player: uses NORMAL windows for bmson judge_rank=100', () => {
    const json = createEmptyJson('bmson');
    json.bmson.info.judgeRank = 100;
    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo(18, 6);
    expect(windows.great).toBeCloseTo(40, 6);
    expect(windows.good).toBeCloseTo(100, 6);
    expect(windows.bad).toBe(200);
  });

  test('player: debug judge window override affects BAD only', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 4;
    const windows = resolveJudgeWindowsMs(json, 180);
    expect(windows.pgreat).toBeCloseTo(18, 6);
    expect(windows.great).toBeCloseTo(40, 6);
    expect(windows.good).toBeCloseTo(100, 6);
    expect(windows.bad).toBe(180);
  });

  test('player: maps in-play HIGH-SPEED control by odd/even lane channel', () => {
    expect(resolveHighSpeedControlActionFromLaneChannels(['11'])).toBe('decrease');
    expect(resolveHighSpeedControlActionFromLaneChannels(['12'])).toBe('increase');
    expect(resolveHighSpeedControlActionFromLaneChannels(['1A'])).toBe('increase');
    expect(resolveHighSpeedControlActionFromLaneChannels(['11', '13'])).toBe('decrease');
    expect(resolveHighSpeedControlActionFromLaneChannels(['12', '14'])).toBe('increase');
    expect(resolveHighSpeedControlActionFromLaneChannels(['11', '12'])).toBeUndefined();
    expect(resolveHighSpeedControlActionFromLaneChannels(['01'])).toBeUndefined();
  });

  test('player: applies in-play HIGH-SPEED controls with 0.5 steps and clamp', () => {
    expect(applyHighSpeedControlAction(1, 'increase')).toBe(1.5);
    expect(applyHighSpeedControlAction(1, 'decrease')).toBe(0.5);
    expect(applyHighSpeedControlAction(10, 'increase')).toBe(10);
    expect(applyHighSpeedControlAction(0.5, 'decrease')).toBe(0.5);
  });
});

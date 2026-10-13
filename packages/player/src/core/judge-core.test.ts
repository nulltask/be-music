import { resolveChart } from '@be-music/chart';
import { createEmptyJson, resolveBmsBase, type BeMusicJson } from '@be-music/json';
import { describe, expect, test } from 'vite-plus/test';
import type { PlaylogInputEvent } from '../playlog/format.ts';
import { resolveRuleset, rulesetChartFactsFromChart, type PlaylogRulesetId } from '../ruleset/index.ts';
import { createInitialPlayerSummary, preparePlaybackChart } from './bootstrap.ts';
import {
  advanceJudgeCoreReplay,
  createJudgeCoreReplay,
  createJudgeCoreState,
  isJudgeCoreSettled,
  resolveJudgeInputChannels,
  runJudgeCoreStep,
  clampToReversal,
  stepJudgeCore,
  toJudgeClock,
  type JudgeCoreEffect,
  type JudgeCoreState,
} from './judge-core.ts';
import { createScoreTracker } from './scoring.ts';

/** BPM 240 → one measure per second, so `measure` + `position` read directly as seconds. */
function chart(events: BeMusicJson['events'], setup: (json: BeMusicJson) => void = () => {}): BeMusicJson {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 240;
  json.metadata.rank = 2;
  json.events = events;
  setup(json);
  return json;
}

const NOTES = chart([
  { measure: 1, channel: '11', position: [0, 1], value: '01' },
  { measure: 1, channel: '12', position: [1, 2], value: '01' },
  { measure: 2, channel: '11', position: [0, 1], value: '01' },
  { measure: 2, channel: '16', position: [1, 4], value: '01' },
  { measure: 3, channel: '13', position: [0, 1], value: '01' },
]);

/** A long note on `11` from 1.0 s to 2.0 s via `#LNOBJ`, a mine on `12` at 2.5 s and a tap on `12` at 3.0 s. */
const LONG_AND_MINE = chart(
  [
    { measure: 1, channel: '11', position: [0, 1], value: '01' },
    { measure: 2, channel: '11', position: [0, 1], value: 'AA' },
    { measure: 2, channel: 'D2', position: [1, 2], value: '0A' },
    { measure: 3, channel: '12', position: [0, 1], value: '01' },
  ],
  (json) => {
    json.bms.lnObjs = ['AA'];
  },
);

function createCore(
  json: BeMusicJson,
  ruleset: PlaylogRulesetId = 'lr2',
  options: { autoScratch?: boolean; judgeMsPerChartSecond?: number } = {},
): JudgeCoreState {
  const source = structuredClone(json);
  const resolved = resolveChart(source);
  const prepared = preparePlaybackChart(resolved);
  const config = resolveRuleset(rulesetChartFactsFromChart(source, prepared), ruleset);
  return createJudgeCoreState(
    {
      ruleset: config,
      scorableNotes: prepared.scorableNotes,
      landmineNotes: prepared.landmineNotes,
      invisibleNotes: prepared.invisibleNotes,
      laneSoundNotes: prepared.laneSoundNotes,
      freeZoneChannels: prepared.activeFreeZoneChannels,
      scratchChannels: new Set(
        prepared.laneBindings.filter((binding) => binding.isScratch).map((binding) => binding.channel),
      ),
      autoScratch: options.autoScratch ?? false,
      judgeMsPerChartSecond: options.judgeMsPerChartSecond ?? 1000,
      wavResources: source.resources.wav,
      idBase: resolveBmsBase(source),
      sourceFormat: source.sourceFormat,
      reversalSeconds: resolved.reversal?.seconds,
    },
    {
      ...createInitialPlayerSummary(config, config.noteCount),
      scoreTracker: createScoreTracker({ moneyScore: config.moneyScore }),
    },
  );
}

/**
 * LR2 negative-BPM reversal at 2.0 s (`#BPM02 -240` on channel 08; |BPM| keeps one measure per second). Taps on `11`
 * at 1.95 s and 3.0 s, a mine on `12` at 2.5 s, and an LN on `13` from 1.5 s to 2.5 s.
 */
const REVERSED = chart(
  [
    { measure: 1, channel: '11', position: [19, 20], value: '01' },
    { measure: 1, channel: '13', position: [1, 2], value: '01' },
    { measure: 2, channel: '08', position: [0, 1], value: '02' },
    { measure: 2, channel: '13', position: [1, 2], value: 'AA' },
    { measure: 2, channel: 'D2', position: [1, 2], value: '0A' },
    { measure: 3, channel: '11', position: [0, 1], value: '01' },
  ],
  (json) => {
    json.resources.bpm['02'] = -240;
    json.bms.lnObjs = ['AA'];
  },
);

function press(seconds: number, ...channels: string[]): Parameters<typeof stepJudgeCore>[1] {
  return { kind: 'press', channels: new Set(channels), tokens: [], nowSec: seconds, nowMs: seconds * 1000 };
}

function advance(seconds: number): Parameters<typeof stepJudgeCore>[1] {
  return { kind: 'advance', nowSec: seconds, nowMs: seconds * 1000 };
}

/** Effects stripped of the shared, mutable references so runs can be compared by value. */
function snapshot(effect: JudgeCoreEffect): unknown {
  if (effect.kind === 'record-input') {
    return { ...effect, channels: [...effect.channels] };
  }
  return effect;
}

/** Replays `inputs` through a fresh core, advancing it at the given chart-time ticks, and returns everything seen. */
function replay(json: BeMusicJson, inputs: PlaylogInputEvent[], ticks: readonly number[], ruleset: PlaylogRulesetId) {
  const state = createCore(json, ruleset);
  const run = createJudgeCoreReplay(inputs);
  const effects: unknown[] = [];
  for (const tick of ticks) {
    advanceJudgeCoreReplay(state, run, tick, (effect) => effects.push(snapshot(effect)));
  }
  runJudgeCoreStep(state, { kind: 'finish', totalSeconds: 5 }, (effect) => effects.push(snapshot(effect)));
  return { summary: structuredClone(state.summary), combo: state.combo, effects };
}

function inputs(...events: Array<[timeUs: number, action: 'down' | 'up', channel: string]>): PlaylogInputEvent[] {
  return events.map(([timeUs, action, channel], seq) => ({ seq, timeUs, action, channels: [channel] }));
}

describe('judge core', () => {
  test('a press inside the PGREAT window scores, sounds and counts the combo', () => {
    const state = createCore(NOTES);
    const effects = stepJudgeCore(state, press(1.002, '11'));

    expect(state.summary.perfect).toBe(1);
    expect(state.combo).toBe(1);
    expect(state.config.scorableNotes[0]!.judged).toBe(true);
    expect(effects.map((effect) => effect.kind)).toEqual([
      'record-input',
      'ui',
      'ui',
      'sound',
      'gauge',
      'poor-bga',
      'combo',
      'trace',
      'judge-combo',
      'poor-trace',
    ]);
    expect(effects.find((effect) => effect.kind === 'judge-combo')).toMatchObject({
      judge: 'PERFECT',
      combo: 1,
      channel: '11',
    });
  });

  test('advancing past a note’s late window misses it, and only then', () => {
    const state = createCore(NOTES);
    stepJudgeCore(state, advance(1.1));
    expect(state.summary.poor).toBe(0);

    const effects = stepJudgeCore(state, advance(1.5));
    expect(state.summary.poor).toBe(1);
    expect(state.combo).toBe(0);
    expect(effects.find((effect) => effect.kind === 'trace')).toMatchObject({
      name: 'judge',
      fields: expect.arrayContaining([['reason', 'miss']]),
    });
  });

  test('a note-less press near a note is an empty POOR that never consumes the note', () => {
    const state = createCore(NOTES);
    const effects = stepJudgeCore(state, press(0.5, '11'));

    expect(state.summary.emptyPoor).toBe(1);
    expect(state.config.scorableNotes[0]!.judged).toBe(false);
    expect(effects.some((effect) => effect.kind === 'record-empty-poor')).toBe(true);
  });

  test('an LN released early is a BAD at the release instant under LR2', () => {
    const state = createCore(LONG_AND_MINE, 'lr2');
    stepJudgeCore(state, { kind: 'hold', channels: new Set(['11']) });
    stepJudgeCore(state, press(1, '11'));
    expect(state.activeLongNotes.has('11')).toBe(true);
    stepJudgeCore(state, advance(1.4));
    stepJudgeCore(state, {
      kind: 'release',
      channels: new Set(['11']),
      tokens: [],
      nowSec: 1.5,
      nowMs: 1500,
      recordSec: 1.5,
    });
    const effects = stepJudgeCore(state, advance(1.6));

    expect(state.summary.bad).toBe(1);
    expect(state.activeLongNotes.size).toBe(0);
    expect(effects.find((effect) => effect.kind === 'stop-sound')).toMatchObject({
      channel: '11',
      reason: 'long-note-release',
    });
  });

  test('a lane held through a mine detonates it and drains the gauge without a judgment', () => {
    const state = createCore(LONG_AND_MINE, 'lr2');
    stepJudgeCore(state, { kind: 'hold', channels: new Set(['12']) });
    const before = state.summary.gauge!.current;
    const effects = [...stepJudgeCore(state, advance(2.49)), ...stepJudgeCore(state, advance(2.6))];

    expect(effects.find((effect) => effect.kind === 'trace' && effect.name === 'mine-hit')).toBeDefined();
    expect(state.summary.gauge!.current).toBeLessThan(before);
    expect(state.summary.bad + state.summary.poor).toBe(1); // only the LN head missed meanwhile
  });

  test('auto scratch plays the scratch lane and ignores input on it', () => {
    const state = createCore(NOTES, 'lr2', { autoScratch: true });
    const buffer = new Set<string>();
    const mapped = resolveJudgeInputChannels(
      state.config,
      new Map([
        ['a', ['16']],
        ['s', ['11']],
      ]),
      buffer,
      ['a', 's'],
    );
    expect([...mapped]).toEqual(['11']);

    stepJudgeCore(state, advance(2.25));
    expect(state.config.scorableNotes.find((note) => note.channel === '16')!.judged).toBe(true);
    expect(state.summary.perfect).toBe(1);
  });

  test('finish charges every unjudged note and settles the state', () => {
    const state = createCore(NOTES);
    expect(isJudgeCoreSettled(state)).toBe(false);
    const effects = stepJudgeCore(state, { kind: 'finish', totalSeconds: 4 });

    expect(state.summary.poor).toBe(5);
    expect(isJudgeCoreSettled(state)).toBe(false); // finish does not retire the counters, the driver stops anyway
    expect(effects.at(-1)).toEqual({ kind: 'frame', seconds: 4 });
  });

  test('the judge clock mirrors past an LR2 negative-BPM reversal, and the pump clamps strictly below it', () => {
    const config = { reversalSeconds: 2 };
    expect(toJudgeClock(config, 1.5)).toBe(1.5);
    expect(toJudgeClock(config, 2)).toBe(2);
    expect(toJudgeClock(config, 2.25)).toBeCloseTo(1.75, 9);
    expect(toJudgeClock({}, 2.25)).toBe(2.25);
    expect(clampToReversal(config, 1.5)).toBe(1.5);
    expect(clampToReversal(config, 5)).toBeLessThan(2);
    expect(clampToReversal({}, 5)).toBe(5);
  });

  test('past an LR2 reversal a press is judged on the mirrored clock but lands on the true one', () => {
    const state = createCore(REVERSED);
    expect(state.config.reversalSeconds).toBeCloseTo(2, 9);
    stepJudgeCore(state, advance(2.04));
    // 2.05 s mirrors to 1.95 s: a PGREAT on the note just before the reversal.
    const effects = stepJudgeCore(state, press(2.05, '11'));
    expect(state.summary.perfect).toBe(1);
    expect(effects.find((effect) => effect.kind === 'gauge')).toMatchObject({ seconds: 2.05 });
  });

  test('past an LR2 reversal nothing is missed or detonated, and finish empties the gauge', () => {
    const state = createCore(REVERSED);
    stepJudgeCore(state, { kind: 'hold', channels: new Set(['12', '13']) });
    stepJudgeCore(state, press(1.5, '13'));
    for (const seconds of [1.6, 2.2, 2.6, 3.5, 10]) {
      stepJudgeCore(state, advance(seconds));
    }
    // Nothing is missed: the 1.95 s tap's late window closes behind the reversal, the 3.0 s tap and the mine sit behind
    // it, and the LN spanning the reversal stays open while held — its tail on the mirrored clock is never reached.
    expect(state.summary.poor).toBe(0);
    expect(state.config.landmineNotes[0]!.judged).toBe(false);
    expect(state.activeLongNotes.has('13')).toBe(true);

    const effects = stepJudgeCore(state, { kind: 'finish', totalSeconds: 4 });
    expect(state.summary.poor).toBe(0); // no remaining-notes POORs for what the reversal left behind
    expect(state.summary.gauge!.current).toBe(0);
    expect(state.summary.gauge!.cleared).toBe(false);
    expect(effects).toContainEqual({
      kind: 'trace',
      name: 'gauge',
      seconds: 4,
      fields: [
        ['value', 0],
        ['reason', 'notes-outstanding-past-reversal'],
      ],
    });
  });

  test('past an LR2 reversal a long note spanning it BADs on release', () => {
    const state = createCore(REVERSED);
    stepJudgeCore(state, { kind: 'hold', channels: new Set(['13']) });
    stepJudgeCore(state, press(1.5, '13'));
    stepJudgeCore(state, advance(2.3));
    stepJudgeCore(state, {
      kind: 'release',
      channels: new Set(['13']),
      tokens: [],
      nowSec: 2.4,
      nowMs: 2400,
      recordSec: 2.4,
    });
    stepJudgeCore(state, advance(2.45));
    expect(state.summary.bad).toBe(1);
    expect(state.activeLongNotes.size).toBe(0);
  });

  test.each(['lr2', 'beatoraja', 'iidx'] as const)(
    '%s: a replay produces the same effects however its advances are spaced',
    (ruleset) => {
      const stream = inputs(
        [1_012_000, 'down', '11'],
        [1_500_000, 'up', '11'],
        [2_400_000, 'down', '12'],
        [2_600_000, 'up', '12'],
        [2_930_000, 'down', '12'],
        [2_970_000, 'up', '12'],
      );
      const once = replay(LONG_AND_MINE, stream, [5], ruleset);
      const frames = replay(
        LONG_AND_MINE,
        stream,
        Array.from({ length: 300 }, (_, index) => (index + 1) / 60),
        ruleset,
      );
      const ragged = replay(LONG_AND_MINE, stream, [0.3, 1.0115, 1.2, 2.45, 2.4501, 3.7, 5], ruleset);

      expect(frames).toEqual(once);
      expect(ragged).toEqual(once);
      expect(once.summary.total).toBeGreaterThan(0);
    },
  );
});

import { resolveChart } from '@be-music/chart-model';
import { createEmptyJSON, resolveBMSBase, type BeMusicJSON } from '@be-music/chart-source';
import { describe, expect, test } from 'vite-plus/test';
import { resolveRuleset, rulesetChartFactsFromChart } from '../ruleset/index.ts';
import { AnyKeyRoutes, anyKeyRouteKeys, preferAnyKeyCandidate, selectAnyKeyLane } from './any-key.ts';
import { createInitialPlayerSummary, preparePlaybackChart } from './bootstrap.ts';
import {
  createJudgeCoreState,
  resolveAnyKeyPressChannels,
  stepJudgeCore,
  type JudgeCoreEffect,
  type JudgeCoreState,
} from './judge-core.ts';
import { createScoreTracker } from './scoring.ts';

describe('selectAnyKeyLane', () => {
  test('takes the nearest note on any lane, early or late', () => {
    expect(
      selectAnyKeyLane([
        { channel: '11', noteTimeUs: 900_000, dmUs: -100_000 },
        { channel: '16', noteTimeUs: 1_030_000, dmUs: 30_000 },
        { channel: '13', noteTimeUs: 1_080_000, dmUs: 80_000 },
      ]),
    ).toBe('16');
    expect(selectAnyKeyLane([])).toBeUndefined();
  });

  test('breaks a tie on the earlier note, then the lower channel, whatever the order', () => {
    const early = { channel: '15', noteTimeUs: 980_000, dmUs: -20_000 };
    const late = { channel: '12', noteTimeUs: 1_020_000, dmUs: 20_000 };
    expect(selectAnyKeyLane([late, early])).toBe('15');
    expect(selectAnyKeyLane([early, late])).toBe('15');
    const left = { channel: '12', noteTimeUs: 1_000_000, dmUs: 0 };
    const right = { channel: '14', noteTimeUs: 1_000_000, dmUs: 0 };
    expect(selectAnyKeyLane([right, left])).toBe('12');
    expect(preferAnyKeyCandidate(left, right)).toBe(false);
    expect(preferAnyKeyCandidate(right, left)).toBe(true);
  });
});

describe('anyKeyRouteKeys', () => {
  test('names the tokens, or the lanes of an input recorded without them', () => {
    expect(anyKeyRouteKeys(['z'], ['11'])).toEqual(['z']);
    expect(anyKeyRouteKeys([], new Set(['11', '21']))).toEqual(['#11', '#21']);
  });
});

describe('AnyKeyRoutes', () => {
  test('a key holds the lane it was routed to until it comes up', () => {
    const routes = new AnyKeyRoutes();
    routes.route(['z'], ['14']);
    expect(routes.lanesOf('z')).toEqual(['14']);
    expect(routes.routedLanes(['z', 'x'])).toEqual(new Set(['14']));
    expect(routes.release(['z'], ['11'])).toEqual(new Set(['14']));
    expect(routes.lanesOf('z')).toBeUndefined();
  });

  test('a key no press routed releases its own lanes', () => {
    const routes = new AnyKeyRoutes();
    expect(routes.release(['z'], ['11'])).toEqual(new Set(['11']));
    expect(routes.release([], ['12'])).toEqual(new Set(['12']));
  });

  test('a key pressed again takes its new route', () => {
    const routes = new AnyKeyRoutes();
    routes.route(['z'], ['14']);
    routes.route(['z'], ['16']);
    expect(routes.release(['z'], ['11'])).toEqual(new Set(['16']));
  });
});

/** BPM 240 → one measure per second. An LN on `13` from 1.0 s to 2.0 s, taps on `14` at 1.5 s and `16` at 3.0 s. */
function chart(): BeMusicJSON {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 240;
  json.metadata.rank = 2;
  json.bms.lnObjs = ['AA'];
  json.events = [
    { measure: 1, channel: '13', position: [0, 1], value: '01' },
    { measure: 2, channel: '13', position: [0, 1], value: 'AA' },
    { measure: 1, channel: '14', position: [1, 2], value: '01' },
    { measure: 3, channel: '16', position: [0, 1], value: '01' },
  ];
  return json;
}

function createCore(options: { autoScratch?: boolean } = {}): JudgeCoreState {
  const source = chart();
  const resolved = resolveChart(source);
  const prepared = preparePlaybackChart(resolved);
  const config = resolveRuleset(rulesetChartFactsFromChart(source, prepared), 'lr2');
  return createJudgeCoreState(
    {
      ruleset: config,
      scorableNotes: prepared.scorableNotes,
      landmineNotes: prepared.landmineNotes,
      invisibleNotes: prepared.invisibleNotes,
      laneSoundNotes: prepared.laneSoundNotes,
      scratchChannels: new Set(['16', '26']),
      autoScratch: options.autoScratch ?? false,
      anyKey: true,
      judgeMsPerChartSecond: 1000,
      endOnFailure: false,
      wavResources: source.resources.wav,
      idBase: resolveBMSBase(source),
      sourceFormat: source.sourceFormat,
    },
    {
      ...createInitialPlayerSummary(config, config.noteCount),
      scoreTracker: createScoreTracker({ moneyScore: config.moneyScore }),
    },
  );
}

function recorded(effects: readonly JudgeCoreEffect[]): { action: string; channels: string[] }[] {
  return effects.flatMap((effect) =>
    effect.kind === 'record-input' ? [{ action: effect.action, channels: [...effect.channels] }] : [],
  );
}

describe('ANY KEY in the judge core', () => {
  test('routes a live press (press, then its key-state hold) and keeps the long note held by its key', () => {
    const state = createCore();
    const down = (seconds: number, channel: string, token: string): JudgeCoreEffect[] => [
      ...stepJudgeCore(state, { kind: 'advance', nowSec: seconds, nowMs: seconds * 1000 }),
      ...stepJudgeCore(state, {
        kind: 'press',
        channels: new Set([channel]),
        tokens: [token],
        nowSec: seconds,
        nowMs: seconds * 1000,
      }),
      ...stepJudgeCore(state, { kind: 'hold', channels: new Set([channel]), tokens: [token] }),
    ];
    const up = (seconds: number, channel: string, token: string): JudgeCoreEffect[] => [
      ...stepJudgeCore(state, { kind: 'advance', nowSec: seconds, nowMs: seconds * 1000 }),
      ...stepJudgeCore(state, {
        kind: 'release',
        channels: new Set([channel]),
        tokens: [token],
        nowSec: seconds,
        nowMs: seconds * 1000,
        recordSec: seconds,
      }),
    ];

    const head = down(1, '11', 'z');
    // The replay keeps the key's own lane; the judge holds the routed one.
    expect(recorded(head)).toEqual([{ action: 'down', channels: ['11'] }]);
    expect(state.activeLongNotes.has('13')).toBe(true);
    expect(state.heldChannels).toEqual(new Set(['13']));
    expect(head).toContainEqual({ kind: 'ui', command: { kind: 'press-lane', channel: '13' } });

    // The long note's lane is held, so a second key takes the tap on 14, and letting it go leaves the long note held.
    down(1.5, '12', 'x');
    expect(state.anyKeyRoutes.lanesOf('x')).toEqual(['14']);
    expect(recorded(up(1.55, '12', 'x'))).toEqual([{ action: 'up', channels: ['12'] }]);
    expect(state.heldChannels).toEqual(new Set(['13']));
    expect(state.activeLongNotes.has('13')).toBe(true);

    up(2, '11', 'z');
    stepJudgeCore(state, { kind: 'advance', nowSec: 2.5, nowMs: 2500 });
    expect(state.activeLongNotes.has('13')).toBe(false);
    expect(state.summary.poor + state.summary.bad).toBe(0);
    expect(state.summary.perfect).toBe(2);
  });

  test('skips auto-played lanes and falls back to the key’s own lane with nothing in reach', () => {
    const state = createCore({ autoScratch: true });
    expect(resolveAnyKeyPressChannels(state, new Set(['11']), 3)).toEqual(new Set(['11']));
    expect(resolveAnyKeyPressChannels(state, new Set(['11']), 1.49)).toEqual(new Set(['14']));
  });
});

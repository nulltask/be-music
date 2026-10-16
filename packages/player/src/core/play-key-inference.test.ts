import { resolveChart } from '@be-music/chart';
import { createEmptyJson, resolveBmsBase, type BeMusicJson } from '@be-music/json';
import { describe, expect, test } from 'vite-plus/test';
import { resolveRuleset, rulesetChartFactsFromChart } from '../ruleset/index.ts';
import { createInitialPlayerSummary, preparePlaybackChart } from './bootstrap.ts';
import { createJudgeCoreState, runJudgeCoreStep, type JudgeCoreInput, type JudgeCoreState } from './judge-core.ts';
import { createKeyStateInference } from './play-key-inference.ts';
import { createScoreTracker } from './scoring.ts';

/**
 * BPM 240 → one measure per second: a tap on `11` at 1.0 s, a long note on `12` from 1.0 s to 2.0 s (`#LNOBJ`) and a
 * tap on `13` at 3.0 s.
 */
function chart(): BeMusicJson {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 240;
  json.metadata.rank = 2;
  json.bms.lnObjs = ['AA'];
  json.events = [
    { measure: 1, channel: '11', position: [0, 1], value: '01' },
    { measure: 1, channel: '12', position: [0, 1], value: '01' },
    { measure: 2, channel: '12', position: [0, 1], value: 'AA' },
    { measure: 3, channel: '13', position: [0, 1], value: '01' },
  ];
  return json;
}

function createCore(judgeMsPerChartSecond = 1000): JudgeCoreState {
  const source = chart();
  const resolved = resolveChart(source);
  const prepared = preparePlaybackChart(resolved);
  const ruleset = resolveRuleset(rulesetChartFactsFromChart(source, prepared), 'lr2');
  return createJudgeCoreState(
    {
      ruleset,
      scorableNotes: prepared.scorableNotes,
      landmineNotes: prepared.landmineNotes,
      invisibleNotes: prepared.invisibleNotes,
      laneSoundNotes: prepared.laneSoundNotes,
      scratchChannels: new Set(),
      autoScratch: false,
      judgeMsPerChartSecond,
      endOnFailure: false,
      wavResources: source.resources.wav,
      idBase: resolveBmsBase(source),
      sourceFormat: source.sourceFormat,
    },
    {
      ...createInitialPlayerSummary(ruleset, ruleset.noteCount),
      scoreTracker: createScoreTracker({ moneyScore: ruleset.moneyScore }),
    },
  );
}

/** Drives an inference over a fresh core, logging the key inputs it sends (`advance` steps left out). */
function infer(judgeMsPerChartSecond = 1000) {
  const state = createCore(judgeMsPerChartSecond);
  const sent: string[] = [];
  const step = (input: JudgeCoreInput): void => {
    if (input.kind === 'hold' || input.kind === 'press' || input.kind === 'release') {
      const at = input.kind === 'hold' ? '' : ` @${Math.round(input.nowSec * 1e6) / 1e6}`;
      sent.push(
        `${input.kind} ${[...input.channels].join(',')}${at}${'inferred' in input && input.inferred ? ' inferred' : ''}`,
      );
    }
    runJudgeCoreStep(state, input, () => undefined);
  };
  const inference = createKeyStateInference(state, step);
  const press = (channel: string, seconds: number): void =>
    inference.press(new Set([channel]), ['k'], seconds, seconds * judgeMsPerChartSecond);
  return { state, sent, inference, press };
}

describe('createKeyStateInference', () => {
  test('a press holds its lane until a short grace lapses, and the key comes up at that instant', () => {
    const { sent, inference, press } = infer();
    press('11', 0.99);
    expect(sent).toEqual(['hold 11 inferred', 'press 11 @0.99']);
    inference.releaseBefore(1.1);
    expect(sent).toHaveLength(2);
    inference.releaseBefore(1.2);
    expect(sent.slice(2)).toEqual(['release 11 @1.11 inferred']);
  });

  test('a long note held by key repeat: the head holds through the repeat delay, repeats keep it down', () => {
    const { state, sent, inference, press } = infer();
    press('12', 1.0);
    expect(state.activeLongNotes.has('12')).toBe(true);
    // The repeat delay: no repeat for 0.3 s, still held.
    inference.releaseBefore(1.3);
    for (let index = 0; index <= 14; index += 1) press('12', 1.3 + index * 0.05);
    // The repeats press nothing, and the tail passes while the key is down.
    expect(sent).toEqual(['hold 12 inferred', 'press 12 @1']);
    inference.releaseBefore(2.04);
    runJudgeCoreStep(state, { kind: 'advance', nowSec: 2.04, nowMs: 2040 }, () => undefined);
    expect(state.activeLongNotes.has('12')).toBe(false);
    expect(state.summary.perfect).toBe(1);
    // Past the tail a repeat is a press again, on a lane that stays down.
    press('12', 2.05);
    inference.releaseBefore(2.3);
    expect(sent.slice(2)).toEqual(['hold 12 inferred', 'press 12 @2.05', 'release 12 @2.17 inferred']);
  });

  test('a long note let go before its end: its key, still repeating, presses nothing', () => {
    const { state, sent, inference, press } = infer();
    press('12', 1.0);
    // The repeats come after the repeat delay: the key came up 0.38 s after the head.
    inference.releaseBefore(1.5);
    expect(sent).toEqual(['hold 12 inferred', 'press 12 @1', 'release 12 @1.38 inferred']);
    expect(state.summary.bad).toBe(1);
    press('12', 1.5);
    press('12', 1.55);
    expect(sent).toHaveLength(3);
    expect(state.summary.emptyPoor).toBe(0);
  });

  test('a key mashed faster than the grace is a new press on a lane that stays down', () => {
    const { sent, inference, press } = infer();
    press('13', 2.95);
    press('13', 3.0);
    inference.releaseBefore(4);
    expect(sent).toEqual([
      'hold 13 inferred',
      'press 13 @2.95',
      'hold 13 inferred',
      'press 13 @3',
      'release 13 @3.12 inferred',
    ]);
  });

  test('a press stamped before a release already sent is taken at the release', () => {
    const { sent, inference, press } = infer();
    press('11', 0.5);
    inference.releaseBefore(0.7);
    press('13', 0.6);
    expect(sent).toEqual([
      'hold 11 inferred',
      'press 11 @0.5',
      'release 11 @0.62 inferred',
      'hold 13 inferred',
      'press 13 @0.62',
    ]);
  });

  test('the grace runs in the judge’s milliseconds, so at tempo 2 it spans twice the chart time', () => {
    const { sent, inference, press } = infer(500);
    press('11', 0.99);
    inference.releaseBefore(2);
    expect(sent.at(-1)).toBe('release 11 @1.23 inferred');
  });

  test('stop drops the holds it inferred: the input reports its releases', () => {
    const { sent, inference, press } = infer();
    press('11', 0.99);
    inference.stop();
    inference.releaseBefore(5);
    expect(sent).toEqual(['hold 11 inferred', 'press 11 @0.99']);
  });
});

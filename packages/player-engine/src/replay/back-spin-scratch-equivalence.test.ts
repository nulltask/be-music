import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';
import { describe, expect, test } from 'vite-plus/test';
import type { RulesetId } from '../ruleset/index.ts';
import { runRecordedPlay } from '../test-support/recorded-play.ts';
import type { ReplayInputEvent, ReplayInputSource } from './format.ts';
import { simulateReplay } from './simulate.ts';

/**
 * Scratch holds keyed by input source (#605). A back-spin scratch (BSS, a charge long note on a scratch lane) ends on a
 * press from another source than the one that hit its head, under beatoraja (CN / HCN) and That-Which-Must-Not-Be-Named; LR2 plays
 * it as an LN. beatoraja also ends it on a release of the head's own source that would judge POOR, and lets a scratch
 * LN go only on its head source's release. The live engine (re-driven by the inputs) and the replay simulator must
 * agree judge for judge, and the recorded replay must name each input's source.
 */

/** BPM 240: a scratch long note on `16` from 1.0 s to 2.0 s via `#LNOBJ`, and a tap on `19` at 4.0 s never pressed. */
function scratchLongNoteChart(lnMode: 1 | 2 | 3): BeMusicJSON {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 240;
  json.metadata.rank = 2;
  json.bms.lnObjs = ['AA'];
  json.bms.lnMode = lnMode;
  json.events = [
    { measure: 1, channel: '16', position: [0, 1], value: '01' },
    { measure: 2, channel: '16', position: [0, 1], value: 'AA' },
    { measure: 4, channel: '19', position: [0, 1], value: '01' },
  ];
  return json;
}

/** The sources the steps below are played on, by name. */
const SOURCES = {
  shift: { kind: 'key', device: 'keyboard', label: 'shift-left' },
  ctrl: { kind: 'key', device: 'keyboard', label: 'ctrl-left' },
  up: { kind: 'turntable', device: 'controller', label: 'tt', direction: 'up' },
  down: { kind: 'turntable', device: 'controller', label: 'tt', direction: 'down' },
  touch: { kind: 'button', device: 'touch', label: 'shift-left' },
  button: { kind: 'button', device: 'controller', label: 'b8' },
} as const;
type SourceName = keyof typeof SOURCES;
const INPUT_SOURCES: ReplayInputSource[] = Object.values(SOURCES).map((source, id) => ({ id, ...source }));
const sourceId = (name: SourceName): number => Object.keys(SOURCES).indexOf(name);

type Step = readonly [timeUs: number, action: 'down' | 'up', source: SourceName];

function toInputs(steps: readonly Step[]): ReplayInputEvent[] {
  return steps.map(([timeUs, action, source], seq) => ({
    seq,
    timeUs,
    action,
    channels: ['16'],
    source: sourceId(source),
  }));
}

async function judge(ruleset: RulesetId, lnMode: 1 | 2 | 3, steps: readonly Step[]) {
  const { summary, replay } = await runRecordedPlay(scratchLongNoteChart(lnMode), toInputs(steps), ruleset, {
    replayInputSources: INPUT_SOURCES,
  });
  const simulated = simulateReplay(replay, { ruleset });
  const engine = [summary.perfect, summary.great, summary.good, summary.bad, summary.poor];
  expect(engine).toEqual([
    simulated.judge.pgreat,
    simulated.judge.great,
    simulated.judge.good,
    simulated.judge.bad,
    simulated.judge.poor,
  ]);
  expect(summary.emptyPoor).toBe(simulated.judge.emptyPoor);
  expect(summary.exScore).toBe(simulated.exScore);
  expect(summary.gauge?.current).toBeCloseTo(simulated.gauge.final, 6);
  return { judges: engine, replay };
}

// `[pgreat, great, good, bad, poor]`, the never-pressed tap on `19` included.
describe.concurrent('back-spin scratch: engine / simulator equivalence', () => {
  test.each(['beatoraja', '____'] as const)('%s: another key on the tail judges it', async (ruleset) => {
    const { judges, replay } = await judge(ruleset, 2, [
      [1_000_000, 'down', 'shift'],
      [1_950_000, 'up', 'shift'],
      [2_000_000, 'down', 'ctrl'],
      [2_050_000, 'up', 'ctrl'],
    ]);
    // Letting go of the head's key near the tail settles nothing: the head and the tail both PGREAT.
    expect(judges).toEqual([2, 0, 0, 0, 1]);
    // The replay names each input's source, and its table holds them with no device details.
    const recorded = replay.inputs.map((input) => replay.play.inputSources.find(({ id }) => id === input.source));
    expect(recorded.map((source) => source?.label)).toEqual(['shift-left', 'shift-left', 'ctrl-left', 'ctrl-left']);
    expect(replay.play.inputSources.map((source) => Object.keys(source).sort())).toEqual([
      ['device', 'id', 'kind', 'label'],
      ['device', 'id', 'kind', 'label'],
    ]);
  });

  test.each(['beatoraja', '____'] as const)('%s: the other turntable direction judges the tail', async (ruleset) => {
    const { judges, replay } = await judge(ruleset, 2, [
      [1_000_000, 'down', 'up'],
      [1_950_000, 'up', 'up'],
      [2_000_000, 'down', 'down'],
      [2_050_000, 'up', 'down'],
    ]);
    expect(judges).toEqual([2, 0, 0, 0, 1]);
    expect(replay.play.inputSources.map((source) => source.direction)).toEqual(['up', 'down']);
  });

  test.each(['beatoraja', '____'] as const)(
    '%s: the same turntable direction again is no reversal',
    async (ruleset) => {
      const { judges } = await judge(ruleset, 2, [
        [1_000_000, 'down', 'up'],
        [1_950_000, 'up', 'up'],
        [2_000_000, 'down', 'up'],
        [2_050_000, 'up', 'up'],
      ]);
      // The repeated source is a re-press: the tail is never ended and is missed.
      expect(judges).toEqual([1, 0, 0, 0, 2]);
    },
  );

  test.each(['beatoraja', '____'] as const)('%s: a tail released without another key is missed', async (ruleset) => {
    const { judges } = await judge(ruleset, 2, [
      [1_000_000, 'down', 'shift'],
      [2_000_000, 'up', 'shift'],
    ]);
    expect(judges).toEqual([1, 0, 0, 0, 2]);
  });

  test.each(['beatoraja', '____'] as const)('%s: the head key pressed again is a re-press', async (ruleset) => {
    const { judges } = await judge(ruleset, 2, [
      [1_000_000, 'down', 'shift'],
      [1_900_000, 'up', 'shift'],
      [2_000_000, 'down', 'shift'],
      [2_050_000, 'up', 'shift'],
    ]);
    expect(judges).toEqual([1, 0, 0, 0, 2]);
  });

  test.each(['beatoraja', '____'] as const)(
    '%s: another key while the first is held judges the tail',
    async (ruleset) => {
      const { judges } = await judge(ruleset, 2, [
        [1_000_000, 'down', 'shift'],
        [2_030_000, 'down', 'ctrl'],
        [2_060_000, 'up', 'shift'],
        [2_100_000, 'up', 'ctrl'],
      ]);
      // Head and tail both scored; only the never-pressed tap is missed.
      expect(judges[0] + judges[1] + judges[2] + judges[3]).toBe(2);
      expect(judges[4]).toBe(1);
    },
  );

  // beatoraja `JudgeManager` L494-L511: a release of the head's key that would judge POOR ends the BSS at once.
  test('beatoraja: letting go of the head key far before the tail ends the BSS as a POOR', async () => {
    const { judges } = await judge('beatoraja', 2, [
      [1_000_000, 'down', 'shift'],
      [1_300_000, 'up', 'shift'],
      [2_000_000, 'down', 'ctrl'],
      [2_050_000, 'up', 'ctrl'],
    ]);
    // The head PGREATs, the tail is a POOR at the release, and the later press finds no note.
    expect(judges).toEqual([1, 0, 0, 0, 2]);
  });

  test('That-Which-Must-Not-Be-Named: letting go of the head key far before the tail settles nothing', async () => {
    const { judges } = await judge('____', 2, [
      [1_000_000, 'down', 'shift'],
      [1_300_000, 'up', 'shift'],
      [2_000_000, 'down', 'ctrl'],
      [2_050_000, 'up', 'ctrl'],
    ]);
    expect(judges).toEqual([2, 0, 0, 0, 1]);
  });

  test('beatoraja: a release of another key than the head’s never ends the BSS', async () => {
    const { judges } = await judge('beatoraja', 2, [
      [1_000_000, 'down', 'shift'],
      // Far too early for the tail, but not the head's key: ignored.
      [1_300_000, 'up', 'ctrl'],
      [1_950_000, 'up', 'shift'],
      [2_000_000, 'down', 'ctrl'],
      [2_050_000, 'up', 'ctrl'],
    ]);
    expect(judges).toEqual([2, 0, 0, 0, 1]);
  });

  test.each(['beatoraja', '____'] as const)(
    '%s: another key pressed far before the tail ends the BSS as a POOR',
    async (ruleset) => {
      const { judges } = await judge(ruleset, 2, [
        [1_000_000, 'down', 'shift'],
        [1_100_000, 'down', 'ctrl'],
        [1_200_000, 'up', 'ctrl'],
        [2_000_000, 'up', 'shift'],
      ]);
      expect(judges).toEqual([1, 0, 0, 0, 2]);
    },
  );

  test.each(['beatoraja', '____'] as const)('%s: a Hell Charge BSS agrees on the gauge', async (ruleset) => {
    const { judges } = await judge(ruleset, 3, [
      [1_000_000, 'down', 'shift'],
      [1_950_000, 'up', 'shift'],
      [2_000_000, 'down', 'ctrl'],
      [2_050_000, 'up', 'ctrl'],
    ]);
    expect(judges).toEqual([2, 0, 0, 0, 1]);
  });

  test('beatoraja: a Hell Charge BSS released far too early is a POOR tail', async () => {
    const { judges } = await judge('beatoraja', 3, [
      [1_000_000, 'down', 'shift'],
      [1_500_000, 'up', 'shift'],
    ]);
    expect(judges).toEqual([1, 0, 0, 0, 2]);
  });

  // The single-source fallback: a touch zone (or a controller button) is the only input of its kind on its lane, so a
  // hold it starts is lenient — any fresh press ends it, its own source's included, and a release settles nothing.
  test.each(['beatoraja', '____'] as const)('%s: a touch zone tapped again finishes a BSS', async (ruleset) => {
    const { judges } = await judge(ruleset, 2, [
      [1_000_000, 'down', 'touch'],
      [1_300_000, 'up', 'touch'],
      [2_000_000, 'down', 'touch'],
      [2_050_000, 'up', 'touch'],
    ]);
    expect(judges).toEqual([2, 0, 0, 0, 1]);
  });

  test.each(['beatoraja', '____'] as const)(
    '%s: a second touch while the first is held finishes a BSS',
    async (ruleset) => {
      const { judges } = await judge(ruleset, 3, [
        [1_000_000, 'down', 'touch'],
        [2_000_000, 'down', 'touch'],
        [2_050_000, 'up', 'touch'],
      ]);
      expect(judges).toEqual([2, 0, 0, 0, 1]);
    },
  );

  test('beatoraja: a controller button bound alone plays the lenient rule too', async () => {
    const { judges } = await judge('beatoraja', 2, [
      [1_000_000, 'down', 'button'],
      [1_300_000, 'up', 'button'],
      [2_000_000, 'down', 'button'],
      [2_050_000, 'up', 'button'],
    ]);
    expect(judges).toEqual([2, 0, 0, 0, 1]);
  });

  test('lr2: a scratch long note is an LN, settled by its release', async () => {
    const { judges } = await judge('lr2', 2, [
      [1_000_000, 'down', 'shift'],
      [2_000_000, 'up', 'shift'],
    ]);
    expect(judges).toEqual([1, 0, 0, 0, 1]);
  });

  test('lr2: another key’s release lets a scratch LN go, as before', async () => {
    const { judges } = await judge('lr2', 2, [
      [1_000_000, 'down', 'shift'],
      [1_100_000, 'down', 'ctrl'],
      [1_200_000, 'up', 'ctrl'],
      [2_000_000, 'up', 'shift'],
    ]);
    // LR2 releases the lane on any key: the LN is let go at 1.2 s, early.
    expect(judges[0]).toBe(0);
    expect(judges[3] + judges[4]).toBe(2);
  });
});

// beatoraja `JudgeManager` L522-L531: a scratch LN (`#LNMODE 1`) is let go only by the key that hit its head.
describe.concurrent('scratch LN keyed by source: engine / simulator equivalence', () => {
  test('beatoraja: a scratch LN is no BSS, settled by its release', async () => {
    const { judges } = await judge('beatoraja', 1, [
      [1_000_000, 'down', 'shift'],
      [2_000_000, 'up', 'shift'],
    ]);
    expect(judges).toEqual([1, 0, 0, 0, 1]);
  });

  test('beatoraja: another key’s release is ignored, and the head key’s release settles it', async () => {
    const { judges } = await judge('beatoraja', 1, [
      [1_000_000, 'down', 'shift'],
      [1_100_000, 'down', 'ctrl'],
      [1_200_000, 'up', 'ctrl'],
      [2_000_000, 'up', 'shift'],
    ]);
    expect(judges).toEqual([1, 0, 0, 0, 1]);
  });

  test('beatoraja: the head key let go first releases the LN, however the other key stays', async () => {
    const { judges } = await judge('beatoraja', 1, [
      [1_000_000, 'down', 'shift'],
      [1_100_000, 'down', 'ctrl'],
      [1_200_000, 'up', 'shift'],
      [2_000_000, 'up', 'ctrl'],
    ]);
    // Released 0.8 s early: the LN breaks (a BAD-or-worse), and the tap on 19 is missed.
    expect(judges[0]).toBe(0);
    expect(judges[3] + judges[4]).toBe(2);
  });
});

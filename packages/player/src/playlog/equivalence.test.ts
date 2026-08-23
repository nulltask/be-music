import { createEmptyJson, type BeMusicJson } from '@be-music/json';
import { describe, expect, test } from 'vitest';
import { manualPlay } from '../index.ts';
import type { PlayerSummary } from '../core/engine.ts';
import { simulatePlaylog } from './simulate.ts';
import type { BeMusicPlaylog, PlaylogInputEvent } from './format.ts';
import type { PlaylogRulesetId } from '../ruleset/index.ts';

/**
 * Golden-replay equivalence: the live engine and the play-log simulator must reach the SAME judgments from the
 * same inputs under the same ruleset. The engine judges against a wall-clock playback loop and the simulator
 * against a pure event queue, so agreement here is what makes a recorded log a faithful score reproduction rather
 * than an approximation.
 *
 * Both sides are driven from the same recorded input stream: the engine replays it (`replayInputs`, exact
 * microsecond timestamps, no jitter) while recording a log, and the simulator then re-runs that log.
 */

interface ReplayRun {
  summary: PlayerSummary;
  playlog: BeMusicPlaylog;
}

async function replay(
  json: BeMusicJson,
  inputs: readonly PlaylogInputEvent[],
  ruleset: PlaylogRulesetId,
): Promise<ReplayRun> {
  let playlog: BeMusicPlaylog | undefined;
  const summary = await manualPlay(json, {
    speed: 16,
    leadInMs: 0,
    audio: false,
    tui: false,
    judgeRuleset: ruleset,
    replayInputs: inputs,
    recordPlaylog: {},
    onPlaylogRecorded: (recorded) => {
      playlog = recorded;
    },
  });
  return { summary, playlog: playlog! };
}

function down(seq: number, timeUs: number, ...channels: string[]): PlaylogInputEvent {
  return { seq, timeUs, action: 'down', channels };
}

function up(seq: number, timeUs: number, ...channels: string[]): PlaylogInputEvent {
  return { seq, timeUs, action: 'up', channels };
}

/** BPM 240, a long note on `11` from 1.0 s to 2.0 s via `#LNOBJ`, plus a plain note that is never pressed. */
function longNoteChart(lnMode?: 1 | 2 | 3): BeMusicJson {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 240;
  json.metadata.rank = 2;
  json.bms.lnObjs = ['AA'];
  if (lnMode !== undefined) {
    json.bms.lnMode = lnMode;
  }
  json.events = [
    { measure: 1, channel: '11', position: [0, 1], value: '01' },
    { measure: 2, channel: '11', position: [0, 1], value: 'AA' },
    { measure: 4, channel: '19', position: [0, 1], value: '01' },
  ];
  return json;
}

/** BPM 240 → one measure per second, so `measure` + `position` read directly as seconds. */
function chart(events: BeMusicJson['events'], rank = 2): BeMusicJson {
  const json = createEmptyJson('bms');
  json.metadata.bpm = 240;
  json.metadata.rank = rank;
  json.events = events;
  return json;
}

const RULESETS: readonly PlaylogRulesetId[] = ['lr2', 'beatoraja', 'iidx'];

describe('engine / simulator equivalence', () => {
  test.each(RULESETS)('%s: a mixed-timing pass over a key cluster agrees judge for judge', async (ruleset) => {
    const json = chart([
      { measure: 1, channel: '11', position: [0, 1], value: '01' }, // 1.000
      { measure: 1, channel: '12', position: [1, 4], value: '01' }, // 1.250
      { measure: 1, channel: '13', position: [1, 2], value: '01' }, // 1.500
      { measure: 1, channel: '14', position: [3, 4], value: '01' }, // 1.750
      { measure: 2, channel: '19', position: [0, 1], value: '01' }, // 2.000 — never pressed
    ]);
    const inputs = [
      down(0, 1_000_000, '11'), // exact
      down(1, 1_270_000, '12'), // 20 ms late
      down(2, 1_440_000, '13'), // 60 ms early
      down(3, 1_880_000, '14'), // 130 ms late
    ];

    const { summary, playlog } = await replay(json, inputs, ruleset);
    const simulated = simulatePlaylog(playlog, { ruleset });

    expect({
      pgreat: summary.perfect,
      great: summary.great,
      good: summary.good,
      bad: summary.bad,
      poor: summary.poor,
    }).toEqual({
      pgreat: simulated.judge.pgreat,
      great: simulated.judge.great,
      good: simulated.judge.good,
      bad: simulated.judge.bad,
      poor: simulated.judge.poor,
    });
    expect(summary.exScore).toBe(simulated.exScore);
    expect(summary.fast).toBe(simulated.fast);
    expect(summary.slow).toBe(simulated.slow);
    // Only LR2 defines a money score; the others report EX-SCORE in the same field.
    expect(summary.score).toBe(simulated.score ?? simulated.exScore);
    // Guard against a vacuous pass: the timings above are chosen to span several judges, so a run that resolved
    // to all-POOR (or all-PGREAT) on both sides would agree without proving anything.
    expect(summary.perfect + summary.great + summary.good).toBeGreaterThan(0);
    expect(summary.poor).toBeGreaterThan(0);
  });

  test.each(RULESETS)('%s: a scratch lane agrees on its own window table', async (ruleset) => {
    const json = chart([
      { measure: 1, channel: '16', position: [0, 1], value: '01' },
      { measure: 1, channel: '11', position: [1, 2], value: '01' },
      { measure: 2, channel: '19', position: [0, 1], value: '01' },
    ]);
    const inputs = [down(0, 1_065_000, '16'), down(1, 1_565_000, '11')];

    const { summary, playlog } = await replay(json, inputs, ruleset);
    const simulated = simulatePlaylog(playlog, { ruleset });

    expect([summary.perfect, summary.great, summary.good, summary.bad, summary.poor]).toEqual([
      simulated.judge.pgreat,
      simulated.judge.great,
      simulated.judge.good,
      simulated.judge.bad,
      simulated.judge.poor,
    ]);
    expect(summary.exScore).toBe(simulated.exScore);
  });

  test.each(RULESETS)('%s: a long note held cleanly to its tail agrees on both sides', async (ruleset) => {
    const json = longNoteChart(2);
    const inputs = [down(0, 1_000_000, '11'), up(1, 2_000_000, '11')];

    const { summary, playlog } = await replay(json, inputs, ruleset);
    const simulated = simulatePlaylog(playlog, { ruleset });

    expect([summary.perfect, summary.great, summary.good, summary.bad, summary.poor]).toEqual([
      simulated.judge.pgreat,
      simulated.judge.great,
      simulated.judge.good,
      simulated.judge.bad,
      simulated.judge.poor,
    ]);
    expect(summary.exScore).toBe(simulated.exScore);
    // The ruleset decides how many judgments one long note is worth: LR2 plays it as an LN (one), beatoraja
    // honours `#LNMODE 2` as a CN and IIDX charges everything (head and tail, so two).
    expect(summary.total).toBe(simulated.noteCount);
    expect(summary.total).toBe(ruleset === 'lr2' ? 2 : 3);
  });

  test.each(RULESETS)('%s: releasing a long note early agrees on both sides', async (ruleset) => {
    const json = longNoteChart(2);
    const inputs = [down(0, 1_000_000, '11'), up(1, 1_400_000, '11')];

    const { summary, playlog } = await replay(json, inputs, ruleset);
    const simulated = simulatePlaylog(playlog, { ruleset });

    expect([summary.perfect, summary.great, summary.good, summary.bad, summary.poor]).toEqual([
      simulated.judge.pgreat,
      simulated.judge.great,
      simulated.judge.good,
      simulated.judge.bad,
      simulated.judge.poor,
    ]);
    expect(summary.exScore).toBe(simulated.exScore);
  });

  test.each(RULESETS)('%s: never touching a long note agrees on both sides', async (ruleset) => {
    const json = longNoteChart(2);

    const { summary, playlog } = await replay(json, [], ruleset);
    const simulated = simulatePlaylog(playlog, { ruleset });

    expect({ poor: summary.poor, total: summary.total }).toEqual({
      poor: simulated.judge.poor,
      total: simulated.noteCount,
    });
  });

  test.each(RULESETS)('%s: empty POORs agree on both sides', async (ruleset) => {
    const json = chart([
      { measure: 2, channel: '11', position: [0, 1], value: '01' }, // 2.000
      { measure: 4, channel: '19', position: [0, 1], value: '01' }, // 4.000 — never pressed
    ]);
    // 1.600 is 400 ms before the note: outside every judge window but inside every ruleset's miss window, so it
    // charges an empty POOR without consuming the note. 1.995 then hits the note itself.
    const inputs = [down(0, 1_600_000, '11'), down(1, 1_995_000, '11')];

    const { summary, playlog } = await replay(json, inputs, ruleset);
    const simulated = simulatePlaylog(playlog, { ruleset });

    expect(summary.emptyPoor).toBe(1);
    expect(summary.emptyPoor).toBe(simulated.judge.emptyPoor);
    // The empty POOR left the note alone, so the second press still scores it.
    expect(summary.perfect).toBe(1);
    expect(summary.perfect).toBe(simulated.judge.pgreat);
    expect(summary.poor).toBe(simulated.judge.poor);
  });

  test('lr2: the empty POOR window is early-only', async () => {
    // LR2's miss window is `{0, 1 s}` — a press up to a second BEFORE a note charges one, a press after never does.
    const json = chart([{ measure: 2, channel: '11', position: [0, 1], value: '01' }]);

    const before = await replay(json, [down(0, 1_600_000, '11')], 'lr2');
    const after = await replay(json, [down(0, 2_400_000, '11')], 'lr2');

    expect(before.summary.emptyPoor).toBe(1);
    expect(after.summary.emptyPoor).toBe(0);
  });

  test.each(RULESETS)('%s: an untouched chart misses every note on both sides', async (ruleset) => {
    const json = chart([
      { measure: 1, channel: '11', position: [0, 1], value: '01' },
      { measure: 1, channel: '12', position: [1, 2], value: '01' },
      { measure: 2, channel: '19', position: [0, 1], value: '01' },
    ]);

    const { summary, playlog } = await replay(json, [], ruleset);
    const simulated = simulatePlaylog(playlog, { ruleset });

    expect(summary.poor).toBe(3);
    expect(simulated.judge.poor).toBe(3);
    expect(summary.exScore).toBe(0);
    expect(simulated.exScore).toBe(0);
  });
});

import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';
import { describe, expect, test } from 'vite-plus/test';
import { resolveChart } from '@be-music/chart-model';
import { manualPlay, preparePlaybackChart } from '../index.ts';
import type { PlayerOptions, PlayerSummary } from '../core/engine.ts';
import { resolveRulesetConfig, simulateReplay } from './simulate.ts';
import { createScheduledInputRuntime } from '../test-support/player-fixtures.ts';
import { parseReplay, serializeReplay, type BeMusicReplay, type ReplayInputEvent } from './format.ts';
import type { RulesetId } from '../ruleset/index.ts';

/**
 * Golden-replay equivalence: the live engine and the replay simulator must reach the SAME judgments from the
 * same inputs under the same ruleset. The engine judges against a wall-clock playback loop and the simulator
 * against a pure event queue, so agreement here is what makes a recorded log a faithful score reproduction rather
 * than an approximation.
 *
 * Both sides are driven from the same recorded input stream: the engine replays it (`replayInputs`, exact
 * microsecond timestamps, no jitter) while recording a log, and the simulator then re-runs that log.
 */

interface ReplayRun {
  summary: PlayerSummary;
  replay: BeMusicReplay;
}

async function runRecordedPlay(
  json: BeMusicJSON,
  inputs: readonly ReplayInputEvent[],
  ruleset: RulesetId,
  extra: PlayerOptions = {},
): Promise<ReplayRun> {
  let replay: BeMusicReplay | undefined;
  const summary = await manualPlay(json, {
    ...extra,
    speed: 16,
    leadInMs: 0,
    audio: false,
    tui: false,
    judgeRuleset: ruleset,
    replayInputs: inputs,
    recordReplay: extra.recordReplay ?? {},
    onReplayRecorded: (recorded) => {
      replay = recorded;
    },
  });
  return { summary, replay: replay! };
}

function down(seq: number, timeUs: number, ...channels: string[]): ReplayInputEvent {
  return { seq, timeUs, action: 'down', channels };
}

function up(seq: number, timeUs: number, ...channels: string[]): ReplayInputEvent {
  return { seq, timeUs, action: 'up', channels };
}

/** BPM 240, a long note on `11` from 1.0 s to 2.0 s via `#LNOBJ`, plus a plain note that is never pressed. */
function longNoteChart(lnMode?: 1 | 2 | 3): BeMusicJSON {
  const json = createEmptyJSON('bms');
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
function chart(events: BeMusicJSON['events'], rank = 2): BeMusicJSON {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 240;
  json.metadata.rank = rank;
  json.events = events;
  return json;
}

/**
 * The negative-BPM reversal scenario: BPM 240, a pre-reversal STOP (1.0 s, 0.25 s long), an LN on 12 from 1.75 s to
 * 3.25 s, a note on 11 at 2.2 s (R - 50 ms), the reversal `#BPM02 -60` at R = 2.25 s with a BGM on the same tick, a
 * note on 13 at 2.35 s (R + 100 ms), a note on 14 at 2.75 s, a post-reversal STOP (4.25 s, 1 s long), BPM 240 again
 * at 7.25 s, and a far note on 11 at 8.25 s.
 */
function reversalScenarioChart(): BeMusicJSON {
  const json = chart([
    { measure: 1, channel: '09', position: [0, 1], value: '01' },
    { measure: 1, channel: '12', position: [1, 2], value: '01' },
    { measure: 1, channel: '11', position: [19, 20], value: '01' },
    { measure: 2, channel: '08', position: [0, 1], value: '02' },
    { measure: 2, channel: '01', position: [0, 1], value: '03' },
    { measure: 2, channel: '13', position: [1, 40], value: '01' },
    { measure: 2, channel: '12', position: [1, 4], value: 'ZZ' },
    { measure: 2, channel: '14', position: [1, 8], value: '01' },
    { measure: 2, channel: '09', position: [1, 2], value: '01' },
    { measure: 3, channel: '03', position: [0, 1], value: 'F0' },
    { measure: 4, channel: '11', position: [0, 1], value: '01' },
  ]);
  json.bms.lnObjs = ['ZZ'];
  json.resources.bpm['02'] = -60;
  json.resources.stop['01'] = 48;
  json.resources.wav = { '01': 'note.wav', '03': 'bgm.wav' };
  return json;
}

const RULESETS: readonly RulesetId[] = ['lr2', 'beatoraja', '____'];

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

    const { summary, replay } = await runRecordedPlay(json, inputs, ruleset);
    const simulated = simulateReplay(replay, { ruleset });

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

    const { summary, replay } = await runRecordedPlay(json, inputs, ruleset);
    const simulated = simulateReplay(replay, { ruleset });

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

    const { summary, replay } = await runRecordedPlay(json, inputs, ruleset);
    const simulated = simulateReplay(replay, { ruleset });

    expect([summary.perfect, summary.great, summary.good, summary.bad, summary.poor]).toEqual([
      simulated.judge.pgreat,
      simulated.judge.great,
      simulated.judge.good,
      simulated.judge.bad,
      simulated.judge.poor,
    ]);
    expect(summary.exScore).toBe(simulated.exScore);
    // The ruleset decides how many judgments one long note is worth: LR2 plays it as an LN (one), beatoraja
    // honours `#LNMODE 2` as a CN and That-Which-Must-Not-Be-Named charges everything (head and tail, so two).
    expect(summary.total).toBe(simulated.noteCount);
    expect(summary.total).toBe(ruleset === 'lr2' ? 2 : 3);
  });

  test.each(RULESETS)('%s: releasing a long note early agrees on both sides', async (ruleset) => {
    const json = longNoteChart(2);
    const inputs = [down(0, 1_000_000, '11'), up(1, 1_400_000, '11')];

    const { summary, replay } = await runRecordedPlay(json, inputs, ruleset);
    const simulated = simulateReplay(replay, { ruleset });

    expect([summary.perfect, summary.great, summary.good, summary.bad, summary.poor]).toEqual([
      simulated.judge.pgreat,
      simulated.judge.great,
      simulated.judge.good,
      simulated.judge.bad,
      simulated.judge.poor,
    ]);
    expect(summary.exScore).toBe(simulated.exScore);
  });

  // An LN let go just before its tail — e.g. a hand freeing the key for a tap that sits right on the tail — is not a
  // BAD: LR2 keeps the head judgment inside the GOOD window, beatoraja takes the worse of head and release.
  test.each(RULESETS)('%s: releasing an LN just before its tail agrees on both sides', async (ruleset) => {
    const json = longNoteChart(1);

    for (const earlyUs of [1, 50_000]) {
      const inputs = [down(0, 1_000_000, '11'), up(1, 2_000_000 - earlyUs, '11')];
      const { summary, replay } = await runRecordedPlay(json, inputs, ruleset);
      const simulated = simulateReplay(replay, { ruleset });

      expect([summary.perfect, summary.great, summary.good, summary.bad, summary.poor], `${earlyUs} µs`).toEqual([
        simulated.judge.pgreat,
        simulated.judge.great,
        simulated.judge.good,
        simulated.judge.bad,
        simulated.judge.poor,
      ]);
      expect(summary.bad, `${earlyUs} µs`).toBe(0);
      if (ruleset === 'lr2') {
        expect(summary.perfect, `${earlyUs} µs`).toBe(1);
      }
    }
  });

  // A press exactly on a window edge: the replay clock is whole microseconds, and a note at BPM 140 sits at a time
  // whose float seconds do not subtract to an exact delta, so the engine must judge the rounded delta as the
  // simulator does instead of landing a hair outside the edge.
  test.each(RULESETS)('%s: a press on a window edge agrees on both sides', async (ruleset) => {
    const json = chart([{ measure: 1, channel: '11', position: [0, 1], value: '01' }]);
    json.metadata.bpm = 140;
    const probe = await runRecordedPlay(json, [], ruleset);
    const noteUs = probe.replay.chart.notes[0]!.timeUs;
    const [lateEdgeUs, earlyEdgeUs] = resolveRulesetConfig(probe.replay, ruleset).windows.note.judges[2];

    for (const pressUs of [noteUs - lateEdgeUs, noteUs - earlyEdgeUs]) {
      const { summary, replay } = await runRecordedPlay(
        json,
        [down(0, pressUs, '11'), up(1, pressUs + 40_000, '11')],
        ruleset,
      );
      const simulated = simulateReplay(replay, { ruleset });

      expect([summary.good, summary.bad], `press at ${pressUs} µs`).toEqual([1, 0]);
      expect([summary.good, summary.bad], `press at ${pressUs} µs`).toEqual([
        simulated.judge.good,
        simulated.judge.bad,
      ]);
    }
  });

  // An LN released exactly on a long-note-end window edge, at a BPM whose note times are not exact in float seconds.
  test.each(RULESETS)('%s: an LN released on a window edge agrees on both sides', async (ruleset) => {
    const json = longNoteChart(1);
    json.metadata.bpm = 140;
    const probe = await runRecordedPlay(json, [down(0, 0, '19')], ruleset);
    const head = probe.replay.chart.notes.find((note) => note.channel === '11')!;
    const endWindows = resolveRulesetConfig(probe.replay, ruleset).windows.longNoteEnd.judges;

    for (const [, earlyEdgeUs] of endWindows) {
      const inputs = [down(0, head.timeUs, '11'), up(1, head.endTimeUs! - earlyEdgeUs, '11')];
      const { summary, replay } = await runRecordedPlay(json, inputs, ruleset);
      const simulated = simulateReplay(replay, { ruleset });

      expect([summary.perfect, summary.great, summary.good, summary.bad, summary.poor], `${earlyEdgeUs} µs`).toEqual([
        simulated.judge.pgreat,
        simulated.judge.great,
        simulated.judge.good,
        simulated.judge.bad,
        simulated.judge.poor,
      ]);
    }
  });

  // beatoraja's five-key rule breaks the combo on an empty POOR, and the max combo has to see that break.
  test.each(RULESETS)('%s: an empty POOR between hits agrees on the max combo', async (ruleset) => {
    const json = chart([
      { measure: 1, channel: '11', position: [0, 1], value: '01' },
      { measure: 2, channel: '11', position: [0, 1], value: '01' },
      { measure: 3, channel: '11', position: [0, 1], value: '01' },
    ]);
    const inputs = [
      down(0, 1_000_000, '11'),
      up(1, 1_040_000, '11'),
      down(2, 1_600_000, '11'),
      up(3, 1_640_000, '11'),
      down(4, 2_000_000, '11'),
      up(5, 2_040_000, '11'),
      down(6, 3_000_000, '11'),
      up(7, 3_040_000, '11'),
    ];

    const { summary, replay } = await runRecordedPlay(json, inputs, ruleset);
    const simulated = simulateReplay(replay, { ruleset });

    expect(summary.emptyPoor).toBe(simulated.judge.emptyPoor);
    expect(replay.results?.native?.maxCombo).toBe(simulated.maxCombo);
    if (ruleset === 'beatoraja') {
      expect(simulated.maxCombo).toBe(2);
    }
  });

  // A terminal replayged before the engine inferred releases: every press, key repeats included, and no release. A
  // replay reads it as it is, as the simulator does: each key is down from its first press to the end of the play.
  test.each(RULESETS)('%s: a log without releases replays as it is and agrees on both sides', async (ruleset) => {
    const inputs = [
      down(0, 1_000_000, '11'),
      down(1, 1_250_000, '12'),
      down(2, 1_300_000, '12'),
      down(3, 1_500_000, '11'),
      down(4, 1_500_000, '12'),
      down(5, 1_540_000, '11'),
      down(6, 1_580_000, '11'),
      down(7, 2_200_000, '13'),
    ];
    for (const lnMode of [1, 2, 3] as const) {
      // A long note on 11 whose key repeats, two notes on 12 with a repeat between them, and a mine crossing 13.
      const json = chart([
        { measure: 1, channel: '11', position: [0, 1], value: '01' },
        { measure: 1, channel: '12', position: [1, 4], value: '01' },
        { measure: 1, channel: '12', position: [1, 2], value: '01' },
        { measure: 2, channel: '11', position: [0, 1], value: 'AA' },
        { measure: 2, channel: '13', position: [1, 5], value: '01' },
        { measure: 2, channel: 'D3', position: [1, 2], value: '0A' },
        { measure: 4, channel: '19', position: [0, 1], value: '01' },
      ]);
      json.bms.lnObjs = ['AA'];
      json.bms.lnMode = lnMode;
      const name = `#LNMODE ${lnMode}`;

      const { summary, replay } = await runRecordedPlay(json, inputs, ruleset);
      const simulated = simulateReplay(replay, { ruleset });

      // The replay infers no release: it re-records the presses it was given.
      expect(
        replay.inputs.map(({ timeUs, action, channels }) => ({ timeUs, action, channels })),
        name,
      ).toEqual(inputs.map(({ timeUs, action, channels }) => ({ timeUs, action, channels })));
      expect(
        [summary.perfect, summary.great, summary.good, summary.bad, summary.poor, summary.emptyPoor],
        name,
      ).toEqual([
        simulated.judge.pgreat,
        simulated.judge.great,
        simulated.judge.good,
        simulated.judge.bad,
        simulated.judge.poor,
        simulated.judge.emptyPoor,
      ]);
      expect(summary.exScore, name).toBe(simulated.exScore);
      expect(replay.results?.native?.maxCombo, name).toBe(simulated.maxCombo);
      expect(summary.gauge?.current, name).toBeCloseTo(simulated.gauge.final, 2);
    }
  });

  // Channel 16 is a key, not a scratch, in the BME-type 9 KEY layout and the keyboard modes: AUTO SCRATCH must leave
  // it to the player on both sides.
  test.each(RULESETS)('%s: AUTO SCRATCH leaves channel 16 alone where it is a key', async (ruleset) => {
    for (const playVariant of ['9', '24'] as const) {
      const channels =
        playVariant === '9' ? ['11', '12', '13', '14', '15', '16', '17', '18', '19'] : ['11', '16', '1A'];
      const json = chart(channels.map((channel) => ({ measure: 1, channel, position: [0, 1], value: '01' })));
      const inputs = [down(0, 1_000_000, '11'), up(1, 1_040_000, '11')];

      const { summary, replay } = await runRecordedPlay(json, inputs, ruleset, { autoScratch: true, playVariant });
      const simulated = simulateReplay(replay, { ruleset });

      expect([summary.perfect, summary.poor], playVariant).toEqual([simulated.judge.pgreat, simulated.judge.poor]);
      expect(summary.perfect, playVariant).toBe(1);
    }
  });

  // The replay must record the gauge the engine ran, whichever option the host set it through.
  test.each(RULESETS)('%s: the recorded gauge is the gauge the engine ran', async (ruleset) => {
    const json = chart([
      { measure: 1, channel: '11', position: [0, 1], value: '01' },
      { measure: 2, channel: '11', position: [0, 1], value: '01' },
    ]);
    const inputs = [down(0, 1_000_000, '11'), up(1, 1_040_000, '11')];

    for (const extra of [{ gauge: 'HARD' }, { recordReplay: { gauge: 'HARD' } }] as const) {
      const { summary, replay } = await runRecordedPlay(json, inputs, ruleset, extra);
      const simulated = simulateReplay(replay, { ruleset });

      expect(replay.play.gauge, JSON.stringify(extra)).toBe('HARD');
      expect(summary.gauge?.type, JSON.stringify(extra)).toBe(simulated.gauge.type);
      expect(summary.gauge?.current, JSON.stringify(extra)).toBeCloseTo(simulated.gauge.final, 2);
    }
  });

  // `#EXRANK` changes are recorded whatever ruleset the play ran under, so re-simulating a beatoraja or That-Which-Must-Not-Be-Named log under
  // LR2 uses the windows an LR2 play of the same inputs used.
  test.each(['beatoraja', '____'] as const)(
    'a %s log re-simulates under lr2 with the #EXRANK changes',
    async (ruleset) => {
      const json = chart([
        { measure: 1, channel: 'A0', position: [0, 1], value: '01' },
        { measure: 2, channel: '11', position: [0, 1], value: '01' },
      ]);
      json.bms.exRank['01'] = '25';
      const inputs = [down(0, 2_040_000, '11'), up(1, 2_080_000, '11')];

      const played = await runRecordedPlay(json, inputs, ruleset);
      const lr2 = await runRecordedPlay(json, inputs, 'lr2');
      const resimulated = simulateReplay(played.replay, { ruleset: 'lr2' });

      expect(played.replay.chart.judgeRank.timeline).toHaveLength(1);
      expect([
        resimulated.judge.pgreat,
        resimulated.judge.great,
        resimulated.judge.good,
        resimulated.judge.bad,
      ]).toEqual([lr2.summary.perfect, lr2.summary.great, lr2.summary.good, lr2.summary.bad]);
    },
  );

  // Holding a charge note past its tail's late window is a missed POOR, not a BAD at the window's edge.
  test.each(RULESETS)('%s: a charge tail held past its late window agrees on both sides', async (ruleset) => {
    for (const lnMode of [2, 3] as const) {
      const json = longNoteChart(lnMode);
      const inputs = [down(0, 1_000_000, '11'), up(1, 3_000_000, '11')];
      const { summary, replay } = await runRecordedPlay(json, inputs, ruleset);
      const simulated = simulateReplay(replay, { ruleset });

      expect([summary.perfect, summary.bad, summary.poor], `#LNMODE ${lnMode}`).toEqual([
        simulated.judge.pgreat,
        simulated.judge.bad,
        simulated.judge.poor,
      ]);
      expect(summary.bad, `#LNMODE ${lnMode}`).toBe(0);
    }
  });

  // A press on a lane whose long note was already let go is an ordinary press: no window after the release, and no
  // waiting for the tail, keeps it from charging an empty POOR.
  test.each(RULESETS)('%s: a press after an LN was let go is judged as any other press', async (ruleset) => {
    const json = chart([
      { measure: 1, channel: '11', position: [0, 1], value: '01' },
      { measure: 3, channel: '11', position: [0, 1], value: 'AA' },
      { measure: 3, channel: '11', position: [1, 4], value: '01' },
    ]);
    json.bms.lnObjs = ['AA'];
    const inputs = [down(0, 1_000_000, '11'), up(1, 1_500_000, '11'), down(2, 2_900_000, '11'), up(3, 2_950_000, '11')];

    const { summary, replay } = await runRecordedPlay(json, inputs, ruleset);
    const simulated = simulateReplay(replay, { ruleset });

    expect(summary.emptyPoor).toBe(simulated.judge.emptyPoor);
    expect(summary.emptyPoor).toBe(1);
  });

  // Misses are settled at each note's own deadline: a key note whose window closes before an earlier scratch note's
  // (beatoraja's scratch BAD window reaches 10 ms further) is missed first, so a hit between the two deadlines starts a
  // new combo instead of extending the old one.
  test.each(RULESETS)('%s: misses settle in deadline order across lanes', async (ruleset) => {
    const at = (channel: string, us: number) => ({
      measure: 0,
      channel,
      position: [us, 1_000_000] as const,
      value: '01',
    });
    const probe = await runRecordedPlay(chart([at('11', 1_000_000), at('16', 1_000_000)], 3), [], ruleset);
    const { windows } = resolveRulesetConfig(probe.replay, ruleset);
    const keyLateUs = -windows.note.judges[3][0];
    const scratchLateUs = -windows.scratch.judges[3][0];
    const keyNoteUs = 400_000 + Math.max(0, scratchLateUs - keyLateUs) / 2;
    const pressUs = keyNoteUs + keyLateUs + 1_000;

    const json = chart([at('13', 100_000), at('16', 400_000), at('11', keyNoteUs), at('12', pressUs)], 3);
    const inputs = [
      down(0, 100_000, '13'),
      up(1, 120_000, '13'),
      down(2, pressUs, '12'),
      up(3, pressUs + 20_000, '12'),
    ];
    const { replay } = await runRecordedPlay(json, inputs, ruleset);
    const simulated = simulateReplay(replay, { ruleset });

    expect(replay.results?.native?.maxCombo).toBe(simulated.maxCombo);
    if (ruleset === 'beatoraja') {
      expect(simulated.maxCombo).toBe(1);
    }
  });

  // An LN held to its tail settles at the tail, before a miss that falls due a moment later on another lane, so the
  // tail extends the combo before the miss breaks it.
  test.each(RULESETS)('%s: an LN tail settles before a later miss', async (ruleset) => {
    const json = longNoteChart(1);
    json.events.push(
      { measure: 1, channel: '12', position: [1, 2], value: '01' },
      { measure: 2, channel: '13', position: [1, 2000], value: '01' },
    );
    const inputs = [down(0, 1_000_000, '11'), down(1, 1_500_000, '12'), up(2, 1_520_000, '12'), up(3, 2_500_000, '11')];

    const { summary, replay } = await runRecordedPlay(json, inputs, ruleset);
    const simulated = simulateReplay(replay, { ruleset });

    expect(replay.results?.native?.maxCombo).toBe(simulated.maxCombo);
    expect(summary.gauge?.current).toBe(simulated.gauge.final);
    if (ruleset === 'lr2') {
      expect(simulated.maxCombo).toBe(2);
    }
  });

  // beatoraja's PMS rule lets a BAD early release wait 200 ms before it settles; pressing again inside it resumes the
  // long note. Every other release settles at once.
  test.each(RULESETS)('%s: a re-press inside the release margin agrees on both sides', async (ruleset) => {
    const json = longNoteChart(1);
    json.events.push({ measure: 4, channel: '22', position: [0, 1], value: '01' });
    const inputs = [down(0, 1_000_000, '11'), up(1, 1_500_000, '11'), down(2, 1_600_000, '11'), up(3, 2_000_000, '11')];

    const { summary, replay } = await runRecordedPlay(json, inputs, ruleset, { playVariant: '9' });
    const simulated = simulateReplay(replay, { ruleset });

    expect([summary.perfect, summary.bad, summary.poor, summary.emptyPoor]).toEqual([
      simulated.judge.pgreat,
      simulated.judge.bad,
      simulated.judge.poor,
      simulated.judge.emptyPoor,
    ]);
    if (ruleset === 'beatoraja') {
      expect([summary.perfect, summary.bad]).toEqual([1, 0]);
    }
  });

  // A release settles its long note at the release, before a press on another lane at the same instant.
  test.each(RULESETS)('%s: a release settles before a press at the same instant', async (ruleset) => {
    for (const lnMode of [1, 2] as const) {
      const json = longNoteChart(lnMode);
      json.events.push({ measure: 1, channel: '12', position: [1, 2], value: '01' });
      const inputs = [
        down(0, 1_000_000, '11'),
        up(1, 1_500_000, '11'),
        down(2, 1_500_000, '12'),
        up(3, 1_520_000, '12'),
      ];

      const { replay } = await runRecordedPlay(json, inputs, ruleset);
      const simulated = simulateReplay(replay, { ruleset });

      expect(replay.results?.native?.maxCombo, `#LNMODE ${lnMode}`).toBe(simulated.maxCombo);
    }
  });

  // A second key pressing a lane whose long note is held never judges the lane's next note: LR2 charges an empty POOR,
  // beatoraja and That-Which-Must-Not-Be-Named ignore the press.
  test.each(RULESETS)('%s: a second key on a held long note agrees on both sides', async (ruleset) => {
    const json = longNoteChart(1);
    json.events.push({ measure: 2, channel: '11', position: [1, 20], value: '01' });
    const inputs = [down(0, 1_000_000, '11'), down(1, 1_980_000, '11'), up(2, 2_000_000, '11'), up(3, 2_100_000, '11')];

    const { summary, replay } = await runRecordedPlay(json, inputs, ruleset);
    const simulated = simulateReplay(replay, { ruleset });

    expect([summary.perfect, summary.poor, summary.emptyPoor]).toEqual([
      simulated.judge.pgreat,
      simulated.judge.poor,
      simulated.judge.emptyPoor,
    ]);
    expect(summary.emptyPoor).toBe(ruleset === 'lr2' ? 1 : 0);
  });

  // LR2 judges an LN head again when a second key presses inside its BAD window.
  test.each(RULESETS)('%s: a second key near the LN head agrees on both sides', async (ruleset) => {
    const json = longNoteChart(1);
    const inputs = [down(0, 950_000, '11'), down(1, 1_005_000, '11'), up(2, 2_000_000, '11'), up(3, 2_010_000, '11')];

    const { summary, replay } = await runRecordedPlay(json, inputs, ruleset);
    const simulated = simulateReplay(replay, { ruleset });

    expect([summary.perfect, summary.great, summary.good, summary.bad]).toEqual([
      simulated.judge.pgreat,
      simulated.judge.great,
      simulated.judge.good,
      simulated.judge.bad,
    ]);
    if (ruleset === 'lr2') {
      expect(summary.perfect).toBe(1);
    }
  });

  // A lane held by two keys stays down while either is: releasing the first before a mine crosses still detonates it.
  test.each(RULESETS)('%s: a mine crossing a lane held by a second key agrees on both sides', async (ruleset) => {
    const json = chart([
      { measure: 1, channel: 'D1', position: [0, 1], value: '0A' },
      { measure: 3, channel: '11', position: [0, 1], value: '01' },
    ]);
    const key = (seq: number, timeUs: number, action: 'down' | 'up', token: string): ReplayInputEvent => ({
      seq,
      timeUs,
      action,
      channels: ['11'],
      tokens: [token],
    });
    const inputs = [
      key(0, 500_000, 'down', 'a'),
      key(1, 600_000, 'down', 'b'),
      key(2, 700_000, 'up', 'a'),
      key(3, 1_500_000, 'up', 'b'),
    ];

    const { summary, replay } = await runRecordedPlay(json, inputs, ruleset);
    const simulated = simulateReplay(replay, { ruleset });

    expect(summary.gauge?.current).toBe(simulated.gauge.final);
    expect(simulated.gauge.final).toBeLessThan(resolveRulesetConfig(replay, ruleset).gauge.initial);
  });

  // LR2 judges with the widths in force at the moment it judges: a press with the windows of the press, a release with
  // the windows of the release, even when `#EXRANK` narrows them before the note or the tail.
  test.each(RULESETS)('%s: #EXRANK changes apply at the instant of the press or release', async (ruleset) => {
    const press = chart([
      { measure: 1, channel: 'A0', position: [0, 1], value: '01' },
      { measure: 1, channel: '11', position: [1, 20], value: '01' },
    ]);
    press.bms.exRank['01'] = '25';
    const pressed = await runRecordedPlay(press, [down(0, 900_000, '11'), up(1, 940_000, '11')], ruleset);
    const pressSimulated = simulateReplay(pressed.replay, { ruleset });
    expect([pressed.summary.bad, pressed.summary.emptyPoor]).toEqual([
      pressSimulated.judge.bad,
      pressSimulated.judge.emptyPoor,
    ]);

    const release = longNoteChart(1);
    release.events.push({ measure: 1, channel: 'A0', position: [19, 20], value: '01' });
    release.bms.exRank['01'] = '25';
    const released = await runRecordedPlay(release, [down(0, 1_000_000, '11'), up(1, 1_920_000, '11')], ruleset);
    const releaseSimulated = simulateReplay(released.replay, { ruleset });
    expect([released.summary.perfect, released.summary.bad]).toEqual([
      releaseSimulated.judge.pgreat,
      releaseSimulated.judge.bad,
    ]);

    if (ruleset === 'lr2') {
      expect(pressed.summary.bad).toBe(1);
      expect(released.summary.perfect).toBe(1);
    }
  });

  // FREE ZONE has no judging effect in any reference (LR2 and beatoraja drop channel 17 from 7-key charts; That-Which-Must-Not-Be-Named never had
  // it): a scratch press there is an ordinary press, and charges an empty POOR when a scratch note is in reach.
  test.each(RULESETS)('%s: a scratch press in a FREE ZONE is judged as any other press', async (ruleset) => {
    const json = chart([
      { measure: 1, channel: '17', position: [0, 1], value: '01' },
      { measure: 1, channel: '16', position: [3, 4], value: '01' },
      { measure: 2, channel: '11', position: [0, 1], value: '01' },
      { measure: 2, channel: '18', position: [0, 1], value: '01' },
    ]);
    // A scratch key resolves to the scratch lane and its FREE ZONE alias, as the replay records it.
    const inputs = [down(0, 1_300_000, '16', '17'), up(1, 1_320_000, '16', '17')];

    const { summary, replay } = await runRecordedPlay(json, inputs, ruleset, { playVariant: '7' });
    const simulated = simulateReplay(replay, { ruleset });

    expect(summary.emptyPoor).toBe(simulated.judge.emptyPoor);
    expect(summary.emptyPoor).toBe(1);
  });

  // AUTO SCRATCH clears a charge note's head at the head and its tail at the tail, as beatoraja's autoplay does, so a
  // miss in between breaks the combo between them.
  test.each(RULESETS)('%s: AUTO SCRATCH clears a charge note head and tail at their own times', async (ruleset) => {
    const json = chart([
      { measure: 1, channel: '16', position: [0, 1], value: '01' },
      { measure: 3, channel: '16', position: [0, 1], value: 'AA' },
      { measure: 2, channel: '11', position: [0, 1], value: '01' },
      { measure: 4, channel: '11', position: [0, 1], value: '01' },
    ]);
    json.bms.lnObjs = ['AA'];
    json.bms.lnMode = 2;
    const inputs = [down(0, 4_000_000, '11'), up(1, 4_040_000, '11')];

    const { summary, replay } = await runRecordedPlay(json, inputs, ruleset, { autoScratch: true });
    const simulated = simulateReplay(replay, { ruleset });

    expect(summary.perfect).toBe(simulated.judge.pgreat);
    expect(replay.results?.native?.maxCombo).toBe(simulated.maxCombo);
    if (ruleset === 'beatoraja') {
      expect(simulated.maxCombo).toBe(2);
    }
  });

  // Hell Charge notes run beatoraja's 200 ms gauge ticks from the judged head until the tail passes, gaining while a
  // key is down on the lane (or after a GOOD-or-better tail) and draining otherwise; the tail is judged at the release.
  test.each(RULESETS)('%s: Hell Charge gauge ticks agree on both sides', async (ruleset) => {
    const json = chart([
      { measure: 0, channel: '12', position: [1, 2], value: '01' },
      { measure: 0, channel: '12', position: [3, 4], value: '01' },
      { measure: 1, channel: '11', position: [0, 1], value: '01' },
      { measure: 3, channel: '11', position: [0, 1], value: 'AA' },
    ]);
    json.bms.lnObjs = ['AA'];
    json.bms.lnMode = 3;
    const scenarios: Record<string, ReplayInputEvent[]> = {
      held: [down(0, 1_000_000, '11'), up(1, 3_000_000, '11')],
      released: [down(0, 1_000_000, '11'), up(1, 1_200_000, '11'), down(2, 1_400_000, '11'), up(3, 3_000_000, '11')],
      never: [],
      'released well': [down(0, 1_000_000, '11'), up(1, 2_950_000, '11')],
    };

    for (const [name, inputs] of Object.entries(scenarios)) {
      const { summary, replay } = await runRecordedPlay(json, inputs, ruleset, { gauge: 'HARD' });
      const simulated = simulateReplay(replay, { ruleset });

      expect([summary.perfect, summary.great, summary.good, summary.bad, summary.poor], name).toEqual([
        simulated.judge.pgreat,
        simulated.judge.great,
        simulated.judge.good,
        simulated.judge.bad,
        simulated.judge.poor,
      ]);
      expect(replay.results?.native?.maxCombo, name).toBe(simulated.maxCombo);
      expect(summary.gauge?.current, name).toBe(simulated.gauge.final);
    }
  });

  // An AUTO SCRATCH long note whose tail lies past an LR2 negative-BPM reversal is never cleared: the run ends with it
  // outstanding, which LR2 fails by emptying the gauge.
  test('lr2: an AUTO SCRATCH long note across a reversal agrees on both sides', async () => {
    const json = chart([
      { measure: 1, channel: '11', position: [0, 1], value: '01' },
      { measure: 1, channel: '16', position: [1, 2], value: '01' },
      { measure: 2, channel: '08', position: [0, 1], value: '02' },
      { measure: 3, channel: '16', position: [0, 1], value: 'AA' },
    ]);
    json.bms.lnObjs = ['AA'];
    json.resources.bpm['02'] = -240;
    const inputs = [down(0, 1_000_000, '11'), up(1, 1_040_000, '11')];

    const { summary, replay } = await runRecordedPlay(json, inputs, 'lr2', { autoScratch: true });
    const simulated = simulateReplay(replay, { ruleset: 'lr2' });

    expect(summary.gauge?.current).toBe(simulated.gauge.final);
    expect(summary.gauge?.current).toBe(0);
  });

  // LR2beta3 has no late mine window, including a press exactly at the reversal.
  test('lr2: a press at the reversal instant cannot detonate a passed mine', async () => {
    const json = chart([
      { measure: 1, channel: 'D1', position: [99, 100], value: '0A' },
      { measure: 2, channel: '08', position: [0, 1], value: '02' },
      { measure: 1, channel: '12', position: [0, 1], value: '01' },
    ]);
    json.resources.bpm['02'] = -240;
    const inputs = [down(0, 2_000_000, '11'), up(1, 2_010_000, '11')];

    const { summary, replay } = await runRecordedPlay(json, inputs, 'lr2');
    const simulated = simulateReplay(replay, { ruleset: 'lr2' });

    expect(summary.gauge?.current).toBe(simulated.gauge.final);
    expect(summary.minePoor ?? 0).toBe(0);
    expect(simulated.minePoor ?? 0).toBe(0);
  });

  // An ESC abort stops judging where the engine stopped; the rest of the chart is neither missed nor failed.
  test.each(RULESETS)('%s: an aborted play stops judging at the abort on both sides', async (ruleset) => {
    const json = chart(
      Array.from({ length: 12 }, (_, index) => ({
        measure: index + 1,
        channel: '11',
        position: [0, 1] as const,
        value: '01',
      })),
    );
    const { summary, replay } = await runRecordedPlay(
      json,
      [down(0, 1_000_000, '11'), up(1, 1_040_000, '11')],
      ruleset,
      {
        createInputRuntime: createScheduledInputRuntime([
          { delayMs: 300, command: { kind: 'interrupt', reason: 'escape' } },
        ]),
      },
    );
    const simulated = simulateReplay(replay, { ruleset });

    expect(replay.play.aborted).toBe(true);
    expect(replay.play.abortedAtUs).toBeGreaterThan(1_040_000);
    expect(summary.poor).toBeLessThan(11);
    expect(simulated.judge.poor).toBe(summary.poor);
    expect(simulated.judge.pgreat).toBe(summary.perfect);
    expect(simulated.gauge.final).toBe(summary.gauge?.current);
  });

  // LR2 misses an LN head once time moves past its late GOOD leg — before a plain note just ahead of it on the same
  // lane runs out of its late BAD leg.
  test('lr2: an LN head missed before the note ahead of it agrees on both sides', async () => {
    const json = chart(
      [
        { measure: 1, channel: '11', position: [0, 200], value: '01' },
        { measure: 1, channel: '11', position: [17, 200], value: '01' },
        { measure: 1, channel: '11', position: [100, 200], value: 'AA' },
        { measure: 2, channel: '12', position: [0, 1], value: '01' },
      ],
      1,
    );
    json.bms.lnObjs = ['AA'];
    // No input between the BAD press and the LN head's deadline, so the next advance spans that deadline.
    const inputs = [down(0, 1_091_000, '11'), down(1, 1_170_000, '12'), up(2, 1_180_000, '12'), up(3, 1_190_000, '11')];

    const { summary, replay } = await runRecordedPlay(json, inputs, 'lr2');
    const simulated = simulateReplay(replay, { ruleset: 'lr2' });

    expect(summary.bad).toBe(1);
    expect(summary.poor).toBe(2);
    expect(simulated.judge.bad).toBe(summary.bad);
    expect(simulated.judge.poor).toBe(summary.poor);
    expect(simulated.gauge.final).toBe(summary.gauge?.current);
  });

  // beatoraja holds an early release back only when the LN's judgment is BAD or worse AND early; a late BAD head
  // settles at once, so pressing again right away is a fresh press (here an empty POOR on the note ahead).
  test('beatoraja: an LN with a late BAD head settles its release at once on both sides', async () => {
    const json = chart([
      { measure: 1, channel: '13', position: [0, 1], value: '01' },
      { measure: 1, channel: '13', position: [1, 2], value: 'AA' },
      { measure: 1, channel: '13', position: [4, 5], value: '01' },
    ]);
    json.bms.lnObjs = ['AA'];
    const inputs = [down(0, 1_150_000, '13'), up(1, 1_490_000, '13'), down(2, 1_490_001, '13'), up(3, 1_600_000, '13')];

    const { summary, replay } = await runRecordedPlay(json, inputs, 'beatoraja', { playVariant: '9' });
    const simulated = simulateReplay(replay, { ruleset: 'beatoraja' });

    expect(summary.bad).toBe(1);
    expect(summary.emptyPoor).toBe(1);
    expect(simulated.judge.emptyPoor).toBe(summary.emptyPoor);
    expect(summary.gauge).toMatchObject({ max: 120, current: 16 });
    expect(simulated.gauge.final).toBe((summary.gauge!.current / summary.gauge!.max) * 100);
  });

  // beatoraja ticks the Hell Charge note crossing the judge line. Pressing the lane's next HCN early, before the one
  // ahead of it is missed, must not let that late miss take over the lane's ticks.
  test('beatoraja: an HCN pressed early keeps its ticks when the one ahead is missed', async () => {
    const json = chart(
      [
        { measure: 1, channel: '11', position: [0, 12], value: '01' },
        { measure: 1, channel: '11', position: [1, 12], value: 'AA' },
        { measure: 1, channel: '11', position: [2, 12], value: '01' },
        { measure: 2, channel: '11', position: [0, 1], value: 'AA' },
        // Plain notes, never pressed, take the gauge well below its ceiling first.
        ...Array.from({ length: 4 }, (_, index) => ({
          measure: 0,
          channel: '12',
          position: [index, 4] as const,
          value: '01',
        })),
      ],
      3,
    );
    json.bms.lnObjs = ['AA'];
    json.bms.lnMode = 3;
    // A low #TOTAL keeps each judgment's gauge step small, so the ticks show.
    json.metadata.total = 20;
    // The first HCN (1.0-1.083 s) is never pressed. The press lands after its tail but before its miss deadline, and
    // judges the second (1.167-2.0 s) early, so the first one's miss comes after the second started ticking.
    const inputs = [down(0, 1_120_000, '11'), up(1, 2_000_000, '11')];

    const { summary, replay } = await runRecordedPlay(json, inputs, 'beatoraja');
    const simulated = simulateReplay(replay, { ruleset: 'beatoraja' });

    // The missed HCN's head and its tail, and the plain notes.
    expect(summary.poor).toBe(6);
    expect(simulated.gauge.final).toBe(summary.gauge?.current);
    expect(simulated.judge).toMatchObject({ poor: summary.poor, good: summary.good, great: summary.great });
  });

  // At BPM 177 the note sits at 1.3559322… s, recorded as 1 355 932 µs. A press exactly 200 000 µs earlier is on LR2's
  // BAD edge, though the float seconds put it 0.2000002 s away: the press scan must reach it in whole microseconds.
  test('lr2: a press on the BAD edge in whole microseconds judges the note on both sides', async () => {
    const json = chart([{ measure: 1, channel: '11', position: [0, 1], value: '01' }]);
    json.metadata.bpm = 177;
    const inputs = [down(0, 1_155_932, '11'), up(1, 1_200_000, '11')];

    const { summary, replay } = await runRecordedPlay(json, inputs, 'lr2');
    const simulated = simulateReplay(replay, { ruleset: 'lr2' });

    expect(replay.chart.notes[0]!.timeUs).toBe(1_355_932);
    expect(summary.bad).toBe(1);
    expect(summary.emptyPoor).toBe(0);
    expect(simulated.judge).toMatchObject({ bad: summary.bad, poor: summary.poor, emptyPoor: summary.emptyPoor });
  });

  // A play that ends on failure stops scoring at the judgment that emptied its survival gauge; a press after it counts
  // for nothing on either side.
  test.each(RULESETS)('%s: a play ending on failure stops scoring on both sides', async (ruleset) => {
    const json = chart(
      Array.from({ length: 24 }, (_, index) => ({
        measure: 1 + Math.floor(index / 8),
        channel: '11',
        position: [index % 8, 8] as const,
        value: '01',
      })),
    );
    // Every note missed until the last one, pressed on time.
    const inputs = [down(0, 3_875_000, '11'), up(1, 3_900_000, '11')];

    const { summary, replay } = await runRecordedPlay(json, inputs, ruleset, { gauge: 'HARD' });
    const simulated = simulateReplay(replay, { ruleset });

    expect(replay.play.endOnFailure).toBe(true);
    expect(summary.gauge?.failedMidPlay).toBe(true);
    expect(summary.perfect).toBe(0);
    expect(summary.poor).toBeLessThan(24);
    expect(simulated.judge).toMatchObject({ pgreat: summary.perfect, poor: summary.poor });
    expect(simulated.gauge.final).toBe(summary.gauge?.current);
    // A log without the flag (or a re-simulation told otherwise) keeps judging to the end: every note gets a verdict.
    const kept = simulateReplay(replay, { ruleset, endOnFailure: false }).judge;
    expect(kept.pgreat + kept.great + kept.good + kept.bad + kept.poor).toBe(24);
  });

  // A course stage starts from the state the previous stage left: its gauge value and the course-wide combo.
  test.each(RULESETS)('%s: a course stage carries in its gauge and combo on both sides', async (ruleset) => {
    const json = chart([
      { measure: 1, channel: '11', position: [0, 4], value: '01' },
      { measure: 1, channel: '12', position: [1, 4], value: '01' },
      { measure: 1, channel: '13', position: [2, 4], value: '01' },
      { measure: 2, channel: '14', position: [0, 1], value: '01' },
    ]);
    const inputs = [
      down(0, 1_000_000, '11'),
      up(1, 1_050_000, '11'),
      down(2, 1_250_000, '12'),
      up(3, 1_300_000, '12'),
      down(4, 2_000_000, '14'),
      up(5, 2_050_000, '14'),
    ];
    const course = { kind: 'grade' as const, carryIn: { gauge: 41.5, combo: 7, maxCombo: 9 } };

    const { summary, replay } = await runRecordedPlay(json, inputs, ruleset, { course });
    const simulated = simulateReplay(replay, { ruleset });

    expect(replay.play.course).toEqual(course);
    expect(summary.gauge?.initial).toBe(41.5);
    // Two hits extend the carried combo to 9, the missed third note breaks it, the fourth starts it again.
    expect(summary.course).toEqual({ combo: 1, maxCombo: 9 });
    expect(simulated.course).toEqual(summary.course);
    expect(replay.results?.native?.course).toEqual(summary.course);
    expect(simulated.gauge).toMatchObject({ type: summary.gauge?.type, final: summary.gauge?.current });
  });

  // beatoraja's NO_GREAT: GREAT and GOOD take the PGREAT window, so a press just outside PGREAT is a BAD.
  test.each(RULESETS)('%s: a no-great course stage judges outside PGREAT as BAD on both sides', async (ruleset) => {
    const json = chart([{ measure: 1, channel: '11', position: [0, 1], value: '01' }]);
    const inputs = [down(0, 1_040_000, '11'), up(1, 1_090_000, '11')];

    const { summary, replay } = await runRecordedPlay(json, inputs, ruleset, {
      course: { kind: 'grade', judge: 'no-great' },
    });
    const simulated = simulateReplay(replay, { ruleset });

    expect(summary.bad).toBe(1);
    expect(simulated.judge.bad).toBe(1);
  });

  test.each(RULESETS)('%s: never touching a long note agrees on both sides', async (ruleset) => {
    const json = longNoteChart(2);

    const { summary, replay } = await runRecordedPlay(json, [], ruleset);
    const simulated = simulateReplay(replay, { ruleset });

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

    const { summary, replay } = await runRecordedPlay(json, inputs, ruleset);
    const simulated = simulateReplay(replay, { ruleset });

    expect(summary.emptyPoor).toBe(1);
    expect(summary.emptyPoor).toBe(simulated.judge.emptyPoor);
    // The empty POOR left the note alone, so the second press still scores it.
    expect(summary.perfect).toBe(1);
    expect(summary.perfect).toBe(simulated.judge.pgreat);
    expect(summary.poor).toBe(simulated.judge.poor);
  });

  // LR2's DEATH gauge charges nothing for an empty POOR (OpenLR2 LR2f.cpp L27673-L27680), so a dozen of them leave
  // the run alive and the gauge full on both sides.
  test('lr2: empty POORs leave a DEATH gauge untouched on both sides', async () => {
    const json = chart([{ measure: 2, channel: '11', position: [0, 1], value: '01' }]);
    const inputs: ReplayInputEvent[] = [];
    for (let index = 0; index < 12; index += 1) {
      const timeUs = 1_100_000 + index * 50_000;
      inputs.push(down(index * 2, timeUs, '11'), up(index * 2 + 1, timeUs + 20_000, '11'));
    }
    inputs.push(down(24, 2_000_000, '11'), up(25, 2_050_000, '11'));

    const { summary, replay } = await runRecordedPlay(json, inputs, 'lr2', { gauge: 'DEATH' });
    const simulated = simulateReplay(replay, { ruleset: 'lr2' });

    expect(summary.emptyPoor).toBe(12);
    expect(simulated.judge.emptyPoor).toBe(12);
    expect(summary.perfect).toBe(1);
    expect(simulated.judge.pgreat).toBe(1);
    expect(summary.gauge).toMatchObject({ type: 'DEATH', current: 100, cleared: true, failedMidPlay: false });
    expect(simulated.gauge).toMatchObject({ type: 'DEATH', final: 100, cleared: true });
  });

  test('lr2: the empty POOR window is early-only', async () => {
    // LR2's miss window is `{0, 1 s}` — a press up to a second BEFORE a note charges one, a press after never does.
    const json = chart([{ measure: 2, channel: '11', position: [0, 1], value: '01' }]);

    const before = await runRecordedPlay(json, [down(0, 1_600_000, '11')], 'lr2');
    const after = await runRecordedPlay(json, [down(0, 2_400_000, '11')], 'lr2');

    expect(before.summary.emptyPoor).toBe(1);
    expect(after.summary.emptyPoor).toBe(0);
  });

  test('lr2: a negative-BPM reversal chart records its cutoff and re-simulates to the same judges', async () => {
    // LR2 negative-BPM reversal (#134). BPM 240 → measure = 1 s; `#BPM02 = -240` fires via channel 08 at 2 s.
    // The 1 s note misses normally, the 3 s note sits behind the frozen judge clock and ends the run unjudged.
    // The recorded replay must carry the reversal instant so the simulator applies the same cutoff instead of
    // sweeping the post-reversal note into a POOR.
    const json = chart([
      { measure: 1, channel: '11', position: [0, 1], value: '01' },
      { measure: 2, channel: '08', position: [0, 1], value: '02' },
      { measure: 3, channel: '11', position: [0, 1], value: '01' },
    ]);
    json.resources.bpm['02'] = -240;

    const { summary, replay } = await runRecordedPlay(json, [], 'lr2');
    const simulated = simulateReplay(replay, { ruleset: 'lr2' });

    expect(replay.chart.reversalTimeUs).toBe(2_000_000);
    // Live run: exactly one POOR (the pre-reversal note) and nothing else.
    expect(summary.poor).toBe(1);
    expect(summary.perfect + summary.great + summary.good + summary.bad).toBe(0);
    expect(summary.total).toBe(2);
    // The simulator reaches the same verdicts from the recorded log.
    expect([summary.perfect, summary.great, summary.good, summary.bad, summary.poor]).toEqual([
      simulated.judge.pgreat,
      simulated.judge.great,
      simulated.judge.good,
      simulated.judge.bad,
      simulated.judge.poor,
    ]);
    expect(summary.exScore).toBe(simulated.exScore);
  });

  test('lr2: past a negative-BPM reversal presses judge on the mirrored clock, like LR2 (engine and simulator)', async () => {
    // LR2 keeps judging presses after the reversal R on the mirrored clock t' = 2R - now (OpenLR2 `LR2f.cpp:12624`,
    // LR2body.exe 0x42c25b) with no miss sweep (t' <= R). Chart (BPM 240, rank NORMAL; see `reversalScenarioChart`):
    // a pre-R STOP, an LN 1.75 s → 3.25 s spanning R = 2.25 s, notes at R - 50 ms (11) and R + 100 ms (13), an
    // empty-POOR reference note at R + 0.5 s (14), the reversal (-60), a BGM on the reversal tick, a post-R STOP, a
    // later BPM 240 change, and a far note at 8.25 s (11).
    const json = reversalScenarioChart();
    const inputs = [
      down(0, 1_750_000, '12'), // LN head, on time
      down(1, 2_270_000, '13'), // t' = 2.23 → the R + 100 ms note is 120 ms early: BAD
      up(2, 2_280_000, '13'),
      down(3, 2_300_000, '11'), // t' = 2.20 → the R - 50 ms note dead on: PGREAT
      up(4, 2_320_000, '11'),
      down(5, 2_550_000, '14'), // t' = 1.95 → the lane's note is 0.8 s ahead: empty POOR (LR2's 1 s reach)
      up(6, 2_560_000, '14'),
      up(7, 2_750_000, '12'), // t' = 1.75 → released 1.5 s before the LN tail: BAD (LR2f.cpp:7613-7616)
      down(8, 3_250_000, '14'), // t' = 1.25 → the note is 1.5 s ahead, outside the reach: nothing
      up(9, 3_260_000, '14'),
    ];

    const triggered: string[] = [];
    let replay: BeMusicReplay | undefined;
    const summary = await manualPlay(json, {
      speed: 16,
      leadInMs: 0,
      audio: true,
      tui: false,
      judgeRuleset: 'lr2',
      replayInputs: inputs,
      recordReplay: {},
      onReplayRecorded: (recorded) => {
        replay = recorded;
      },
      createAudioSession: async () => ({
        backendLabel: 'recording-audio',
        chartStartDelayMs: 0,
        start: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        finish: async () => undefined,
        dispose: async () => undefined,
        triggerEvent: (event) => {
          triggered.push(`${event.channel}:${event.value}`);
        },
        stopChannel: () => undefined,
      }),
    });
    const simulated = simulateReplay(replay!, { ruleset: 'lr2' });

    // The BGM on the reversal tick sounded (op 1 precedes the negative BPM's op 8).
    expect(triggered).toContain('01:03');
    // Both notes near R were hit, the spanning LN BADs on its early release, and the empty POOR fired once.
    expect(summary.perfect).toBe(1);
    expect(summary.bad).toBe(2);
    expect(summary.emptyPoor).toBe(1);
    // No miss sweep past R: the R + 0.5 s reference note and the far note are never POORed.
    expect(summary.poor).toBe(0);
    expect(summary.great + summary.good).toBe(0);
    // The simulator re-derives the same verdicts from the recorded log.
    expect(simulated.judge).toEqual({
      pgreat: summary.perfect,
      great: summary.great,
      good: summary.good,
      bad: summary.bad,
      poor: summary.poor,
      emptyPoor: summary.emptyPoor,
    });
    expect(simulated.exScore).toBe(summary.exScore);
    // Scorable notes were left unjudged past R, so the run is FAILED with the gauge at 0 — LR2 zeroes HP on leaving
    // a play with notes outstanding (OpenLR2 `LR2f.cpp:12980-12982`) — on both sides.
    expect(summary.gauge?.current).toBe(0);
    expect(summary.gauge?.cleared).toBe(false);
    expect(simulated.gauge.final).toBe(0);
    expect(simulated.gauge.cleared).toBe(false);
  });

  test('lr2: a reversal run that judged every note before the reversal keeps its clear', async () => {
    const json = chart([
      { measure: 1, channel: '11', position: [0, 1], value: '01' },
      { measure: 2, channel: '08', position: [0, 1], value: '02' },
    ]);
    json.resources.bpm['02'] = -240;

    const { summary, replay } = await runRecordedPlay(json, [down(0, 1_000_000, '11'), up(1, 1_050_000, '11')], 'lr2');
    const simulated = simulateReplay(replay, { ruleset: 'lr2' });

    expect(summary.perfect).toBe(1);
    expect(summary.gauge?.cleared).toBe(true);
    expect(simulated.gauge.cleared).toBe(true);
    expect(simulated.gauge.final).toBe(summary.gauge?.current);
  });

  test.each(RULESETS)('%s: an untouched chart misses every note on both sides', async (ruleset) => {
    const json = chart([
      { measure: 1, channel: '11', position: [0, 1], value: '01' },
      { measure: 1, channel: '12', position: [1, 2], value: '01' },
      { measure: 2, channel: '19', position: [0, 1], value: '01' },
    ]);

    const { summary, replay } = await runRecordedPlay(json, [], ruleset);
    const simulated = simulateReplay(replay, { ruleset });

    expect(summary.poor).toBe(3);
    expect(simulated.judge.poor).toBe(3);
    expect(summary.exScore).toBe(0);
    expect(simulated.exScore).toBe(0);
  });
});

for (const assistedSide of ['1P', '2P'] as const) {
  test.each(RULESETS)(`%s: DP AUTO SCRATCH assists only ${assistedSide} in live play and replay`, async (ruleset) => {
    const json = chart([
      { measure: 1, channel: '16', position: [0, 1], value: '01' },
      { measure: 1, channel: '26', position: [0, 1], value: '01' },
    ]);
    const settings = {
      autoScratch1P: assistedSide === '1P',
      autoScratch2P: assistedSide === '2P',
      playVariant: '14' as const,
    };
    const { summary, replay } = await runRecordedPlay(json, [], ruleset, settings);
    expect([summary.perfect, summary.poor]).toEqual([1, 1]);
    expect(replay.play.autoScratch1P).toBe(settings.autoScratch1P);
    expect(replay.play.autoScratch2P).toBe(settings.autoScratch2P);
    const simulated = simulateReplay(replay, { ruleset });
    expect([simulated.judge.pgreat, simulated.judge.poor]).toEqual([1, 1]);
    const manualChannel = assistedSide === '1P' ? '26' : '16';
    const manual = await runRecordedPlay(
      json,
      [down(0, 1_000_000, manualChannel), up(1, 1_020_000, manualChannel)],
      ruleset,
      settings,
    );
    expect([manual.summary.perfect, manual.summary.poor]).toEqual([2, 0]);
    expect(simulateReplay(manual.replay, { ruleset }).judge.pgreat).toBe(2);
  });
}

test('DP scratch HCNs on the unassisted side remain manual', async () => {
  const json = chart([
    { measure: 1, channel: '16', position: [0, 1], value: '01' },
    { measure: 2, channel: '16', position: [0, 1], value: 'AA' },
    { measure: 1, channel: '26', position: [0, 1], value: '01' },
    { measure: 2, channel: '26', position: [0, 1], value: 'AA' },
  ]);
  json.bms.lnObjs = ['AA'];
  json.bms.lnMode = 3;
  const { summary, replay } = await runRecordedPlay(json, [], 'beatoraja', {
    autoScratch1P: true,
    autoScratch2P: false,
    playVariant: '14',
  });
  const simulated = simulateReplay(replay, { ruleset: 'beatoraja' });
  expect(summary.perfect).toBeGreaterThan(0);
  expect(summary.poor).toBeGreaterThan(0);
  expect([summary.perfect, summary.poor]).toEqual([simulated.judge.pgreat, simulated.judge.poor]);
});

for (const longNoteModifier of ['LEGACY', 'REMOVE'] as const) {
  test(`${longNoteModifier} records effective head-only notes for deterministic simulation`, async () => {
    const run = await runRecordedPlay(longNoteChart(2), [down(0, 1_000_000, '11')], 'beatoraja', { longNoteModifier });
    expect(run.replay.play.longNoteModifier).toBe(longNoteModifier);
    expect(run.replay.chart.notes.every((note) => note.type === 'normal' && note.endTimeUs === undefined)).toBe(true);
    expect(simulateReplay(run.replay, { ruleset: 'beatoraja' }).judge).toEqual(run.replay.results!.native!.judge);
  });
}

test('A-SCR & LEGACY NOTE retains both operations in the recorded effective setup', async () => {
  const json = longNoteChart(2);
  json.events = json.events.filter((event) => event.channel === '11').map((event) => ({ ...event, channel: '16' }));
  const run = await runRecordedPlay(json, [], '____', {
    longNoteModifier: 'LEGACY',
    autoScratch1P: true,
    autoScratch2P: true,
  });
  expect(run.replay.play).toMatchObject({ longNoteModifier: 'LEGACY', autoScratch1P: true, autoScratch2P: true });
  expect(run.replay.chart.notes).toEqual([expect.objectContaining({ type: 'normal', channel: '16' })]);
  expect(run.replay.results!.native!.judge).toMatchObject({ pgreat: 1, poor: 0 });
  expect(simulateReplay(run.replay, { ruleset: '____' }).judge).toEqual(run.replay.results!.native!.judge);
});

for (const judgeAlgorithm of ['combo', 'duration', 'lowest'] as const) {
  test(`beatoraja ${judgeAlgorithm} selection is applied live and restored by replay simulation`, async () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 240;
    json.metadata.rank = 2;
    json.events = [
      { measure: 1, channel: '11', position: [0, 1], value: '01' },
      { measure: 1, channel: '11', position: [4, 25], value: '01' },
    ];
    const run = await runRecordedPlay(json, [down(0, 1_120_000, '11')], 'beatoraja', { judgeAlgorithm });
    expect(run.replay.play.judgeAlgorithm).toBe(judgeAlgorithm);
    expect(run.replay.results!.native!.judge).toMatchObject(
      judgeAlgorithm === 'lowest' ? { bad: 1, great: 0, poor: 1 } : { bad: 0, great: 1, poor: 1 },
    );
    expect(simulateReplay(run.replay, { ruleset: 'beatoraja' }).judge).toEqual(run.replay.results!.native!.judge);
  });
}

for (const containsMine of [false, true]) {
  test(`mine REMOVE records actual changes and reproduces a mine-free judgment stream (${containsMine})`, async () => {
    const json = chart([
      ...(containsMine ? [{ measure: 1, channel: 'D1', position: [0, 1] as const, value: '0A' }] : []),
      { measure: 2, channel: '12', position: [0, 1], value: '01' },
    ]);
    const run = await runRecordedPlay(json, [down(0, 500_000, '11')], 'beatoraja', { mineModifier: 'REMOVE' });
    expect(run.replay.play).toMatchObject({ mineModifier: 'REMOVE', mineModifierChangeCount: containsMine ? 1 : 0 });
    expect(run.replay.chart.notes.some((note) => note.type === 'mine')).toBe(false);
    expect(run.summary.minePoor ?? 0).toBe(0);
    expect(simulateReplay(run.replay, { ruleset: 'beatoraja' }).judge).toEqual(run.replay.results!.native!.judge);
  });
}

test('mine REMOVE also clears a host-prepared shared mine array before judging', async () => {
  const json = chart([
    { measure: 1, channel: 'D1', position: [0, 1], value: '0A' },
    { measure: 2, channel: '12', position: [0, 1], value: '01' },
  ]);
  const preparedChart = preparePlaybackChart(resolveChart(json));
  const mines = preparedChart.landmineNotes;
  const run = await runRecordedPlay(json, [down(0, 500_000, '11')], 'beatoraja', {
    mineModifier: 'REMOVE',
    preparedChart,
  });
  expect(preparedChart.landmineNotes).toBe(mines);
  expect(mines).toEqual([]);
  expect(run.replay.play.mineModifierChangeCount).toBe(1);
  expect(run.summary.minePoor ?? 0).toBe(0);
});

test.each(['ADD_RANDOM', 'ADD_NEAR', 'ADD_BLANK'] as const)(
  '%s silent mines retain their damage and judgments through serialized replay simulation',
  async (mineModifier) => {
    const json = chart([{ measure: 2, channel: '12', position: [0, 1], value: '01' }]);
    const preparedChart = preparePlaybackChart(resolveChart(json), { mineModifier }, 0, () => 0.99);
    const run = await runRecordedPlay(json, [down(0, 500_000, '11'), up(1, 2_500_000, '11')], 'beatoraja', {
      mineModifier,
      preparedChart,
    });
    const replay = parseReplay(serializeReplay(run.replay));
    expect(replay.play.mineModifierChangeCount).toBeGreaterThan(0);
    expect(
      replay.chart.notes.filter((note) => note.type === 'mine').every((note) => note.silent && note.damage === 10),
    ).toBe(true);
    expect(run.summary.minePoor).toBeGreaterThan(0);
    expect(simulateReplay(replay, { ruleset: 'beatoraja' }).judge).toEqual(replay.results!.native!.judge);
  },
);

test.each(['NONE', 'CONTINUE'] as const)(
  'beatoraja gauge %s preserves the dead-gauge outcome with matching replay judgments',
  async (gaugeAutoShift) => {
    const json = chart([
      { measure: 1, channel: '11', position: [0, 1], value: '01' },
      { measure: 2, channel: '12', position: [0, 1], value: '01' },
    ]);
    const run = await runRecordedPlay(json, [down(0, 2_000_000, '12')], 'beatoraja', {
      gauge: 'DEATH',
      gaugeAutoShift,
    });
    const replay = parseReplay(serializeReplay(run.replay));
    expect(replay.play.gaugeAutoShift).toBe(gaugeAutoShift);
    expect(replay.play.endOnFailure === true).toBe(gaugeAutoShift === 'NONE');
    expect(run.summary.gauge).toMatchObject({ type: 'HAZARD', current: 0, cleared: false, failedMidPlay: true });
    expect(run.summary.poor).toBe(1);
    expect(run.summary.perfect).toBe(gaugeAutoShift === 'CONTINUE' ? 1 : 0);
    const simulated = simulateReplay(replay, { ruleset: 'beatoraja' });
    expect(simulated.judge).toEqual(replay.results!.native!.judge);
    expect(simulated.gauge).toMatchObject({ type: 'HAZARD', final: 0, cleared: false, failedMidPlay: true });
  },
);

test.each([
  ['ADD_LN', 1],
  ['ADD_CN', 2],
  ['ADD_HCN', 3],
  ['ADD_ALL', 1],
] as const)('%s records its exact endpoint and retains live/simulated judgments', async (longNoteModifier, lnMode) => {
  const json = chart([
    { measure: 1, channel: '11', position: [0, 1], value: '01' },
    { measure: 1, channel: '01', position: [1, 2], value: '02' },
    { measure: 2, channel: '12', position: [0, 1], value: '01' },
  ]);
  json.bms.lnMode = 3; // Generated LN must override the chart default HCN mode.
  const preparedChart = preparePlaybackChart(resolveChart(json), { longNoteModifier, longNoteRate: 0.375 }, 0, () => 0);
  const run = await runRecordedPlay(
    json,
    [down(0, 1_000_000, '11'), up(1, 1_500_000, '11'), down(2, 2_000_000, '12')],
    'beatoraja',
    { longNoteModifier, longNoteRate: 0.375, preparedChart },
  );
  const replay = parseReplay(serializeReplay(run.replay));
  expect(replay.play).toMatchObject({
    longNoteModifier,
    longNoteRate: 0.375,
    longNoteModifierChangeCount: 1,
  });
  expect(replay.chart.notes.find((note) => note.generatedLongNote)).toMatchObject({
    channel: '11',
    timeUs: 1_000_000,
    endTimeUs: 1_500_000,
    lnMode,
  });
  expect(run.summary.perfect).toBe(lnMode === 1 ? 2 : 3);
  expect(run.summary.total).toBe(lnMode === 1 ? 2 : 3);
  expect(replay.results!.native!.noteCount).toBe(lnMode === 1 ? 2 : 3);
  expect(simulateReplay(replay, { ruleset: 'beatoraja' }).judge).toEqual(replay.results!.native!.judge);
});

test('generated HCNs gain hold ticks in addition to the same CN head/tail judgments', async () => {
  const json = chart([
    { measure: 1, channel: '11', position: [0, 1], value: '01' },
    { measure: 1, channel: '01', position: [1, 2], value: '02' },
    { measure: 2, channel: '12', position: [0, 1], value: '01' },
  ]);
  json.metadata.total = 20;
  const results = [];
  for (const longNoteModifier of ['ADD_CN', 'ADD_HCN'] as const) {
    const preparedChart = preparePlaybackChart(resolveChart(json), { longNoteModifier }, 0, () => 0);
    const run = await runRecordedPlay(
      json,
      [down(0, 1_000_000, '11'), up(1, 1_500_000, '11'), down(2, 2_000_000, '12')],
      'beatoraja',
      { longNoteModifier, preparedChart },
    );
    const simulated = simulateReplay(parseReplay(serializeReplay(run.replay)), { ruleset: 'beatoraja' });
    expect(run.summary.perfect).toBe(3);
    expect(simulated.gauge.final).toBe(run.summary.gauge?.current);
    results.push(run.summary.gauge!.current);
  }
  expect(results[1]).toBeGreaterThan(results[0]!);
});

test('mixed generated types contribute their individual head/tail counts and reproduce the same gauge', async () => {
  const json = chart([
    ...['11', '12', '13'].map((channel) => ({ measure: 1, channel, position: [0, 1] as const, value: '01' })),
    { measure: 1, channel: '01', position: [1, 2], value: '02' },
    { measure: 2, channel: '14', position: [0, 1], value: '01' },
  ]);
  json.metadata.total = 20;
  const draws = [0, 0, 0, 1 / 3, 0, 2 / 3];
  const preparedChart = preparePlaybackChart(resolveChart(json), { longNoteModifier: 'ADD_ALL' }, 0, () =>
    draws.shift()!,
  );
  const run = await runRecordedPlay(
    json,
    [down(0, 1_000_000, '11', '12', '13'), up(1, 1_500_000, '11', '12', '13'), down(2, 2_000_000, '14')],
    'beatoraja',
    { longNoteModifier: 'ADD_ALL', preparedChart },
  );
  const replay = parseReplay(serializeReplay(run.replay));
  expect(replay.chart.notes.filter((note) => note.generatedLongNote).map((note) => note.lnMode)).toEqual([1, 2, 3]);
  expect(run.summary.perfect).toBe(6);
  expect(run.summary.total).toBe(6);
  const simulated = simulateReplay(replay, { ruleset: 'beatoraja' });
  expect(simulated.judge).toEqual(replay.results!.native!.judge);
  expect(simulated.gauge.final).toBe(run.summary.gauge?.current);
});

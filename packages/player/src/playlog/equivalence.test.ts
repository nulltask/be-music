import { createEmptyJson, type BeMusicJson } from '@be-music/json';
import { describe, expect, test } from 'vite-plus/test';
import { manualPlay } from '../index.ts';
import type { PlayerOptions, PlayerSummary } from '../core/engine.ts';
import { resolveRulesetConfig, simulatePlaylog } from './simulate.ts';
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
  extra: PlayerOptions = {},
): Promise<ReplayRun> {
  let playlog: BeMusicPlaylog | undefined;
  const summary = await manualPlay(json, {
    ...extra,
    speed: 16,
    leadInMs: 0,
    audio: false,
    tui: false,
    judgeRuleset: ruleset,
    replayInputs: inputs,
    recordPlaylog: extra.recordPlaylog ?? {},
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

/**
 * The negative-BPM reversal scenario: BPM 240, a pre-reversal STOP (1.0 s, 0.25 s long), an LN on 12 from 1.75 s to
 * 3.25 s, a note on 11 at 2.2 s (R - 50 ms), the reversal `#BPM02 -60` at R = 2.25 s with a BGM on the same tick, a
 * note on 13 at 2.35 s (R + 100 ms), a note on 14 at 2.75 s, a post-reversal STOP (4.25 s, 1 s long), BPM 240 again
 * at 7.25 s, and a far note on 11 at 8.25 s.
 */
function reversalScenarioChart(): BeMusicJson {
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

  // An LN let go just before its tail — e.g. a hand freeing the key for a tap that sits right on the tail — is not a
  // BAD: LR2 keeps the head judgment inside the GOOD window, beatoraja takes the worse of head and release.
  test.each(RULESETS)('%s: releasing an LN just before its tail agrees on both sides', async (ruleset) => {
    const json = longNoteChart(1);

    for (const earlyUs of [1, 50_000]) {
      const inputs = [down(0, 1_000_000, '11'), up(1, 2_000_000 - earlyUs, '11')];
      const { summary, playlog } = await replay(json, inputs, ruleset);
      const simulated = simulatePlaylog(playlog, { ruleset });

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

  // A press exactly on a window edge: the playlog clock is whole microseconds, and a note at BPM 140 sits at a time
  // whose float seconds do not subtract to an exact delta, so the engine must judge the rounded delta as the
  // simulator does instead of landing a hair outside the edge.
  test.each(RULESETS)('%s: a press on a window edge agrees on both sides', async (ruleset) => {
    const json = chart([{ measure: 1, channel: '11', position: [0, 1], value: '01' }]);
    json.metadata.bpm = 140;
    const probe = await replay(json, [], ruleset);
    const noteUs = probe.playlog.chart.notes[0]!.timeUs;
    const [lateEdgeUs, earlyEdgeUs] = resolveRulesetConfig(probe.playlog, ruleset).windows.note.judges[2];

    for (const pressUs of [noteUs - lateEdgeUs, noteUs - earlyEdgeUs]) {
      const { summary, playlog } = await replay(json, [down(0, pressUs, '11'), up(1, pressUs + 40_000, '11')], ruleset);
      const simulated = simulatePlaylog(playlog, { ruleset });

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
    const probe = await replay(json, [down(0, 0, '19')], ruleset);
    const head = probe.playlog.chart.notes.find((note) => note.channel === '11')!;
    const endWindows = resolveRulesetConfig(probe.playlog, ruleset).windows.longNoteEnd.judges;

    for (const [, earlyEdgeUs] of endWindows) {
      const inputs = [down(0, head.timeUs, '11'), up(1, head.endTimeUs! - earlyEdgeUs, '11')];
      const { summary, playlog } = await replay(json, inputs, ruleset);
      const simulated = simulatePlaylog(playlog, { ruleset });

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

    const { summary, playlog } = await replay(json, inputs, ruleset);
    const simulated = simulatePlaylog(playlog, { ruleset });

    expect(summary.emptyPoor).toBe(simulated.judge.emptyPoor);
    expect(playlog.results?.native?.maxCombo).toBe(simulated.maxCombo);
    if (ruleset === 'beatoraja') {
      expect(simulated.maxCombo).toBe(2);
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

      const { summary, playlog } = await replay(json, inputs, ruleset, { autoScratch: true, playVariant });
      const simulated = simulatePlaylog(playlog, { ruleset });

      expect([summary.perfect, summary.poor], playVariant).toEqual([simulated.judge.pgreat, simulated.judge.poor]);
      expect(summary.perfect, playVariant).toBe(1);
    }
  });

  // The play log must record the gauge the engine ran, whichever option the host set it through.
  test.each(RULESETS)('%s: the recorded gauge is the gauge the engine ran', async (ruleset) => {
    const json = chart([
      { measure: 1, channel: '11', position: [0, 1], value: '01' },
      { measure: 2, channel: '11', position: [0, 1], value: '01' },
    ]);
    const inputs = [down(0, 1_000_000, '11'), up(1, 1_040_000, '11')];

    for (const extra of [{ gauge: 'HARD' }, { recordPlaylog: { gauge: 'HARD' } }] as const) {
      const { summary, playlog } = await replay(json, inputs, ruleset, extra);
      const simulated = simulatePlaylog(playlog, { ruleset });

      expect(playlog.play.gauge, JSON.stringify(extra)).toBe('HARD');
      expect(summary.gauge?.type, JSON.stringify(extra)).toBe(simulated.gauge.type);
      expect(summary.gauge?.current, JSON.stringify(extra)).toBeCloseTo(simulated.gauge.final, 2);
    }
  });

  // `#EXRANK` changes are recorded whatever ruleset the play ran under, so re-simulating a beatoraja or IIDX log under
  // LR2 uses the windows an LR2 play of the same inputs used.
  test.each(['beatoraja', 'iidx'] as const)(
    'a %s log re-simulates under lr2 with the #EXRANK changes',
    async (ruleset) => {
      const json = chart([
        { measure: 1, channel: 'A0', position: [0, 1], value: '01' },
        { measure: 2, channel: '11', position: [0, 1], value: '01' },
      ]);
      json.bms.exRank['01'] = '25';
      const inputs = [down(0, 2_040_000, '11'), up(1, 2_080_000, '11')];

      const played = await replay(json, inputs, ruleset);
      const lr2 = await replay(json, inputs, 'lr2');
      const resimulated = simulatePlaylog(played.playlog, { ruleset: 'lr2' });

      expect(played.playlog.chart.judgeRank.timeline).toHaveLength(1);
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
      const { summary, playlog } = await replay(json, inputs, ruleset);
      const simulated = simulatePlaylog(playlog, { ruleset });

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

    const { summary, playlog } = await replay(json, inputs, ruleset);
    const simulated = simulatePlaylog(playlog, { ruleset });

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
    const probe = await replay(chart([at('11', 1_000_000), at('16', 1_000_000)], 3), [], ruleset);
    const { windows } = resolveRulesetConfig(probe.playlog, ruleset);
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
    const { playlog } = await replay(json, inputs, ruleset);
    const simulated = simulatePlaylog(playlog, { ruleset });

    expect(playlog.results?.native?.maxCombo).toBe(simulated.maxCombo);
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

    const { summary, playlog } = await replay(json, inputs, ruleset);
    const simulated = simulatePlaylog(playlog, { ruleset });

    expect(playlog.results?.native?.maxCombo).toBe(simulated.maxCombo);
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

    const { summary, playlog } = await replay(json, inputs, ruleset, { playVariant: '9' });
    const simulated = simulatePlaylog(playlog, { ruleset });

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

      const { playlog } = await replay(json, inputs, ruleset);
      const simulated = simulatePlaylog(playlog, { ruleset });

      expect(playlog.results?.native?.maxCombo, `#LNMODE ${lnMode}`).toBe(simulated.maxCombo);
    }
  });

  // A second key pressing a lane whose long note is held never judges the lane's next note: LR2 charges an empty POOR,
  // beatoraja and IIDX ignore the press.
  test.each(RULESETS)('%s: a second key on a held long note agrees on both sides', async (ruleset) => {
    const json = longNoteChart(1);
    json.events.push({ measure: 2, channel: '11', position: [1, 20], value: '01' });
    const inputs = [down(0, 1_000_000, '11'), down(1, 1_980_000, '11'), up(2, 2_000_000, '11'), up(3, 2_100_000, '11')];

    const { summary, playlog } = await replay(json, inputs, ruleset);
    const simulated = simulatePlaylog(playlog, { ruleset });

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

    const { summary, playlog } = await replay(json, inputs, ruleset);
    const simulated = simulatePlaylog(playlog, { ruleset });

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
    const key = (seq: number, timeUs: number, action: 'down' | 'up', token: string): PlaylogInputEvent => ({
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

    const { summary, playlog } = await replay(json, inputs, ruleset);
    const simulated = simulatePlaylog(playlog, { ruleset });

    expect(summary.gauge?.current).toBe(simulated.gauge.final);
    expect(simulated.gauge.final).toBeLessThan(resolveRulesetConfig(playlog, ruleset).gauge.initial);
  });

  // LR2 judges with the widths in force at the moment it judges: a press with the windows of the press, a release with
  // the windows of the release, even when `#EXRANK` narrows them before the note or the tail.
  test.each(RULESETS)('%s: #EXRANK changes apply at the instant of the press or release', async (ruleset) => {
    const press = chart([
      { measure: 1, channel: 'A0', position: [0, 1], value: '01' },
      { measure: 1, channel: '11', position: [1, 20], value: '01' },
    ]);
    press.bms.exRank['01'] = '25';
    const pressed = await replay(press, [down(0, 900_000, '11'), up(1, 940_000, '11')], ruleset);
    const pressSimulated = simulatePlaylog(pressed.playlog, { ruleset });
    expect([pressed.summary.bad, pressed.summary.emptyPoor]).toEqual([
      pressSimulated.judge.bad,
      pressSimulated.judge.emptyPoor,
    ]);

    const release = longNoteChart(1);
    release.events.push({ measure: 1, channel: 'A0', position: [19, 20], value: '01' });
    release.bms.exRank['01'] = '25';
    const released = await replay(release, [down(0, 1_000_000, '11'), up(1, 1_920_000, '11')], ruleset);
    const releaseSimulated = simulatePlaylog(released.playlog, { ruleset });
    expect([released.summary.perfect, released.summary.bad]).toEqual([
      releaseSimulated.judge.pgreat,
      releaseSimulated.judge.bad,
    ]);

    if (ruleset === 'lr2') {
      expect(pressed.summary.bad).toBe(1);
      expect(released.summary.perfect).toBe(1);
    }
  });

  // FREE ZONE has no judging effect in any reference (LR2 and beatoraja drop channel 17 from 7-key charts; IIDX never had
  // it): a scratch press there is an ordinary press, and charges an empty POOR when a scratch note is in reach.
  test.each(RULESETS)('%s: a scratch press in a FREE ZONE is judged as any other press', async (ruleset) => {
    const json = chart([
      { measure: 1, channel: '17', position: [0, 1], value: '01' },
      { measure: 1, channel: '16', position: [3, 4], value: '01' },
      { measure: 2, channel: '11', position: [0, 1], value: '01' },
      { measure: 2, channel: '18', position: [0, 1], value: '01' },
    ]);
    // A scratch key resolves to the scratch lane and its FREE ZONE alias, as the play log records it.
    const inputs = [down(0, 1_300_000, '16', '17'), up(1, 1_320_000, '16', '17')];

    const { summary, playlog } = await replay(json, inputs, ruleset, { playVariant: '7' });
    const simulated = simulatePlaylog(playlog, { ruleset });

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

    const { summary, playlog } = await replay(json, inputs, ruleset, { autoScratch: true });
    const simulated = simulatePlaylog(playlog, { ruleset });

    expect(summary.perfect).toBe(simulated.judge.pgreat);
    expect(playlog.results?.native?.maxCombo).toBe(simulated.maxCombo);
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
    const scenarios: Record<string, PlaylogInputEvent[]> = {
      held: [down(0, 1_000_000, '11'), up(1, 3_000_000, '11')],
      released: [down(0, 1_000_000, '11'), up(1, 1_200_000, '11'), down(2, 1_400_000, '11'), up(3, 3_000_000, '11')],
      never: [],
      'released well': [down(0, 1_000_000, '11'), up(1, 2_950_000, '11')],
    };

    for (const [name, inputs] of Object.entries(scenarios)) {
      const { summary, playlog } = await replay(json, inputs, ruleset, { gauge: 'HARD' });
      const simulated = simulatePlaylog(playlog, { ruleset });

      expect([summary.perfect, summary.great, summary.good, summary.bad, summary.poor], name).toEqual([
        simulated.judge.pgreat,
        simulated.judge.great,
        simulated.judge.good,
        simulated.judge.bad,
        simulated.judge.poor,
      ]);
      expect(playlog.results?.native?.maxCombo, name).toBe(simulated.maxCombo);
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

    const { summary, playlog } = await replay(json, inputs, 'lr2', { autoScratch: true });
    const simulated = simulatePlaylog(playlog, { ruleset: 'lr2' });

    expect(summary.gauge?.current).toBe(simulated.gauge.final);
    expect(summary.gauge?.current).toBe(0);
  });

  // LR2's mine press leg is live up to the reversal instant itself.
  test('lr2: a press at the reversal instant detonates a mine just before it on both sides', async () => {
    const json = chart([
      { measure: 1, channel: 'D1', position: [99, 100], value: '0A' },
      { measure: 2, channel: '08', position: [0, 1], value: '02' },
      { measure: 1, channel: '12', position: [0, 1], value: '01' },
    ]);
    json.resources.bpm['02'] = -240;
    const inputs = [down(0, 2_000_000, '11'), up(1, 2_010_000, '11')];

    const { summary, playlog } = await replay(json, inputs, 'lr2');
    const simulated = simulatePlaylog(playlog, { ruleset: 'lr2' });

    expect(summary.gauge?.current).toBe(simulated.gauge.final);
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

  test('lr2: a negative-BPM reversal chart records its cutoff and re-simulates to the same judges', async () => {
    // LR2 negative-BPM reversal (#134). BPM 240 → measure = 1 s; `#BPM02 = -240` fires via channel 08 at 2 s.
    // The 1 s note misses normally, the 3 s note sits behind the frozen judge clock and ends the run unjudged.
    // The recorded playlog must carry the reversal instant so the simulator applies the same cutoff instead of
    // sweeping the post-reversal note into a POOR.
    const json = chart([
      { measure: 1, channel: '11', position: [0, 1], value: '01' },
      { measure: 2, channel: '08', position: [0, 1], value: '02' },
      { measure: 3, channel: '11', position: [0, 1], value: '01' },
    ]);
    json.resources.bpm['02'] = -240;

    const { summary, playlog } = await replay(json, [], 'lr2');
    const simulated = simulatePlaylog(playlog, { ruleset: 'lr2' });

    expect(playlog.chart.reversalTimeUs).toBe(2_000_000);
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
    let playlog: BeMusicPlaylog | undefined;
    const summary = await manualPlay(json, {
      speed: 16,
      leadInMs: 0,
      audio: true,
      tui: false,
      judgeRuleset: 'lr2',
      replayInputs: inputs,
      recordPlaylog: {},
      onPlaylogRecorded: (recorded) => {
        playlog = recorded;
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
    const simulated = simulatePlaylog(playlog!, { ruleset: 'lr2' });

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

    const { summary, playlog } = await replay(json, [down(0, 1_000_000, '11'), up(1, 1_050_000, '11')], 'lr2');
    const simulated = simulatePlaylog(playlog, { ruleset: 'lr2' });

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

    const { summary, playlog } = await replay(json, [], ruleset);
    const simulated = simulatePlaylog(playlog, { ruleset });

    expect(summary.poor).toBe(3);
    expect(simulated.judge.poor).toBe(3);
    expect(summary.exScore).toBe(0);
    expect(simulated.exScore).toBe(0);
  });
});

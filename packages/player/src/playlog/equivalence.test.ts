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

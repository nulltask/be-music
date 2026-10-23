import { resolveChart } from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';
import { describe, expect, test } from 'vite-plus/test';
import type { PlayerOptions } from '../engine-types.ts';
import type { RulesetId } from '../../ruleset/definitions.ts';
import type { ReplayViewState } from '../../replay/view.ts';
import { basicChart, denseChart, exRankChart, longNoteChart, mineChart, nonstopCourse, tempoChart } from './charts.ts';
import {
  command,
  formatSnapshot,
  observePlay,
  snapshotOf,
  tap,
  type CharacterizationPlay,
  type PlayObservation,
  type ScriptStep,
} from './harness.ts';

/**
 * Engine characterization: golden snapshots of what `manualPlay` and `autoPlay` do today, run on a virtual clock so
 * every run is the same and takes milliseconds. Each case plays a synthetic chart (`charts.ts`) and pins everything a
 * host can observe (see `harness.ts`): the summary, the replay and its re-simulations under every ruleset, the audio
 * session's calls, the judge cues, the UI commands and frames, the host callbacks and the text output.
 *
 * The snapshots are not a specification. They record the current behaviour so a refactor that should not change it
 * (the one play loop of ADR 0003) can prove it did not. A snapshot changes only in a pull request that means to change
 * that behaviour: update it there with `vp test run -u` and say why in the pull request.
 */

const RULESETS: readonly RulesetId[] = ['lr2', 'beatoraja', '____'];

/** Every note pressed `offsetsMs[i]` off its time (cycled), every `skipEvery`th left alone, long notes held to their end. */
function scriptForNotes(
  chart: BeMusicJSON,
  pattern: { offsetsMs: readonly number[]; skipEvery?: number; releaseOffsetMs?: number; timeScale?: number },
): ScriptStep[] {
  const scale = pattern.timeScale ?? 1;
  const steps: ScriptStep[] = [];
  resolveChart(chart).notes.forEach((note, index) => {
    if (pattern.skipEvery !== undefined && index % pattern.skipEvery === pattern.skipEvery - 1) return;
    const atMs = Math.round((note.seconds * 1000 + pattern.offsetsMs[index % pattern.offsetsMs.length]!) / scale);
    const holdMs =
      note.endSeconds === undefined
        ? 50
        : Math.round(((note.endSeconds - note.seconds) * 1000 + (pattern.releaseOffsetMs ?? 0)) / scale);
    steps.push(...tap(atMs, note.channel, holdMs));
  });
  return steps;
}

/** The basic chart's taps: on time, late, early, a BAD, a chord, a miss, an empty POOR, a press on an empty lane. */
const BASIC_SCRIPT: ScriptStep[] = [
  ...tap(500, '11'),
  ...tap(780, '12'),
  ...tap(940, '13'),
  ...tap(1370, '16'),
  ...tap(1500, ['14', '15']),
  ...tap(2000, '19'),
  ...tap(2150, '11'),
  ...tap(2500, '11'),
  ...tap(3000, ['12', '13']),
  ...tap(3525, '11'),
];

/** The long-note chart: a hold to the end, an early release, a tap, a late scratch release, a missed long note. */
const LONG_NOTE_SCRIPT: ScriptStep[] = [
  { atMs: 500, down: ['11'] },
  { atMs: 1010, down: ['12'] },
  ...tap(1250, '13'),
  { atMs: 1500, up: ['11'] },
  { atMs: 1600, up: ['12'] },
  { atMs: 2000, down: ['16'] },
  { atMs: 2540, up: ['16'] },
  ...tap(3480, '15'),
];

/** The mine chart: a key held through a mine, a press onto a mine, a scratch held through one, two taps. */
const MINE_SCRIPT: ScriptStep[] = [
  { atMs: 490, down: ['11'] },
  { atMs: 1100, up: ['11'] },
  ...tap(1500, '11'),
  ...tap(2000, '12'),
  { atMs: 2400, down: ['16'] },
  { atMs: 2600, up: ['16'] },
];

interface ChartCase {
  name: string;
  chart: () => BeMusicJSON;
  script: (chart: BeMusicJSON) => ScriptStep[];
  options?: PlayerOptions;
}

const nonstop = nonstopCourse();

const CHART_CASES: readonly ChartCase[] = [
  { name: 'basic', chart: basicChart, script: () => BASIC_SCRIPT },
  ...([1, 2, 3] as const).map((lnMode): ChartCase => ({
    name: `ln-mode-${lnMode}`,
    chart: () => longNoteChart(lnMode),
    script: () => LONG_NOTE_SCRIPT,
  })),
  { name: 'mines', chart: mineChart, script: () => MINE_SCRIPT },
  {
    name: 'tempo',
    chart: tempoChart,
    script: (chart) => scriptForNotes(chart, { offsetsMs: [0, 12, -25, 45, -70, 130] }),
  },
  { name: 'exrank', chart: () => exRankChart(), script: (chart) => scriptForNotes(chart, { offsetsMs: [35] }) },
  {
    name: 'dense-hard-gauge',
    chart: denseChart,
    script: (chart) => scriptForNotes(chart, { offsetsMs: [0] }).slice(0, 8),
    options: { gauge: 'HARD' },
  },
  {
    name: 'nonstop',
    chart: () => nonstop.chart,
    script: (chart) => scriptForNotes(chart, { offsetsMs: [30, -30, 0] }),
    options: { stageRanks: nonstop.map.stageRanks, course: { kind: 'nonstop' } },
  },
];

async function expectSnapshot(name: string, observations: Record<string, PlayObservation>): Promise<void> {
  await expect(`${formatSnapshot(snapshotOf(observations))}\n`).toMatchFileSnapshot(`__expected__/${name}.json`);
}

/** A live manual play, the replay of its replay, and an auto play of the same chart. */
async function playThreeWays(play: Omit<CharacterizationPlay, 'driver'>) {
  const manual = await observePlay({ ...play, driver: 'manual' });
  const log = manual.replay!;
  const replay = await observePlay({
    ...play,
    driver: 'manual',
    script: [],
    options: {
      ...play.options,
      replayInputs: log.inputs,
      ...(log.play.tempo !== undefined ? { speed: log.play.tempo } : {}),
      ...(log.play.tempoChanges !== undefined ? { replayTempoChanges: log.play.tempoChanges } : {}),
    },
  });
  const auto = await observePlay({ ...play, driver: 'auto', script: [] });
  return { manual, replay, auto };
}

describe('engine characterization: charts × drivers × rulesets', () => {
  for (const chartCase of CHART_CASES) {
    for (const ruleset of RULESETS) {
      test(`${chartCase.name} / ${ruleset}`, async () => {
        const chart = chartCase.chart();
        const plays = await playThreeWays({
          chart,
          script: chartCase.script(chart),
          options: { ...chartCase.options, judgeRuleset: ruleset },
        });
        // A replay re-derives the live play's judgments from its log.
        expect(plays.replay.summary).toEqual(plays.manual.summary);
        expect(plays.replay.replay?.inputs).toEqual(plays.manual.replay?.inputs);
        await expectSnapshot(`charts/${chartCase.name}.${ruleset}`, plays);
      });
    }
  }
});

const VIEW: ReplayViewState = {
  hiSpeed: 2,
  hsFix: 'MAIN',
  visibleMs: 800,
  covers: [{ side: '1P', sudden: 0.2, hidden: 0, lift: 0 }],
};

describe('engine characterization: play scenarios', () => {
  test('tempo set at the start', async () => {
    const chart = basicChart();
    const plays = await playThreeWays({
      chart,
      script: scriptForNotes(chart, { offsetsMs: [0, 20, -40], timeScale: 1.5 }),
      options: { speed: 1.5 },
    });
    expect(plays.replay.summary).toEqual(plays.manual.summary);
    await expectSnapshot('scenarios/tempo-at-start', plays);
  });

  test('tempo changed during the play', async () => {
    const chart = basicChart();
    // Tempo 1 until 1.0 s, then 0.5: chart second t > 1 is due at 1000 + (t - 1) * 2000 ms.
    const at = (seconds: number): number => (seconds <= 1 ? seconds * 1000 : 1000 + (seconds - 1) * 2000);
    const script: ScriptStep[] = [
      command(1000, { kind: 'tempo', tempo: 0.5 }),
      ...resolveChart(chart).notes.flatMap((note) => tap(Math.round(at(note.seconds)), note.channel)),
    ];
    const plays = await playThreeWays({ chart, script });
    // A replay of an auto-played log with these tempo changes (its inputs are empty).
    const autoFollowingTheLog = await observePlay({
      driver: 'auto',
      chart,
      options: { replayInputs: [], replayTempoChanges: plays.manual.replay!.play.tempoChanges! },
    });
    const autoWithCommand = await observePlay({ driver: 'auto', chart, script: [script[0]!] });
    expect(plays.replay.summary).toEqual(plays.manual.summary);
    await expectSnapshot('scenarios/tempo-change', { ...plays, autoFollowingTheLog, autoWithCommand });
  });

  test('view, high-speed and pause commands', async () => {
    const chart = basicChart();
    // Paused from 1200 to 1700: the presses after it come 500 ms later on the clock.
    const script: ScriptStep[] = [
      ...BASIC_SCRIPT.map((step) => (step.atMs > 1200 ? { ...step, atMs: step.atMs + 500 } : step)),
      command(300, { kind: 'view', change: { hiSpeed: 2.5 } }),
      command(600, { kind: 'high-speed', action: 'increase' }),
      command(1200, { kind: 'toggle-pause' }),
      command(1700, { kind: 'toggle-pause' }),
      command(2200, { kind: 'view', change: { covers: [{ side: '1P', sudden: 0.35, hidden: 0, lift: 0.1 }] } }),
      command(2300, { kind: 'high-speed', action: 'decrease' }),
    ];
    const options: PlayerOptions = { recordReplay: { view: VIEW } };
    const manual = await observePlay({ driver: 'manual', chart, script, options });
    const auto = await observePlay({
      driver: 'auto',
      chart,
      script: script.filter((step) => 'command' in step),
      options,
    });
    await expectSnapshot('scenarios/view-high-speed-pause', { manual, auto });
  });

  test('ESC interrupt', async () => {
    const chart = basicChart();
    const script = [
      ...BASIC_SCRIPT.filter((step) => step.atMs < 1800),
      command(1800, { kind: 'interrupt', reason: 'escape' }),
    ];
    const manual = await observePlay({ driver: 'manual', chart, script });
    // A replay of the aborted log plays its inputs and stops where the play was aborted.
    const replayOfTheAbortedLog = await observePlay({
      driver: 'manual',
      chart,
      options: { replayInputs: manual.replay!.inputs, replayAbortedAtUs: manual.replay!.play.abortedAtUs },
    });
    const auto = await observePlay({
      driver: 'auto',
      chart,
      script: [command(1800, { kind: 'interrupt', reason: 'escape' })],
    });
    await expectSnapshot('scenarios/escape', { manual, replayOfTheAbortedLog, auto });
  });

  test('ESC during the lead-in', async () => {
    const chart = basicChart();
    const play = { chart, script: [command(200, { kind: 'interrupt', reason: 'escape' })], options: { leadInMs: 500 } };
    const manual = await observePlay({ ...play, driver: 'manual' });
    const auto = await observePlay({ ...play, driver: 'auto' });
    await expectSnapshot('scenarios/escape-during-lead-in', { manual, auto });
  });

  test('restart and Ctrl+C interrupts', async () => {
    const chart = basicChart();
    const restart = [command(1800, { kind: 'interrupt', reason: 'restart' })];
    const ctrlC = [command(1800, { kind: 'interrupt', reason: 'ctrl-c' })];
    const observations = {
      manualRestart: await observePlay({ driver: 'manual', chart, script: [...BASIC_SCRIPT, ...restart] }),
      autoRestart: await observePlay({ driver: 'auto', chart, script: restart }),
      manualCtrlC: await observePlay({ driver: 'manual', chart, script: [...BASIC_SCRIPT, ...ctrlC] }),
      autoCtrlC: await observePlay({ driver: 'auto', chart, script: ctrlC }),
    };
    expect(observations.manualRestart.outcome).toBe('interrupted: restart');
    expect(observations.autoCtrlC.outcome).toBe('interrupted: ctrl-c');
    await expectSnapshot('scenarios/restart-and-ctrl-c', observations);
  });

  test('a survival gauge that empties, with and without endOnFailure', async () => {
    const chart = denseChart();
    const script = scriptForNotes(chart, { offsetsMs: [0] }).slice(0, 8);
    const observations = {
      manualEnding: await observePlay({ driver: 'manual', chart, script, options: { gauge: 'DEATH' } }),
      manualKeepingOn: await observePlay({
        driver: 'manual',
        chart,
        script,
        options: { gauge: 'DEATH', endOnFailure: false },
      }),
      autoEnding: await observePlay({ driver: 'auto', chart, options: { gauge: 'DEATH' } }),
    };
    expect(observations.manualEnding.endedAtMs).toBeLessThan(observations.manualKeepingOn.endedAtMs);
    await expectSnapshot('scenarios/end-on-failure', observations);
  });

  test('holdAfterChart: settle, play on, release', async () => {
    const chart = basicChart();
    const play = {
      chart,
      script: [...BASIC_SCRIPT, ...tap(5200, '11'), ...tap(5300, '16', 200)],
      holdAfterChart: { releaseAfterMs: 600 },
    };
    const manual = await observePlay({ ...play, driver: 'manual' });
    const manualWithoutAudio = await observePlay({ ...play, driver: 'manual', audio: false });
    const auto = await observePlay({ ...play, driver: 'auto', script: [] });
    expect(manual.host.some((entry) => entry.endsWith('hold settled'))).toBe(true);
    await expectSnapshot('scenarios/hold-after-chart', { manual, manualWithoutAudio, auto });
  });

  for (const ruleset of RULESETS) {
    test(`course stage carry-in / ${ruleset}`, async () => {
      const chart = basicChart();
      const plays = await playThreeWays({
        chart,
        script: BASIC_SCRIPT,
        options: {
          judgeRuleset: ruleset,
          gauge: 'HARD',
          course: { kind: 'grade', carryIn: { gauge: 76.5, combo: 7, maxCombo: 30 } },
        },
      });
      expect(plays.replay.summary).toEqual(plays.manual.summary);
      await expectSnapshot(`scenarios/course-carry-in.${ruleset}`, plays);
    });
  }

  test('no UI runtime: the no-TUI trace', async () => {
    const chart = longNoteChart(2);
    const manual = await observePlay({ driver: 'manual', chart, script: LONG_NOTE_SCRIPT, ui: false });
    const auto = await observePlay({ driver: 'auto', chart, ui: false });
    await expectSnapshot('scenarios/no-tui-trace', { manual, auto });
  });

  test('no audio session', async () => {
    const chart = basicChart();
    const manual = await observePlay({ driver: 'manual', chart, script: BASIC_SCRIPT, audio: false });
    const auto = await observePlay({ driver: 'auto', chart, audio: false });
    await expectSnapshot('scenarios/no-audio-session', { manual, auto });
  });

  test('an audio clock with a write head ahead, a start delay and an audio offset; a session without a clock', async () => {
    const chart = basicChart();
    const play = {
      chart,
      audio: { writeAheadMs: 100, chartStartDelayMs: 50 },
      options: { audioOffsetMs: 20 },
    };
    const observations = {
      manual: await observePlay({
        ...play,
        driver: 'manual',
        script: BASIC_SCRIPT.map((step) => ({ ...step, atMs: step.atMs + 70 })),
      }),
      auto: await observePlay({ ...play, driver: 'auto' }),
      // Without `getClockState` the engine keeps time on the scheduler's clock.
      manualWithoutAudioClock: await observePlay({
        driver: 'manual',
        chart,
        script: BASIC_SCRIPT,
        audio: { clock: false },
      }),
      autoWithoutAudioClock: await observePlay({ driver: 'auto', chart, audio: { clock: false } }),
    };
    await expectSnapshot('scenarios/audio-clock', observations);
  });

  test('AUTO play started partway (startAtSeconds)', async () => {
    // 2.2 s: past the basic chart's first eight notes and both BGM starts; 1.6 s: inside the charge note on 12.
    const observations = {
      basic: await observePlay({ driver: 'auto', chart: basicChart(), options: { startAtSeconds: 2.2 } }),
      heldChargeNote: await observePlay({ driver: 'auto', chart: longNoteChart(2), options: { startAtSeconds: 1.6 } }),
      tempo: await observePlay({ driver: 'auto', chart: basicChart(), options: { startAtSeconds: 2.2, speed: 1.5 } }),
      leadIn: await observePlay({
        driver: 'auto',
        chart: basicChart(),
        options: { startAtSeconds: 2.2, leadInMs: 500 },
      }),
    };
    await expectSnapshot('scenarios/seek-start-at', observations);
  });

  test('seek commands', async () => {
    const seek = (atMs: number, seconds: number): ScriptStep => command(atMs, { kind: 'seek', seconds });
    const observations = {
      // Forwards past eight notes and both BGM starts, then back before the chord.
      forwardsAndBack: await observePlay({
        driver: 'auto',
        chart: basicChart(),
        script: [seek(300, 2.2), seek(900, 1.4)],
      }),
      // Into a charge note: its keysound rings on partway, and the hold is announced again.
      intoAHeldNote: await observePlay({ driver: 'auto', chart: longNoteChart(2), script: [seek(300, 1.6)] }),
      // Three seeks in one drain: only the last applies.
      coalesced: await observePlay({
        driver: 'auto',
        chart: basicChart(),
        script: [
          {
            atMs: 300,
            commands: [
              { kind: 'seek', seconds: 3 },
              { kind: 'seek', seconds: 0.2 },
              { kind: 'seek', seconds: 2.2 },
            ],
          },
        ],
      }),
      // Sought while paused: it stays paused at the second sought, and plays on from there on resume.
      paused: await observePlay({
        driver: 'auto',
        chart: basicChart(),
        script: [command(600, { kind: 'toggle-pause' }), seek(800, 2.2), command(1200, { kind: 'toggle-pause' })],
      }),
      // During the lead-in a seek sets where the chart starts.
      leadIn: await observePlay({
        driver: 'auto',
        chart: basicChart(),
        script: [seek(200, 2.2)],
        options: { leadInMs: 500 },
      }),
      // Out of the hold after the chart: the play settles again at its new horizon.
      outOfTheHold: await observePlay({
        driver: 'auto',
        chart: basicChart(),
        script: [seek(5000, 3)],
        holdAfterChart: { releaseAfterMs: 3000 },
      }),
      // After a tempo change: the tempo in force is kept.
      afterATempoChange: await observePlay({
        driver: 'auto',
        chart: basicChart(),
        script: [command(500, { kind: 'tempo', tempo: 0.5 }), seek(1000, 2.2)],
      }),
      // Past the chart's end and before its start: clamped.
      clamped: await observePlay({ driver: 'auto', chart: basicChart(), script: [seek(300, 99), seek(400, -5)] }),
      // Without a UI runtime the no-TUI trace records it.
      noUI: await observePlay({ driver: 'auto', chart: basicChart(), script: [seek(300, 2.2)], ui: false }),
      // A manual seek starts practice: earlier notes are consumed without scoring.
      manual: await observePlay({ driver: 'manual', chart: basicChart(), script: [...BASIC_SCRIPT, seek(300, 2.2)] }),
    };
    expect(observations.coalesced.frames.generations).toHaveLength(1);
    expect(observations.manual.frames.generations).toEqual([expect.stringContaining('generation=1 seconds=2.2 ')]);
    expect(observations.manual.replay).toBeUndefined();
    await expectSnapshot('scenarios/seek', observations);
  });

  test('lead-in', async () => {
    const chart = basicChart();
    const manual = await observePlay({
      driver: 'manual',
      chart,
      script: BASIC_SCRIPT.map((step) => ({ ...step, atMs: step.atMs + 1000 })),
      options: { leadInMs: 1000 },
    });
    const auto = await observePlay({ driver: 'auto', chart, options: { leadInMs: 1000 } });
    await expectSnapshot('scenarios/lead-in', { manual, auto });
  });

  test('terminal input: presses without key releases, and pressedAt', async () => {
    const chart = longNoteChart(1);
    // A terminal sends no release: long notes are held by the hold-grace windows of the repeated presses.
    const repeats = (fromMs: number, toMs: number, lane: string): ScriptStep[] =>
      Array.from({ length: Math.floor((toMs - fromMs) / 100) + 1 }, (_, index) => ({
        atMs: fromMs + index * 100,
        press: [lane],
      }));
    const script: ScriptStep[] = [
      ...repeats(500, 1500, '11'),
      { atMs: 1012, press: ['12'] },
      { atMs: 1260, press: ['13'], pressedAtMs: 1250 },
      { atMs: 2010, press: ['16'], pressedAtMs: 1995 },
      { atMs: 3600, press: ['15'], pressedAtMs: 3480 },
    ];
    const manual = await observePlay({ driver: 'manual', chart, script });
    const replay = await observePlay({ driver: 'manual', chart, options: { replayInputs: manual.replay!.inputs } });
    await expectSnapshot('scenarios/terminal-input', { manual, replay });
  });
});

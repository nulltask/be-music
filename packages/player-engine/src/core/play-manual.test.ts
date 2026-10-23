import { describe, expect, test } from 'vite-plus/test';
import { basicChart, longNoteChart, mineChart } from './characterization/charts.ts';
import { observePlay, type PlayObservation, type ScriptStep } from './characterization/harness.ts';

/** A replay's inputs as `action lanes @us`, with `inferred` on an inferred release. */
const loggedInputs = (observation: PlayObservation): string[] =>
  (observation.replay?.inputs ?? []).map(
    (input) =>
      `${input.action} ${input.channels.join(',')} @${input.timeUs}${input.inferred === true ? ' inferred' : ''}`,
  );

describe('manual play: an input runtime that declares its key releases', () => {
  // The play's first key: a press alone, and its release 300 ms later (the basic chart's note on 11 is at 0.5 s).
  const firstKey: ScriptStep[] = [
    { atMs: 500, press: ['11'] },
    { atMs: 800, up: ['11'] },
  ];

  test('a runtime that declares its releases judges its first press as key-state input, with no inferred release', async () => {
    const declared = await observePlay({
      driver: 'manual',
      chart: basicChart(),
      script: firstKey,
      reportsKeyReleases: true,
    });
    expect(loggedInputs(declared)).toEqual(['down 11 @500000', 'up 11 @800000']);
  });

  test('without the declaration the first press goes through the inference until a key-state command arrives', async () => {
    const detected = await observePlay({
      driver: 'manual',
      chart: basicChart(),
      script: firstKey,
      reportsKeyReleases: false,
    });
    // The inference let the key go after its 120 ms grace; the input's own release came later.
    expect(loggedInputs(detected)).toEqual(['down 11 @500000', 'up 11 @620000 inferred', 'up 11 @800000']);
  });

  test('a web-style play judges its first key the same whether or not the runtime declares its releases', async () => {
    // Each key is a `lane-input` and a `kitty-state` press, as the web input runtime sends them. The first key holds a
    // Hell Charge note, which gains from the press only when the press is judged as key-state input.
    const script: ScriptStep[] = [
      { atMs: 500, down: ['11'] },
      { atMs: 1010, down: ['12'] },
      { atMs: 1500, up: ['11'] },
      { atMs: 2000, up: ['12'] },
    ];
    const play = { driver: 'manual', chart: longNoteChart(3), script, options: { judgeRuleset: '____' } } as const;
    const declared = await observePlay({ ...play, reportsKeyReleases: true });
    const detected = await observePlay({ ...play, reportsKeyReleases: false });
    expect(declared.judges).toEqual(detected.judges);
    expect(declared.summary).toEqual(detected.summary);
    expect(loggedInputs(declared)).toEqual(loggedInputs(detected));
  });
});

describe('manual play: a tap whose release is drained right after its press', () => {
  // Web Audio's `currentTime` moves a render quantum (128 frames, 2.67 ms at 48 kHz) at a time while `pressedAt` moves
  // smoothly. A finger tapping 11 at 0.5 s lifts 0.1 ms after it touched, and the release is drained 0.5 ms after the
  // press, within the same quantum: both read the same audible time, so the release, drained later, reads 0.4 ms older
  // than the press (the 0.5 ms between the drains less the 0.1 ms between the events). The mines on 11 at 1.0 and 1.5 s
  // pass a lane that is up, so neither goes off.
  const script: ScriptStep[] = [
    { atMs: 500, down: ['11'], pressedAtMs: 500 },
    { atMs: 500.5, up: ['11'], pressedAtMs: 500.1 },
  ];
  const audio = { quantumMs: 128 / 48 };

  test.each(['lr2', 'beatoraja', '____'] as const)(
    '%s: logs the release no earlier than its press, and the replay and the simulator judge the play as it was judged',
    async (ruleset) => {
      const live = await observePlay({
        driver: 'manual',
        chart: mineChart(),
        script,
        audio,
        options: { judgeRuleset: ruleset },
      });
      const replay = live.replay!;
      expect(loggedInputs(live)).toHaveLength(2);
      const [down, up] = replay.inputs;
      expect([down!.action, up!.action]).toEqual(['down', 'up']);
      expect(up!.timeUs).toBeGreaterThanOrEqual(down!.timeUs);

      const replayed = await observePlay({
        driver: 'manual',
        chart: mineChart(),
        audio,
        options: { judgeRuleset: ruleset, replayInputs: replay.inputs },
      });
      expect(replayed.summary).toEqual(live.summary);
      expect(replayed.replay?.inputs).toEqual(replay.inputs);
      // The replay simulator re-derives the engine's own result.
      expect(live.simulated![ruleset]).toEqual({ ...replay.results?.native, ruleset: expect.any(String) });
    },
  );

  test('a key pressed again just after it came up is stamped no earlier than its release', async () => {
    // The release at 0.7 s is drained at once; the next press, 0.1 ms after it, is drained 0.5 ms after it, within the
    // same quantum, so it reads older than the release.
    const live = await observePlay({
      driver: 'manual',
      chart: mineChart(),
      script: [
        { atMs: 500, down: ['11'], pressedAtMs: 500 },
        { atMs: 700, up: ['11'], pressedAtMs: 700 },
        { atMs: 700.5, down: ['11'], pressedAtMs: 700.1 },
        { atMs: 760, up: ['11'], pressedAtMs: 760 },
      ],
      audio,
    });
    const inputs = live.replay!.inputs;
    expect(inputs.map((input) => input.action)).toEqual(['down', 'up', 'down', 'up']);
    for (let index = 1; index < inputs.length; index += 1) {
      expect(inputs[index]!.timeUs).toBeGreaterThanOrEqual(inputs[index - 1]!.timeUs);
    }
  });
});

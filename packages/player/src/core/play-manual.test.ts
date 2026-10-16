import { describe, expect, test } from 'vite-plus/test';
import { basicChart, longNoteChart } from './characterization/charts.ts';
import { observePlay, type PlayObservation, type ScriptStep } from './characterization/harness.ts';

/** A play log's inputs as `action lanes @us`, with `inferred` on an inferred release. */
const loggedInputs = (observation: PlayObservation): string[] =>
  (observation.playlog?.inputs ?? []).map(
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
    const play = { driver: 'manual', chart: longNoteChart(3), script, options: { judgeRuleset: 'iidx' } } as const;
    const declared = await observePlay({ ...play, reportsKeyReleases: true });
    const detected = await observePlay({ ...play, reportsKeyReleases: false });
    expect(declared.judges).toEqual(detected.judges);
    expect(declared.summary).toEqual(detected.summary);
    expect(loggedInputs(declared)).toEqual(loggedInputs(detected));
  });
});

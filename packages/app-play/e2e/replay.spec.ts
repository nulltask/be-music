import type { BeMusicReplay } from '@be-music/player-engine/replay';
import { expect, openWithLibrary, SMOKE, SONGS, test, type Demo } from './support.ts';

/**
 * Checklist item 12 on the built-in family: the status line around a play, the replay's live tempo and view
 * changes, and a replay of the log with the Debug Menu's Replay / ghost options on and off.
 */

const TEMPO = ['Tempo'];
const REPLAY_VIEW = ['Play options', 'Replay / ghost'];

/**
 * Plays Fixture A with AUTO, raising the tempo to +20 % (pitch mode, the default) and the hi-speed by two steps once
 * notes are judged, and returns its replay.
 */
async function playWithLiveChanges(demo: Demo): Promise<BeMusicReplay> {
  await demo.setOption(TEMPO, 'Enabled', true);
  await demo.setOption(['Play options'], 'Auto play', true);
  await demo.browseTo(SONGS, 'Fixture A');
  await demo.key('Enter');
  let state = await demo.waitFor(
    (current) => current.scene.kind === 'play' && (current.play?.judged?.pgreat ?? 0) >= 1,
    'Fixture A under way',
  );
  expect(state.status).toBe('Playing: Fixture A');
  const hiSpeed = state.play?.hiSpeed ?? 0;
  await demo.setOption(TEMPO, 'Tempo (%)', 20);
  state = await demo.waitFor((current) => current.play?.tempo === 1.2, 'the tempo to change live');
  expect(state.status).toBe('Playing (tempo +20%): Fixture A');
  await demo.key('ArrowUp');
  await demo.key('ArrowUp');
  await demo.waitFor((current) => (current.play?.hiSpeed ?? 0) > hiSpeed, 'the hi-speed to rise');
  state = await demo.waitForResult(0);
  expect(state.status).toBe('Result: Fixture A');
  const replay = await demo.lastReplay();
  if (replay === undefined) throw new Error('the play recorded no log');
  return replay;
}

test('the status line follows a play, and its log records the live tempo and view changes', async ({ demo }) => {
  await openWithLibrary(demo);
  const library = (await demo.state()).status;
  expect(library).toBe('8 charts loaded');
  const replay = await playWithLiveChanges(demo);
  expect(replay.play.mode).toBe('auto');
  expect(replay.play.tempo ?? 1).toBe(1);
  expect(replay.play.tempoChanges).toEqual([expect.objectContaining({ tempo: 1.2 })]);
  const start = replay.play.view?.hiSpeed;
  expect(start).toBeGreaterThan(0);
  expect(replay.play.viewChanges?.length ?? 0).toBeGreaterThan(0);
  expect(replay.play.viewChanges?.at(-1)?.hiSpeed).toBeGreaterThan(start!);
  // Back on the select screen the status line describes the library again.
  await demo.leaveResult();
  const state = await demo.waitFor((current) => current.scene.kind === 'select', 'the select screen');
  expect(state.status).toBe(library);
});

test(
  "a replay follows the log's tempo and hi-speed with Replay / ghost on, and the viewer's with it off",
  SMOKE,
  async ({ demo }) => {
    await openWithLibrary(demo);
    const replay = await playWithLiveChanges(demo);
    const change = replay.play.tempoChanges?.[0];
    const recordedHiSpeed = replay.play.viewChanges?.at(-1)?.hiSpeed;
    if (change === undefined || recordedHiSpeed === undefined) throw new Error('the log recorded no live change');
    await demo.leaveResult();
    // The viewer's own settings, which a replay keeps only with the Replay / ghost options off.
    await demo.setOption(TEMPO, 'Tempo (%)', -10);
    await demo.setOption(['Play options'], 'Hi-speed', 4);
    const text = JSON.stringify(replay);

    // On (the default): the replay starts at the recorded tempo and follows its change and the recorded hi-speed.
    await demo.dropText('fixture-a.bmplay.json', text);
    let state = await demo.waitFor(
      (current) => current.scene.kind === 'play' && current.play?.replay === true,
      'the replay to start',
    );
    expect(state.status).toBe('Replaying: Fixture A');
    expect(state.play?.tempo).toBe(1);
    state = await demo.waitFor(
      (current) => current.play?.tempo === 1.2 && Math.abs((current.play.hiSpeed ?? 0) - recordedHiSpeed) < 0.05,
      'the replay to follow the recorded tempo and hi-speed',
    );
    // Seeking a paused replay rebuilds counts and restores the view and tempo at the target.
    await demo.key('Space');
    await demo.key('ArrowLeft');
    state = await demo.waitFor((current) => current.play?.seconds === 0, 'the replay sought to its start');
    expect(state.play?.judged?.pgreat).toBe(0);
    expect(state.play?.tempo).toBe(1);
    expect(state.play?.hiSpeed).toBe(replay.play.view?.hiSpeed);
    await demo.key('ArrowRight');
    state = await demo.waitFor(
      (current) => Math.abs((current.play?.seconds ?? -1) - 5) < 0.01,
      'the replay sought forwards',
    );
    expect(state.play?.judged?.pgreat).toBe(9);
    expect(state.play?.tempo).toBe(1.2);
    expect(state.play?.hiSpeed).toBeCloseTo(recordedHiSpeed, 1);
    await demo.key('ArrowLeft');
    state = await demo.waitFor((current) => current.play?.seconds === 0, 'the replay sought back again');
    expect(state.play?.judged?.pgreat).toBe(0);
    expect(state.play?.tempo).toBe(1);
    await demo.key('Space');
    await demo.waitFor(
      (current) => (current.play?.judged?.pgreat ?? 0) >= 1,
      'the replay to judge again after resuming',
    );
    await demo.key('Escape');
    await demo.waitFor((current) => current.scene.kind === 'select', 'the select screen');

    // Off: the viewer's tempo and hi-speed for the whole replay.
    await demo.setOption(REPLAY_VIEW, 'Tempo', false);
    await demo.setOption(REPLAY_VIEW, 'Hi-speed', false);
    await demo.dropText('fixture-a.bmplay.json', text);
    state = await demo.waitFor(
      (current) => current.scene.kind === 'play' && current.play?.replay === true,
      'the replay to start',
    );
    expect(state.status).toBe('Replaying (tempo -10%): Fixture A');
    // Past the chart time the recorded change was made at, nothing has changed.
    const after = change.timeUs / 1e6 + 0.5;
    state = await demo.waitFor(
      (current) => current.scene.kind !== 'play' || (current.play?.seconds ?? 0) > after,
      'the replay to pass the recorded change',
    );
    expect(state.play?.tempo).toBe(0.9);
    expect(state.play?.hiSpeed).toBe(4);
    await demo.key('Space');
    await demo.key('ArrowLeft');
    state = await demo.waitFor(
      (current) => current.play?.seconds === 0,
      'the replay sought with recorded settings off',
    );
    expect(state.play?.tempo).toBe(0.9);
    expect(state.play?.hiSpeed).toBe(4);
    await demo.key('ArrowRight');
    state = await demo.waitFor(
      (current) => Math.abs((current.play?.seconds ?? -1) - 5) < 0.01,
      'the replay sought forwards with recorded settings off',
    );
    expect(state.play?.tempo).toBe(0.9);
    expect(state.play?.hiSpeed).toBe(4);
  },
);

test('manual seeking stays paused, resets judgments and finishes without a replay', async ({ demo }) => {
  await openWithLibrary(demo);
  await demo.setOption(['Play options'], 'Auto play', false);
  await demo.browseTo(SONGS, 'Fixture A');
  await demo.key('Enter');
  await demo.waitFor(
    (state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 1.5,
    'manual play under way',
  );
  await demo.key('Space');
  await demo.key('ArrowLeft');
  let state = await demo.waitFor((current) => current.play?.seconds === 0, 'practice sought to the start');
  expect(state.play?.judged?.pgreat).toBe(0);
  await demo.key('ArrowRight');
  state = await demo.waitFor(
    (current) => Math.abs((current.play?.seconds ?? -1) - 5) < 0.01,
    'practice sought forwards while paused',
  );
  expect(state.play?.judged?.pgreat).toBe(0);
  await demo.key('Space');
  await demo.waitForResult(0);
  expect(await demo.lastReplay()).toBeUndefined();
});

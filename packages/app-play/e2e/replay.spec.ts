import type { BeMusicReplay } from '@be-music/player-engine/replay';
import { expect, openWithLibrary, SMOKE, SONGS, test, type Player } from './support.ts';

/**
 * Checklist item 12 on the built-in family: the status line around a play, the replay's live tempo and view
 * changes, and a replay of the log with the Debug Menu's Replay / ghost options on and off.
 */

const TEMPO = ['Tempo'];
const REPLAY_VIEW = ['Play options', 'Replay / ghost'];

/**
 * Plays Fixture A with AUTO, raising the tempo to +20 % (pitch mode, the default) and the hi-speed by two steps once
 * notes are judged, and returns its replay. The play is paused on the frame its first note is judged and the changes
 * are made while it waits, so the log records them early in the chart however slow the runner is: a replay of it then
 * reaches them with most of the chart still to play.
 */
async function playWithLiveChanges(player: Player): Promise<BeMusicReplay> {
  await player.setOption(TEMPO, 'Enabled', true);
  await player.setOption(['Play options'], 'Auto play', true);
  await player.browseTo(SONGS, 'Fixture A');
  await player.key('Enter');
  let state = await player.keyWhen(
    (current) => current.scene.kind === 'play' && (current.play?.judged?.pgreat ?? 0) >= 1,
    undefined,
    'Space',
    'Fixture A under way',
  );
  expect(state.status).toBe('Playing: Fixture A');
  const hiSpeed = state.play?.hiSpeed ?? 0;
  await player.setOption(TEMPO, 'Tempo (%)', 20);
  state = await player.waitFor((current) => current.play?.tempo === 1.2, 'the tempo to change live');
  expect(state.status).toBe('Playing (tempo +20%): Fixture A');
  await player.key('ArrowUp');
  await player.key('ArrowUp');
  await player.waitFor((current) => (current.play?.hiSpeed ?? 0) > hiSpeed, 'the hi-speed to rise');
  await player.key('Space');
  state = await player.waitForResult(0);
  expect(state.status).toBe('Result: Fixture A');
  const replay = await player.lastReplay();
  if (replay === undefined) throw new Error('the play recorded no log');
  return replay;
}

test('the status line follows a play, and its log records the live tempo and view changes', async ({ player }) => {
  await openWithLibrary(player);
  const library = (await player.state()).status;
  expect(library).toBe('8 charts loaded');
  const replay = await playWithLiveChanges(player);
  expect(replay.play.mode).toBe('auto');
  expect(replay.play.tempo ?? 1).toBe(1);
  expect(replay.play.tempoChanges).toEqual([expect.objectContaining({ tempo: 1.2 })]);
  // Made while the play waited on its first judged note: early in the chart, well before the 5 s a replay seeks to.
  expect(replay.play.tempoChanges![0]!.timeUs).toBeLessThan(3_000_000);
  const start = replay.play.view?.hiSpeed;
  expect(start).toBeGreaterThan(0);
  expect(replay.play.viewChanges?.length ?? 0).toBeGreaterThan(0);
  expect(replay.play.viewChanges?.at(-1)?.hiSpeed).toBeGreaterThan(start!);
  // Back on the select screen the status line describes the library again.
  await player.leaveResult();
  const state = await player.waitFor((current) => current.scene.kind === 'select', 'the select screen');
  expect(state.status).toBe(library);
});

test(
  "a replay follows the log's tempo and hi-speed with Replay / ghost on, and the viewer's with it off",
  SMOKE,
  async ({ player }) => {
    await openWithLibrary(player);
    const replay = await playWithLiveChanges(player);
    const change = replay.play.tempoChanges?.[0];
    const recordedHiSpeed = replay.play.viewChanges?.at(-1)?.hiSpeed;
    if (change === undefined || recordedHiSpeed === undefined) throw new Error('the log recorded no live change');
    await player.leaveResult();
    // The viewer's own settings, which a replay keeps only with the Replay / ghost options off.
    await player.setOption(TEMPO, 'Tempo (%)', -10);
    await player.setOption(['Play options'], 'Hi-speed', 4);
    const text = JSON.stringify(replay);

    // On (the default): the replay starts at the recorded tempo and follows its change and the recorded hi-speed.
    await player.dropText('fixture-a.bmplay.json', text);
    let state = await player.waitFor(
      (current) => current.scene.kind === 'play' && current.play?.replay === true,
      'the replay to start',
    );
    expect(state.status).toBe('Replaying: Fixture A');
    expect(state.play?.tempo).toBe(1);
    // Paused the moment it follows them (the replay would otherwise run on to its result on a slow runner). Seeking a
    // paused replay rebuilds counts and restores the view and tempo at the target.
    state = await player.keyWhen(
      (current, hiSpeed) => current.play?.tempo === 1.2 && Math.abs((current.play.hiSpeed ?? 0) - hiSpeed) < 0.05,
      recordedHiSpeed,
      'Space',
      'the replay to follow the recorded tempo and hi-speed',
    );
    await player.key('ArrowLeft');
    state = await player.waitFor((current) => current.play?.seconds === 0, 'the replay sought to its start');
    expect(state.play?.judged?.pgreat).toBe(0);
    expect(state.play?.tempo).toBe(1);
    expect(state.play?.hiSpeed).toBe(replay.play.view?.hiSpeed);
    await player.key('ArrowRight');
    state = await player.waitFor(
      (current) => Math.abs((current.play?.seconds ?? -1) - 5) < 0.01,
      'the replay sought forwards',
    );
    expect(state.play?.judged?.pgreat).toBe(9);
    expect(state.play?.tempo).toBe(1.2);
    expect(state.play?.hiSpeed).toBeCloseTo(recordedHiSpeed, 1);
    await player.key('ArrowLeft');
    state = await player.waitFor((current) => current.play?.seconds === 0, 'the replay sought back again');
    expect(state.play?.judged?.pgreat).toBe(0);
    expect(state.play?.tempo).toBe(1);
    await player.key('Space');
    await player.waitFor(
      (current) => (current.play?.judged?.pgreat ?? 0) >= 1,
      'the replay to judge again after resuming',
    );
    await player.key('Escape');
    await player.waitFor((current) => current.scene.kind === 'select', 'the select screen');

    // Off: the viewer's tempo and hi-speed for the whole replay.
    await player.setOption(REPLAY_VIEW, 'Tempo', false);
    await player.setOption(REPLAY_VIEW, 'Hi-speed', false);
    await player.dropText('fixture-a.bmplay.json', text);
    state = await player.waitFor(
      (current) => current.scene.kind === 'play' && current.play?.replay === true,
      'the replay to start',
    );
    expect(state.status).toBe('Replaying (tempo -10%): Fixture A');
    // Past the chart time the recorded change was made at, nothing has changed.
    const after = change.timeUs / 1e6 + 0.5;
    state = await player.waitFor(
      (current) => current.scene.kind !== 'play' || (current.play?.seconds ?? 0) > after,
      'the replay to pass the recorded change',
    );
    expect(state.play?.tempo).toBe(0.9);
    expect(state.play?.hiSpeed).toBe(4);
    await player.key('Space');
    await player.key('ArrowLeft');
    state = await player.waitFor(
      (current) => current.play?.seconds === 0,
      'the replay sought with recorded settings off',
    );
    expect(state.play?.tempo).toBe(0.9);
    expect(state.play?.hiSpeed).toBe(4);
    await player.key('ArrowRight');
    state = await player.waitFor(
      (current) => Math.abs((current.play?.seconds ?? -1) - 5) < 0.01,
      'the replay sought forwards with recorded settings off',
    );
    expect(state.play?.tempo).toBe(0.9);
    expect(state.play?.hiSpeed).toBe(4);
  },
);

test('the arrows do not seek a manual play, which keeps its judgments and records a replay', async ({ player }) => {
  await openWithLibrary(player);
  await player.setOption(['Play options'], 'Auto play', false);
  await player.browseTo(SONGS, 'Fixture A');
  await player.key('Enter');
  await player.waitFor(
    (state) => state.scene.kind === 'play' && (state.play?.seconds ?? 0) > 1.5,
    'manual play under way',
  );
  await player.key('Space');
  const paused = await player.state();
  // ← / → seek five seconds only during AUTO play: a manual play stays where it was paused, judgments and all.
  await player.key('ArrowLeft');
  await player.key('ArrowRight');
  await player.page.waitForTimeout(300);
  const after = await player.state();
  expect(after.play?.seconds).toBeCloseTo(paused.play!.seconds!, 2);
  expect(after.play?.judged).toEqual(paused.play?.judged);
  await player.key('Space');
  await player.waitForResult(0);
  // Not sought, so not practice: the play keeps its replay.
  expect(await player.lastReplay()).toBeDefined();
});

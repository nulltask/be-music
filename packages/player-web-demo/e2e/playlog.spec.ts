import type { BeMusicPlaylog } from '@be-music/player/playlog';
import { type Demo, expect, openWithLibrary, SONGS, test } from './support.ts';

/**
 * Checklist item 12 on the built-in family: the status line around a play, the play log's live tempo and view
 * changes, and a replay of the log with the Debug Menu's Replay / ghost options on and off.
 */

const TEMPO = ['Tempo'];
const REPLAY_VIEW = ['Play options', 'Replay / ghost'];

/**
 * Plays Fixture A with AUTO, raising the tempo to +20 % (pitch mode, the default) and the hi-speed by two steps once
 * notes are judged, and returns its play log.
 */
async function playWithLiveChanges(demo: Demo): Promise<BeMusicPlaylog> {
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
  const playlog = await demo.lastPlaylog();
  if (playlog === undefined) throw new Error('the play recorded no log');
  return playlog;
}

test('the status line follows a play, and its log records the live tempo and view changes', async ({ demo }) => {
  await openWithLibrary(demo);
  const library = (await demo.state()).status;
  expect(library).toBe('8 charts loaded');
  const playlog = await playWithLiveChanges(demo);
  expect(playlog.play.mode).toBe('auto');
  expect(playlog.play.tempo ?? 1).toBe(1);
  expect(playlog.play.tempoChanges).toEqual([expect.objectContaining({ tempo: 1.2 })]);
  const start = playlog.play.view?.hiSpeed;
  expect(start).toBeGreaterThan(0);
  expect(playlog.play.viewChanges?.length ?? 0).toBeGreaterThan(0);
  expect(playlog.play.viewChanges?.at(-1)?.hiSpeed).toBeGreaterThan(start!);
  // Back on the select screen the status line describes the library again.
  await demo.leaveResult();
  const state = await demo.waitFor((current) => current.scene.kind === 'select', 'the select screen');
  expect(state.status).toBe(library);
});

test("a replay follows the log's tempo and hi-speed with Replay / ghost on, and the viewer's with it off", async ({
  demo,
}) => {
  await openWithLibrary(demo);
  const playlog = await playWithLiveChanges(demo);
  const change = playlog.play.tempoChanges?.[0];
  const recordedHiSpeed = playlog.play.viewChanges?.at(-1)?.hiSpeed;
  if (change === undefined || recordedHiSpeed === undefined) throw new Error('the log recorded no live change');
  await demo.leaveResult();
  // The viewer's own settings, which a replay keeps only with the Replay / ghost options off.
  await demo.setOption(TEMPO, 'Tempo (%)', -10);
  await demo.setOption(['Play options'], 'Hi-speed', 4);
  const text = JSON.stringify(playlog);

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
});

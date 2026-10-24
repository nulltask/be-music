import type { TestHookState } from '../src/test-hook.ts';
import { type Player, expect, openWithLibrary, SONGS, test } from './support.ts';

/**
 * F5 during a single chart's play starts it again as it was played, on the built-in family: an AUTO play stays AUTO
 * and a replay stays a replay, whatever the Debug Menu's Auto play says.
 */

const PLAY_OPTIONS = ['Play options'];

/**
 * The built-in Synesthesia skin's select screen, on its wide stage (854 × 480): the AUTO button of the focused-song
 * panel (`addHitArea(200, 300, 90, 32, …, frame.actions.autoPlay)`).
 */
const SELECT_STAGE = { width: 854, height: 480 };
const AUTO_BUTTON = { x: 245, y: 316 };

/** Waits for Fixture A to be under way (a note judged), so F5 reaches a running play. */
function underWay(player: Player): Promise<TestHookState> {
  return player.waitFor(
    (state) => state.scene.kind === 'play' && (state.play?.judged?.pgreat ?? 0) >= 1,
    'Fixture A under way',
  );
}

/** Presses F5 and waits for the play to start again: a new "Playing" or "Replaying" status line, and the play shown. */
async function restart(player: Player): Promise<TestHookState> {
  const shown = (await player.state()).statusLog.length;
  await player.key('F5');
  return player.waitFor(
    (state) =>
      state.scene.kind === 'play' &&
      state.statusLog.slice(shown).some((line) => /^(Playing|Replaying)\b/.test(line)) &&
      state.play !== undefined,
    'the play to start again',
  );
}

test("F5 starts an AUTO play again with AUTO, though the Debug Menu's Auto play is off", async ({ player }) => {
  await openWithLibrary(player, { 'be-music.built-in-skin': 'synesthesia' });
  expect(await player.readOption(PLAY_OPTIONS, 'Auto play')).toBe(false);
  await player.browseTo(SONGS, 'Fixture A');
  // The skin's AUTO button plays this chart with AUTO and leaves the Debug Menu's checkbox alone.
  await player.clickSkin(AUTO_BUTTON.x, AUTO_BUTTON.y, SELECT_STAGE.width, SELECT_STAGE.height);
  let state = await underWay(player);
  expect(state.play).toMatchObject({ title: 'Fixture A', autoPlay: true, replay: false });
  state = await restart(player);
  expect(state.status).toBe('Playing: Fixture A');
  expect(state.play).toMatchObject({ title: 'Fixture A', autoPlay: true, replay: false });
  // The restarted play runs with AUTO: notes are judged with no input.
  state = await underWay(player);
  expect(state.play?.autoPlay).toBe(true);
});

test('F5 starts a replay again as the same replay', async ({ player }) => {
  await openWithLibrary(player);
  // An AUTO play of Fixture A, played to its result, for its replay.
  await player.setOption(PLAY_OPTIONS, 'Auto play', true);
  await player.browseTo(SONGS, 'Fixture A');
  await player.key('Enter');
  await player.waitForResult(0);
  const replay = await player.lastReplay();
  if (replay === undefined) throw new Error('the play recorded no log');
  expect(replay.play.mode).toBe('auto');
  await player.leaveResult();
  await player.waitFor((current) => current.scene.kind === 'select', 'the select screen');
  // With Auto play off, a play F5 started without the replay's own mode would be a live manual play.
  await player.setOption(PLAY_OPTIONS, 'Auto play', false);

  await player.dropText('fixture-a.bmplay.json', JSON.stringify(replay));
  let state = await underWay(player);
  expect(state.status).toBe('Replaying: Fixture A');
  expect(state.play).toMatchObject({ title: 'Fixture A', autoPlay: true, replay: true });
  state = await restart(player);
  expect(state.status).toBe('Replaying: Fixture A');
  expect(state.play).toMatchObject({ title: 'Fixture A', autoPlay: true, replay: true });
});

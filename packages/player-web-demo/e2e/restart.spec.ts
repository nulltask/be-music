import type { TestHookState } from '../src/test-hook.ts';
import { type Demo, expect, openWithLibrary, SONGS, test } from './support.ts';

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
function underWay(demo: Demo): Promise<TestHookState> {
  return demo.waitFor(
    (state) => state.scene.kind === 'play' && (state.play?.judged?.pgreat ?? 0) >= 1,
    'Fixture A under way',
  );
}

/** Presses F5 and waits for the play to start again: a new "Playing" or "Replaying" status line, and the play shown. */
async function restart(demo: Demo): Promise<TestHookState> {
  const shown = (await demo.state()).statusLog.length;
  await demo.key('F5');
  return demo.waitFor(
    (state) =>
      state.scene.kind === 'play' &&
      state.statusLog.slice(shown).some((line) => /^(Playing|Replaying)\b/.test(line)) &&
      state.play !== undefined,
    'the play to start again',
  );
}

test("F5 starts an AUTO play again with AUTO, though the Debug Menu's Auto play is off", async ({ demo }) => {
  await openWithLibrary(demo, { 'be-music-demo.built-in-skin': 'synesthesia' });
  expect(await demo.readOption(PLAY_OPTIONS, 'Auto play')).toBe(false);
  await demo.browseTo(SONGS, 'Fixture A');
  // The skin's AUTO button plays this chart with AUTO and leaves the Debug Menu's checkbox alone.
  await demo.clickSkin(AUTO_BUTTON.x, AUTO_BUTTON.y, SELECT_STAGE.width, SELECT_STAGE.height);
  let state = await underWay(demo);
  expect(state.play).toMatchObject({ title: 'Fixture A', autoPlay: true, replay: false });
  state = await restart(demo);
  expect(state.status).toBe('Playing: Fixture A');
  expect(state.play).toMatchObject({ title: 'Fixture A', autoPlay: true, replay: false });
  // The restarted play runs with AUTO: notes are judged with no input.
  state = await underWay(demo);
  expect(state.play?.autoPlay).toBe(true);
});

test('F5 starts a replay again as the same replay', async ({ demo }) => {
  await openWithLibrary(demo);
  // An AUTO play of Fixture A, played to its result, for its play log.
  await demo.setOption(PLAY_OPTIONS, 'Auto play', true);
  await demo.browseTo(SONGS, 'Fixture A');
  await demo.key('Enter');
  await demo.waitForResult(0);
  const playlog = await demo.lastPlaylog();
  if (playlog === undefined) throw new Error('the play recorded no log');
  expect(playlog.play.mode).toBe('auto');
  await demo.leaveResult();
  await demo.waitFor((current) => current.scene.kind === 'select', 'the select screen');
  // With Auto play off, a play F5 started without the replay's own mode would be a live manual play.
  await demo.setOption(PLAY_OPTIONS, 'Auto play', false);

  await demo.dropText('fixture-a.bmplay.json', JSON.stringify(playlog));
  let state = await underWay(demo);
  expect(state.status).toBe('Replaying: Fixture A');
  expect(state.play).toMatchObject({ title: 'Fixture A', autoPlay: true, replay: true });
  state = await restart(demo);
  expect(state.status).toBe('Replaying: Fixture A');
  expect(state.play).toMatchObject({ title: 'Fixture A', autoPlay: true, replay: true });
});

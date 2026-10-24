import { COURSES, expect, openWithLibrary, SONGS, test } from './support.ts';

/**
 * A navigation the scenes did not ask for ends the run on stage (the scene router's `onInterrupt`, ADR 0006), on the
 * built-in family: a skin dropped during a GRADE stage ends the course, so the next single play is a single play and
 * not the course's next stage. The Debug Menu's skin controls are disabled during the play meanwhile, since going back
 * to the select screen would end it.
 */

const PLAY_OPTIONS = ['Play options'];
const SKIN = ['Skin & display'];

test('a skin dropped during a GRADE stage ends the course, and the next chart plays as a single play', async ({
  player,
}) => {
  await openWithLibrary(player);
  await player.setOption(PLAY_OPTIONS, 'Auto play', true);
  await player.browseTo(COURSES, 'FIX GRADE');
  await player.key('Enter');
  let state = await player.waitFor(
    (current) =>
      current.scene.kind === 'play' &&
      current.play?.course?.name === 'FIX GRADE' &&
      (current.play.judged?.pgreat ?? 0) >= 1,
    'FIX GRADE stage 1 under way',
  );
  expect(state.play?.course).toMatchObject({ stage: 1, stageCount: 3 });
  // The skin controls would take the play off the stage: they wait for it to end.
  for (const name of ['Skin system', 'Built-in skin', 'Skin effects']) {
    expect(await player.optionEnabled(SKIN, name)).toBe(false);
  }

  // A drop is not locked: the LR2 fixture theme lands, and its select screen takes over from the stage.
  await player.drop('skins/lr2');
  state = await player.waitFor(
    (current) => current.scene.kind === 'select' && current.scene.family === 'lr2',
    'the LR2 select screen',
  );
  expect(state.results).toHaveLength(0);
  // The course is over: the cursor is back on its bar, and the skin controls can be changed again.
  expect(state.cursor?.folderPath).toEqual([COURSES]);
  expect(state.cursor?.bar).toMatchObject({ kind: 'course', title: 'FIX GRADE' });
  expect(await player.optionEnabled(SKIN, 'Skin system')).toBe(true);

  // A chart started now is a single play: no course stage, and a single play's result.
  await player.browseTo(SONGS, 'Fixture A');
  await player.key('Enter');
  state = await player.waitFor(
    (current) => current.scene.kind === 'play' && current.play?.title === 'Fixture A',
    'Fixture A to play',
  );
  expect(state.play?.course).toBeUndefined();
  state = await player.waitForResult(0);
  expect(state.results.at(-1)).toMatchObject({ run: 'single', title: 'Fixture A' });
  // Leaving the result goes back to the select screen, not on to a next stage.
  await player.leaveResult();
  state = await player.waitFor((current) => current.scene.kind === 'select', 'the select screen');
  expect(state.results).toHaveLength(1);
});

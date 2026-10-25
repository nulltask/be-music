import { COURSES, expect, openWithLibrary, SMOKE, SONGS, test } from './support.ts';

/**
 * A navigation the scenes did not ask for ends the run on stage (the scene router's `onInterrupt`, ADR 0006): files
 * dropped during a GRADE stage end the course, so the next single play is a single play and not the course's next
 * stage. A skin dropped during the play is not one: the play goes on in the new family, as the Debug Menu's Skin system
 * does, while its other skin controls are disabled since they would end it.
 */

const PLAY_OPTIONS = ['Play options'];
const SKIN = ['Skin & display'];

test(
  'a skin dropped during a GRADE stage keeps the play, files dropped end the course, and the next chart plays as a single play',
  SMOKE,
  async ({ demo }) => {
    await openWithLibrary(demo);
    await demo.setOption(PLAY_OPTIONS, 'Auto play', true);
    await demo.browseTo(COURSES, 'FIX GRADE');
    await demo.key('Enter');
    // Paused once stage 1 is under way, so a slow runner does not play the course on while the skin loads.
    let state = await demo.keyWhen(
      (current) =>
        current.scene.kind === 'play' &&
        current.play?.course?.name === 'FIX GRADE' &&
        (current.play.judged?.pgreat ?? 0) >= 1,
      undefined,
      'Space',
      'FIX GRADE stage 1 under way',
    );
    expect(state.play?.course).toMatchObject({ stage: 1, stageCount: 3 });
    // Skin system swaps the drawing family under the running play; the other skin controls wait for it to end.
    expect(await demo.optionEnabled(SKIN, 'Skin system')).toBe(true);
    for (const name of ['Built-in skin', 'Skin effects']) {
      expect(await demo.optionEnabled(SKIN, name)).toBe(false);
    }

    // A skin dropped during the play draws it in the new family and keeps the chart and the course run.
    await demo.drop('skins/lr2');
    state = await demo.waitFor(
      (current) => current.scene.kind === 'play' && current.scene.family === 'lr2',
      'the stage drawn by the LR2 theme',
    );
    expect(state.play?.course).toMatchObject({ name: 'FIX GRADE', stage: 1 });
    expect(state.results).toHaveLength(0);

    // Files dropped from outside are a navigation the scenes did not ask for: they end the run.
    await demo.drop('songs', { prefix: SONGS });
    state = await demo.waitFor(
      (current) => current.scene.kind === 'select' && current.scene.family === 'lr2',
      'the LR2 select screen',
    );
    expect(state.results).toHaveLength(0);
    expect(await demo.optionEnabled(SKIN, 'Built-in skin')).toBe(true);

    // A chart started now is a single play: no course stage, and a single play's result.
    await demo.browseTo(SONGS, 'Fixture A');
    await demo.key('Enter');
    state = await demo.waitFor(
      (current) => current.scene.kind === 'play' && current.play?.title === 'Fixture A',
      'Fixture A to play',
    );
    expect(state.play?.course).toBeUndefined();
    state = await demo.waitForResult(0);
    expect(state.results.at(-1)).toMatchObject({ run: 'single', title: 'Fixture A' });
    // Leaving the result goes back to the select screen, not on to a next stage.
    await demo.leaveResult();
    state = await demo.waitFor((current) => current.scene.kind === 'select', 'the select screen');
    expect(state.results).toHaveLength(1);
  },
);

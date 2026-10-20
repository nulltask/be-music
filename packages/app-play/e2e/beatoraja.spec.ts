import { courseFlowTests } from './course-flow.ts';
import { type Demo, expect, openWithLibrary, test } from './support.ts';

/**
 * The fixture beatoraja skin (`scripts/course-checklist/skins/beatoraja`): its select skin is 640 × 480 with AUTO
 * (act 16) at x 160-300, y 10-90 from the bottom, and one skin option, so the theme shows its Skin Config panel too.
 */
const SELECT_SKIN = { width: 640, height: 480 };
const AUTO_BUTTON = { x: 230, y: 430 };

async function openBeatoraja(demo: Demo): Promise<void> {
  await openWithLibrary(demo);
  await demo.drop('skins/beatoraja');
  await demo.waitFor(
    (state) => state.scene.kind === 'select' && state.scene.family === 'beatoraja',
    'the beatoraja select',
  );
}

courseFlowTests({
  name: 'beatoraja',
  family: 'beatoraja',
  open: openBeatoraja,
  startAuto: (demo) => demo.clickSkin(AUTO_BUTTON.x, AUTO_BUTTON.y, SELECT_SKIN.width, SELECT_SKIN.height),
  // beatoraja has no NONSTOP course of its own: the stitched play and its result show on the theme's play and result
  // skins, with the theme's clear / fail jingles.
  nonstop: { play: 'beatoraja', result: 'beatoraja' },
  jingles: { courseClear: 'beatoraja:courseClear', courseFail: 'beatoraja:courseFail', clear: 'beatoraja:clear' },
  playTime: false,
});

test('the Debug Menu helpers find their controls past the Skin Config panel of a beatoraja theme', async ({ demo }) => {
  await openBeatoraja(demo);
  // The theme's Skin Config panel is another lil-gui root, ahead of the Debug Menu's.
  await expect(demo.page.locator('.lil-gui.lil-root > .lil-title', { hasText: 'Skin Config (Select)' })).toHaveCount(1);
  await demo.setOption(['Play options'], 'Auto play', true);
  expect(await demo.readOption(['Play options'], 'Auto play')).toBe(true);
  await demo.setOption(['Play options'], 'Auto play', false);
  expect(await demo.readOption(['Play options'], 'Auto play')).toBe(false);
});

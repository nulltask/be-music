import { courseFlowTests } from './course-flow.ts';
import { openWithLibrary } from './support.ts';

/**
 * The fixture beatoraja skin (`scripts/course-checklist/skins/beatoraja`): its select skin is 640 × 480 with AUTO
 * (act 16) at x 160-300, y 10-90 from the bottom.
 */
const SELECT_SKIN = { width: 640, height: 480 };
const AUTO_BUTTON = { x: 230, y: 430 };

courseFlowTests({
  name: 'beatoraja',
  family: 'beatoraja',
  open: async (demo) => {
    await openWithLibrary(demo);
    await demo.drop('skins/beatoraja');
    await demo.waitFor(
      (state) => state.scene.kind === 'select' && state.scene.family === 'beatoraja',
      'the beatoraja select',
    );
  },
  startAuto: (demo) => demo.clickSkin(AUTO_BUTTON.x, AUTO_BUTTON.y, SELECT_SKIN.width, SELECT_SKIN.height),
  // beatoraja has no NONSTOP course of its own: the stitched play and its result show on the theme's play and result
  // skins, with the theme's clear / fail jingles.
  nonstop: { play: 'beatoraja', result: 'beatoraja' },
  jingles: { courseClear: 'beatoraja:courseClear', courseFail: 'beatoraja:courseFail', clear: 'beatoraja:clear' },
  playTime: false,
});

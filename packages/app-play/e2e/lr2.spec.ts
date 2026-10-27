import { courseFlowTests } from './course-flow.ts';
import { openWithLibrary } from './support.ts';

/** The fixture LR2 theme (`scripts/course-checklist/skins/lr2`): its select skin is 640 × 480, AUTO at (160, 390). */
const SELECT_SKIN = { width: 640, height: 480 };
const AUTO_BUTTON = { x: 230, y: 430 };

courseFlowTests({
  name: 'LR2',
  family: 'lr2',
  open: async (player) => {
    await openWithLibrary(player);
    await player.drop('skins/lr2');
    await player.waitFor((state) => state.scene.kind === 'select' && state.scene.family === 'lr2', 'the LR2 select');
  },
  startAuto: (player) => player.clickSkin(AUTO_BUTTON.x, AUTO_BUTTON.y, SELECT_SKIN.width, SELECT_SKIN.height),
  nonstop: { play: 'lr2', result: 'lr2' },
  jingles: { courseClear: 'lr2:courseClear', courseFail: 'lr2:courseFail', clear: 'lr2:clear' },
  playTime: true,
});

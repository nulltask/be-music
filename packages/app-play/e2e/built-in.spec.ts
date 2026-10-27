import { courseFlowTests } from './course-flow.ts';
import { openWithLibrary } from './support.ts';

courseFlowTests({
  name: 'built-in',
  family: 'built-in',
  open: (player) => openWithLibrary(player),
  // A course started from its bar follows the Debug Menu's auto play.
  startAuto: async (player) => {
    await player.setOption(['Play options'], 'Auto play', true);
    await player.key('Enter');
  },
  nonstop: { play: 'built-in', result: 'built-in' },
  playTime: true,
});

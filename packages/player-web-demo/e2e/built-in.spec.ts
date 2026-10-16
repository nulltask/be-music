import { courseFlowTests } from './course-flow.ts';
import { openWithLibrary } from './support.ts';

courseFlowTests({
  name: 'built-in',
  family: 'built-in',
  open: (demo) => openWithLibrary(demo),
  // A course started from its bar follows the Debug Menu's auto play.
  startAuto: async (demo) => {
    await demo.setOption(['Play options'], 'Auto play', true);
    await demo.key('Enter');
  },
  nonstop: { play: 'built-in', result: 'built-in' },
  playTime: true,
});

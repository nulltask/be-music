import * as lr2StateApi from '@be-music/lr2-skin/state';
import type { CourseView } from '@be-music/scene-model';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const BENCH_COURSE: CourseView = {
  kind: 'grade',
  title: 'Bench Dan',
  stages: [
    { title: 'Bench 1', subtitle: '[ANOTHER]', level: 10, difficulty: 4 },
    { title: 'Bench 2', level: 11, difficulty: 4 },
    { title: 'Bench 3', level: 12, difficulty: 5 },
  ],
  stageIndex: 0,
};
const BENCH_NONSTOP: CourseView = { ...BENCH_COURSE, kind: 'nonstop', connections: ['cut', 'blank1'] };
const BENCH_DRAFT = {
  kind: 'nonstop' as const,
  name: 'Bench',
  stages: [{ md5: '0123456789abcdef0123456789abcdef', keyMode: 7, title: 'Bench' }],
};

/** Cases for `@be-music/lr2-skin/state`, keyed `lr2-skin.state.<export>`. */
export function registerLr2SkinStateExportsCases(define: DefineBenchmarkCase): void {
  define('lr2-skin.state.lr2ShowsCourseCombo', {
    run: () => {
      lr2StateApi.lr2ShowsCourseCombo('grade');
    },
  });
  define('lr2-skin.state.resolveLr2CourseConnectionText', {
    run: () => {
      lr2StateApi.resolveLr2CourseConnectionText(171, BENCH_NONSTOP);
      lr2StateApi.resolveLr2CourseConnectionText(172, BENCH_COURSE);
    },
  });
  define('lr2-skin.state.resolveLr2CourseDraftInfo', {
    run: () => {
      lr2StateApi.resolveLr2CourseDraftInfo(BENCH_DRAFT, 'Type the course title');
    },
  });
  define('lr2-skin.state.resolveLr2CourseMakerAction', {
    run: () => {
      lr2StateApi.resolveLr2CourseMakerAction(230);
      lr2StateApi.resolveLr2CourseMakerAction(244);
    },
  });
  define('lr2-skin.state.resolveLr2CourseMakerButtonState', {
    run: () => {
      lr2StateApi.resolveLr2CourseMakerButtonState(240, BENCH_NONSTOP, 'fade');
      lr2StateApi.resolveLr2CourseMakerButtonState(268, undefined, 'blank1');
    },
  });
  define('lr2-skin.state.resolveLr2CourseMakerOps', {
    run: () => {
      lr2StateApi.resolveLr2CourseMakerOps(BENCH_DRAFT);
      lr2StateApi.resolveLr2CourseMakerOps(undefined, 3);
    },
  });
  define('lr2-skin.state.resolveLr2CourseMakerText', {
    run: () => {
      lr2StateApi.resolveLr2CourseMakerText(198, 'cut');
    },
  });
  define('lr2-skin.state.resolveLr2CourseNumber', {
    run: () => {
      lr2StateApi.resolveLr2CourseNumber(250, BENCH_COURSE);
    },
  });
  define('lr2-skin.state.resolveLr2CourseOps', {
    run: () => {
      lr2StateApi.resolveLr2CourseOps(BENCH_COURSE);
    },
  });
  define('lr2-skin.state.resolveLr2CourseStageDifficultyOps', {
    run: () => {
      lr2StateApi.resolveLr2CourseStageDifficultyOps(BENCH_COURSE);
      lr2StateApi.resolveLr2CourseStageDifficultyOps(undefined);
    },
  });
  define('lr2-skin.state.resolveLr2CourseText', {
    run: () => {
      lr2StateApi.resolveLr2CourseText(150, BENCH_COURSE);
      lr2StateApi.resolveLr2CourseText(170, BENCH_COURSE);
    },
  });
  define('lr2-skin.state.resolveLr2JudgeCombo', {
    run: () => {
      lr2StateApi.resolveLr2JudgeCombo(12, 340, 'grade');
      lr2StateApi.resolveLr2JudgeCombo(12, 340, 'nonstop');
    },
  });
  define('lr2-skin.state.resolveLr2NonstopStage', {
    run: () => {
      lr2StateApi.resolveLr2NonstopStage(
        [
          { windowStart: 0, lr2StageMarker: false },
          { windowStart: 20, lr2StageMarker: true },
        ],
        25,
      );
    },
  });
}

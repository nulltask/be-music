import { createEmptyJson } from '@be-music/json';
import * as lr2StateApi from '@be-music/lr2-skin/state';
import { createEmptyScore } from '@be-music/player/core/scoring';
import type { Lr2BarBodySource } from '@be-music/lr2-skin';
import { DEFAULT_PLAY_OPTIONS, type CourseView, type LibraryChart, type LibraryEntry } from '@be-music/scene-model';
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

const BENCH_CHART: LibraryChart = {
  id: 'bench:song',
  sourceId: 'bench',
  sourceLabel: 'bench',
  sourceKind: 'files',
  chartPath: 'Songs/Bench/main.bms',
  directoryLabel: 'Bench',
  fileLabel: 'main.bms',
  title: 'Bench',
  playLevel: 7,
  bpm: 150,
  totalNotes: 500,
  chart: createEmptyJson(),
};
const BENCH_ENTRY: LibraryEntry = { kind: 'song', song: BENCH_CHART };
const BENCH_BAR_BODIES = [
  { kind: 'song', source: { imagePath: 'song.png' } },
  { kind: 'folder', source: { imagePath: 'folder.png' } },
] as unknown as Lr2BarBodySource[];
const BENCH_CLOCK = { year: 2026, month: 10, day: 16, hour: 9, minute: 5, second: 30 };
const BENCH_PLAY_SETUP: lr2StateApi.Lr2PlaySetup = {
  chart: BENCH_CHART,
  lanes: { playVariant: '7', channels: ['11', '12', '16', '18'] },
  features: { longNote: true, bpmChange: false, bga: true },
  options: {
    autoPlay: false,
    autoScratch1P: false,
    autoScratch2P: false,
    scoreGraph: true,
    bga: 'ON',
    bgaSize: 'EXTEND',
  },
  gauge: 'GROOVE',
  course: BENCH_COURSE,
};
const BENCH_PLAY_FRAME: lr2StateApi.Lr2PlayFrame = {
  play: { gauge: 54, combo: 12, maxCombo: 30, totalSeconds: 120, view: { hiSpeed: { player: 2.5 } } },
  score: { ...createEmptyScore(500), perfect: 100, great: 20, exScore: 220, score: 50000 },
  seconds: 75,
  fps: 60,
};
const BENCH_LANE = { channel: '13', laneIndex: 3, playVariant: '7' as const };

/** Cases for `@be-music/lr2-skin/state`, keyed `lr2-skin.state.<export>`. */
export function registerLr2SkinStateExportsCases(define: DefineBenchmarkCase): void {
  define('lr2-skin.state.lr2CourseMatchesKeysFilter', {
    run: () => {
      lr2StateApi.lr2CourseMatchesKeysFilter({ definition: { keyMode: 7 } }, 160);
    },
  });
  define('lr2-skin.state.pickLr2BarBody', {
    run: () => {
      lr2StateApi.pickLr2BarBody(BENCH_BAR_BODIES, BENCH_ENTRY);
      lr2StateApi.pickLr2BarBody(BENCH_BAR_BODIES, undefined);
    },
  });
  define('lr2-skin.state.resolveLr2BarLamp', {
    run: () => {
      lr2StateApi.resolveLr2BarLamp('EX_HARD');
    },
  });
  define('lr2-skin.state.resolveLr2BarLevel', {
    run: () => {
      lr2StateApi.resolveLr2BarLevel(BENCH_CHART);
    },
  });
  define('lr2-skin.state.resolveLr2ChartFeatures', {
    run: () => {
      lr2StateApi.resolveLr2ChartFeatures(BENCH_CHART.chart);
    },
  });
  define('lr2-skin.state.resolveLr2DecideState', {
    run: () => {
      const state = lr2StateApi.resolveLr2DecideState({ chart: BENCH_CHART, course: BENCH_COURSE });
      state.text(10);
      state.text(150);
    },
  });
  define('lr2-skin.state.resolveLr2GaugeRangeOp', {
    run: () => {
      lr2StateApi.resolveLr2GaugeRangeOp(54);
    },
  });
  define('lr2-skin.state.resolveLr2GaugeTypeOps', {
    run: () => {
      lr2StateApi.resolveLr2GaugeTypeOps('HARD');
    },
  });
  define('lr2-skin.state.resolveLr2LaneTimer', {
    run: () => {
      lr2StateApi.resolveLr2LaneTimer('bomb', BENCH_LANE);
      lr2StateApi.resolveLr2LaneTimer('key-on', BENCH_LANE);
    },
  });
  define('lr2-skin.state.resolveLr2PlayKeyModeOp', {
    run: () => {
      lr2StateApi.resolveLr2PlayKeyModeOp(BENCH_PLAY_SETUP.lanes);
    },
  });
  define('lr2-skin.state.resolveLr2PlayState', {
    run: () => {
      const state = lr2StateApi.resolveLr2PlayState(BENCH_PLAY_SETUP, BENCH_PLAY_FRAME);
      state.number(101);
      state.number(104);
      state.text(10);
      state.slider(6);
      state.bargraph(10);
    },
  });
  define('lr2-skin.state.resolveLr2PlayTimers', {
    run: () => {
      lr2StateApi.resolveLr2PlayTimers({ kind: 'gauge', previous: 98, next: 100, at: 0 });
      lr2StateApi.resolveLr2PlayTimers({ kind: 'lane', bank: 'bomb', lane: BENCH_LANE, at: 0 });
    },
  });
  define('lr2-skin.state.resolveLr2RankOp', {
    run: () => {
      lr2StateApi.resolveLr2RankOp(BENCH_PLAY_FRAME.score);
    },
  });
  define('lr2-skin.state.resolveLr2KeyModeOp', {
    run: () => {
      lr2StateApi.resolveLr2KeyModeOp(BENCH_CHART);
    },
  });
  define('lr2-skin.state.resolveLr2LampOp', {
    run: () => {
      lr2StateApi.resolveLr2LampOp('FULL_COMBO');
    },
  });
  define('lr2-skin.state.resolveLr2SelectButton', {
    run: () => {
      lr2StateApi.resolveLr2SelectButton(12);
      lr2StateApi.resolveLr2SelectButton(93);
    },
  });
  define('lr2-skin.state.resolveLr2SelectState', {
    run: () => {
      const state = lr2StateApi.resolveLr2SelectState({
        focused: BENCH_ENTRY,
        options: DEFAULT_PLAY_OPTIONS,
        record: { lamp: 'HARD' },
        openPanels: [1],
        bpmRange: { min: 150, max: 150 },
        clock: BENCH_CLOCK,
        fps: 60,
      });
      state.number(74);
      state.text(10);
      state.button(40);
      state.slider(2);
    },
  });
  define('lr2-skin.state.resolveLr2SelectTimers', {
    run: () => {
      lr2StateApi.resolveLr2SelectTimers({ kind: 'cursor', delta: 1, at: 0 });
      lr2StateApi.resolveLr2SelectTimers({ kind: 'panel', panel: 1, open: true, at: 0 });
    },
  });
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

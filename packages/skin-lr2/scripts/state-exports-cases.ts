import { createEmptyJSON } from '@be-music/chart-source';
import * as lr2StateAPI from '@be-music/skin-lr2/state';
import { createEmptyScore } from '@be-music/player-engine/ruleset';
import type { LR2BarBodySource } from '@be-music/skin-lr2';
import {
  DEFAULT_PLAY_OPTIONS,
  type CourseView,
  type LibraryChart,
  type LibraryEntry,
  type PlayResult,
} from '@be-music/player-scene-model';
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
  chart: createEmptyJSON(),
};
const BENCH_ENTRY: LibraryEntry = { kind: 'chart', chart: BENCH_CHART };
const BENCH_BAR_BODIES = [
  { kind: 'song', source: { imagePath: 'song.png' } },
  { kind: 'folder', source: { imagePath: 'folder.png' } },
] as unknown as LR2BarBodySource[];
const BENCH_AUTO_SCRATCH_OPS: ReadonlySet<number> = new Set([55]);
const BENCH_CLOCK = { year: 2026, month: 10, day: 16, hour: 9, minute: 5, second: 30 };
const BENCH_PLAY_SETUP: lr2StateAPI.LR2PlaySetup = {
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
const BENCH_PLAY_FRAME: lr2StateAPI.LR2PlayFrame = {
  play: { gauge: 54, combo: 12, maxCombo: 30, totalSeconds: 120, view: { hiSpeed: { player: 2.5 } } },
  score: { ...createEmptyScore(500), perfect: 100, great: 20, exScore: 220, score: 50000 },
  seconds: 75,
  fps: 60,
};
const BENCH_LANE = { channel: '13', laneIndex: 3, playVariant: '7' as const };
const BENCH_RESULT: PlayResult = {
  score: BENCH_PLAY_FRAME.score,
  maxCombo: 120,
  gauge: 84,
  cleared: true,
  playSeconds: 118,
  chart: BENCH_CHART,
  gaugeHistory: [],
  scoreHistory: [],
  lamp: 'NORMAL',
};

/** Cases for `@be-music/skin-lr2/state`, keyed `skin-lr2.state.<export>`. */
export function registerLR2SkinStateExportsCases(define: DefineBenchmarkCase): void {
  define('skin-lr2.state.isLR2AutoLane', {
    run: () => {
      lr2StateAPI.isLR2AutoLane(0, BENCH_AUTO_SCRATCH_OPS);
    },
  });
  define('skin-lr2.state.pickLR2BarBody', {
    run: () => {
      lr2StateAPI.pickLR2BarBody(BENCH_BAR_BODIES, BENCH_ENTRY);
      lr2StateAPI.pickLR2BarBody(BENCH_BAR_BODIES, undefined);
    },
  });
  define('skin-lr2.state.resolveLR2BarLamp', {
    run: () => {
      lr2StateAPI.resolveLR2BarLamp('EX_HARD');
    },
  });
  define('skin-lr2.state.resolveLR2BarLevel', {
    run: () => {
      lr2StateAPI.resolveLR2BarLevel(BENCH_CHART);
    },
  });
  define('skin-lr2.state.resolveLR2ChartFeatures', {
    run: () => {
      lr2StateAPI.resolveLR2ChartFeatures(BENCH_CHART.chart);
    },
  });
  define('skin-lr2.state.resolveLR2DecideState', {
    run: () => {
      const state = lr2StateAPI.resolveLR2DecideState({ chart: BENCH_CHART, course: BENCH_COURSE });
      state.text(10);
      state.text(150);
    },
  });
  define('skin-lr2.state.resolveLR2DecideTimers', {
    run: () => {
      lr2StateAPI.resolveLR2DecideTimers({
        clock: { nowMs: 1450, enteredAtMs: 1000 },
        inputOpenAtMs: 1300,
        leaving: { atMs: 1400 },
      });
    },
  });
  define('skin-lr2.state.resolveLR2GaugeRangeOp', {
    run: () => {
      lr2StateAPI.resolveLR2GaugeRangeOp(54);
    },
  });
  define('skin-lr2.state.resolveLR2GaugeTypeOps', {
    run: () => {
      lr2StateAPI.resolveLR2GaugeTypeOps('HARD');
    },
  });
  define('skin-lr2.state.resolveLR2LaneTimer', {
    run: () => {
      lr2StateAPI.resolveLR2LaneTimer('bomb', BENCH_LANE);
      lr2StateAPI.resolveLR2LaneTimer('key-on', BENCH_LANE);
    },
  });
  define('skin-lr2.state.resolveLR2PlayKeyModeOp', {
    run: () => {
      lr2StateAPI.resolveLR2PlayKeyModeOp(BENCH_PLAY_SETUP.lanes);
    },
  });
  define('skin-lr2.state.resolveLR2PlayState', {
    run: () => {
      const state = lr2StateAPI.resolveLR2PlayState(BENCH_PLAY_SETUP, BENCH_PLAY_FRAME);
      state.number(101);
      state.number(104);
      state.text(10);
      state.slider(6);
      state.bargraph(10);
    },
  });
  define('skin-lr2.state.resolveLR2PlayTimers', {
    run: () => {
      lr2StateAPI.resolveLR2PlayTimers({ kind: 'gauge', previous: 98, next: 100, at: 0 });
      lr2StateAPI.resolveLR2PlayTimers({ kind: 'lane', bank: 'bomb', lane: BENCH_LANE, at: 0 });
    },
  });
  define('skin-lr2.state.resolveLR2ResultState', {
    run: () => {
      const state = lr2StateAPI.resolveLR2ResultState({
        result: BENCH_RESULT,
        course: BENCH_COURSE,
        flipResult: false,
      });
      state.number(171);
      state.text(10);
      state.bargraph(2);
    },
  });
  define('skin-lr2.state.resolveLR2ResultTimers', {
    run: () => {
      lr2StateAPI.resolveLR2ResultTimers({
        clock: { nowMs: 5000, enteredAtMs: 1000 },
        inputOpenAtMs: 1300,
        graphShownAtMs: 2000,
        updateShownAtMs: 4000,
      });
    },
  });
  define('skin-lr2.state.resolveLR2GraphReveal', {
    run: () => {
      lr2StateAPI.resolveLR2GraphReveal(1250, 500, 2000);
    },
  });
  define('skin-lr2.state.resolveLR2RankOp', {
    run: () => {
      lr2StateAPI.resolveLR2RankOp(BENCH_PLAY_FRAME.score);
    },
  });
  define('skin-lr2.state.resolveLR2KeyModeOp', {
    run: () => {
      lr2StateAPI.resolveLR2KeyModeOp(BENCH_CHART);
    },
  });
  define('skin-lr2.state.resolveLR2LampOp', {
    run: () => {
      lr2StateAPI.resolveLR2LampOp('FULL_COMBO');
    },
  });
  define('skin-lr2.state.resolveLR2SelectButton', {
    run: () => {
      lr2StateAPI.resolveLR2SelectButton(12);
      lr2StateAPI.resolveLR2SelectButton(93);
    },
  });
  define('skin-lr2.state.resolveLR2SelectState', {
    run: () => {
      const state = lr2StateAPI.resolveLR2SelectState({
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
  define('skin-lr2.state.resolveLR2SelectTimers', {
    run: () => {
      lr2StateAPI.resolveLR2SelectTimers({ kind: 'cursor', delta: 1, at: 0 });
      lr2StateAPI.resolveLR2SelectTimers({ kind: 'panel', panel: 1, open: true, at: 0 });
    },
  });
  define('skin-lr2.state.lr2ShowsCourseCombo', {
    run: () => {
      lr2StateAPI.lr2ShowsCourseCombo('grade');
    },
  });
  define('skin-lr2.state.resolveLR2CourseConnectionText', {
    run: () => {
      lr2StateAPI.resolveLR2CourseConnectionText(171, BENCH_NONSTOP);
      lr2StateAPI.resolveLR2CourseConnectionText(172, BENCH_COURSE);
    },
  });
  define('skin-lr2.state.resolveLR2CourseDraftInfo', {
    run: () => {
      lr2StateAPI.resolveLR2CourseDraftInfo(BENCH_DRAFT, 'Type the course title');
    },
  });
  define('skin-lr2.state.resolveLR2CourseMakerAction', {
    run: () => {
      lr2StateAPI.resolveLR2CourseMakerAction(230);
      lr2StateAPI.resolveLR2CourseMakerAction(244);
    },
  });
  define('skin-lr2.state.resolveLR2CourseMakerButtonState', {
    run: () => {
      lr2StateAPI.resolveLR2CourseMakerButtonState(240, BENCH_NONSTOP, 'fade');
      lr2StateAPI.resolveLR2CourseMakerButtonState(268, undefined, 'blank1');
    },
  });
  define('skin-lr2.state.resolveLR2CourseMakerOps', {
    run: () => {
      lr2StateAPI.resolveLR2CourseMakerOps(BENCH_DRAFT);
      lr2StateAPI.resolveLR2CourseMakerOps(undefined, 3);
    },
  });
  define('skin-lr2.state.resolveLR2CourseMakerText', {
    run: () => {
      lr2StateAPI.resolveLR2CourseMakerText(198, 'cut');
    },
  });
  define('skin-lr2.state.resolveLR2CourseNumber', {
    run: () => {
      lr2StateAPI.resolveLR2CourseNumber(250, BENCH_COURSE);
    },
  });
  define('skin-lr2.state.resolveLR2CourseOps', {
    run: () => {
      lr2StateAPI.resolveLR2CourseOps(BENCH_COURSE);
    },
  });
  define('skin-lr2.state.resolveLR2CourseStageDifficultyOps', {
    run: () => {
      lr2StateAPI.resolveLR2CourseStageDifficultyOps(BENCH_COURSE);
      lr2StateAPI.resolveLR2CourseStageDifficultyOps(undefined);
    },
  });
  define('skin-lr2.state.resolveLR2CourseText', {
    run: () => {
      lr2StateAPI.resolveLR2CourseText(150, BENCH_COURSE);
      lr2StateAPI.resolveLR2CourseText(170, BENCH_COURSE);
    },
  });
  define('skin-lr2.state.resolveLR2JudgeCombo', {
    run: () => {
      lr2StateAPI.resolveLR2JudgeCombo(12, 340, 'grade');
      lr2StateAPI.resolveLR2JudgeCombo(12, 340, 'nonstop');
    },
  });
  define('skin-lr2.state.resolveLR2NonstopStage', {
    run: () => {
      lr2StateAPI.resolveLR2NonstopStage(
        [
          { windowStart: 0, lr2StageMarker: false },
          { windowStart: 20, lr2StageMarker: true },
        ],
        25,
      );
    },
  });
}

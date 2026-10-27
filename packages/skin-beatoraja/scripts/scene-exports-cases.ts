import * as sceneAPI from '@be-music/skin-beatoraja/scene';
import { BEATORAJA_NUM, BEATORAJA_TEXT, OFFSET_HIDDEN_COVER } from '@be-music/skin-beatoraja';
import type { LibraryChart, LibraryCourse, LibraryEntry, LaneCoverState } from '@be-music/player-scene-model';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

// The cases measure `@be-music/skin-beatoraja/scene`, the scene mapping a skin view asks every frame. The parser and
// theme loader of the package's main entry are measured in `exports-cases.ts`.

const BENCH_COVER: LaneCoverState = {
  side: '1P',
  sudden: 0.25,
  suddenOn: true,
  hidden: 0.2,
  hiddenOn: true,
  lift: 0.1,
};
const BENCH_SCORE: sceneAPI.BeatorajaScoreInput = {
  total: 1200,
  perfect: 900,
  great: 200,
  good: 50,
  bad: 20,
  poor: 30,
  exScore: 2000,
  score: 180_000,
  fast: 120,
  slow: 130,
};
const BENCH_GAUGE: sceneAPI.BeatorajaGaugeInput = {
  current: 82,
  max: 100,
  clearThreshold: 80,
  effectiveTotal: 300,
  type: 'GROOVE',
};
const BENCH_BPM_SEGMENTS: readonly sceneAPI.BeatorajaBPMSegment[] = Array.from({ length: 64 }, (_, index) => ({
  timeMs: index * 2000,
  bpm: index % 9 === 8 ? 0 : 120 + (index % 5) * 20,
}));
const BENCH_CHART_FACTS: sceneAPI.BeatorajaPlayChartFacts = {
  bpm: 150,
  mainBPM: 150,
  minBPM: 120,
  maxBPM: 200,
  bpmSegments: BENCH_BPM_SEGMENTS,
  playLevel: 12,
};
const BENCH_TIMINGS = Array.from({ length: 1200 }, (_, index) => ({
  deltaMs: ((index * 37) % 61) - 30,
  judge: index % 7 === 0 ? 'GREAT' : 'PERFECT',
}));
const BENCH_PLAY_NUMBERS: sceneAPI.BeatorajaPlayNumberInput = {
  score: BENCH_SCORE,
  gauge: BENCH_GAUGE,
  combo: 321,
  maxCombo: 654,
  earlyLate: { PERFECT: { early: 400, late: 500 }, GREAT: { early: 90, late: 110 } },
  chartTotal: 300,
  hiSpeed: 2.5,
  cover: BENCH_COVER,
  chart: BENCH_CHART_FACTS,
  clock: { currentSeconds: 64.5, totalSeconds: 128 },
  lastJudgeDeltaMs: -7.5,
  plateCombos: [321, 0, 0],
  wallClock: { year: 2026, month: 10, day: 16, hour: 12, minute: 34, second: 56 },
  operatingMs: 3_725_000,
  fps: 120,
};
const BENCH_BREAKDOWN: sceneAPI.BeatorajaNoteBreakdown = { normal: 900, ln: 150, scratch: 120, bss: 30 };
const BENCH_SCORE_HISTORY = Array.from({ length: 1200 }, (_, index) => ({
  progress: index / 1200,
  exScore: Math.round((index * 2000) / 1200),
}));
const BENCH_GAUGE_HISTORY = Array.from({ length: 1200 }, (_, index) => ({
  progress: index / 1200,
  value: 20 + ((index * 3) % 80),
}));
const BENCH_DISTRIBUTION = {
  buckets: Array.from({ length: 128 }, (_, index) => [1, 2, 3, 1, 4, 8 + (index % 5), 0]),
  totalMs: 128_000,
};
const BENCH_JUDGE_STATE_GRAPH = sceneAPI.createBeatorajaJudgeStateGraph(BENCH_DISTRIBUTION)!;
const BENCH_PLACEMENT = sceneAPI.resolveBeatorajaLanePlacement('13', '7', 3);
const BENCH_OFFSET_INPUT: sceneAPI.BeatorajaPlayOffsetInput = {
  cover: BENCH_COVER,
  laneHeight: 580,
  maxCombo: 654,
  comboDigits: { 1: { width: 40, space: 0 }, 2: { width: 40, space: 0 } },
};
const BENCH_OFFSET = { x: 0, y: 0, a: 0 };
const BENCH_COURSE_VIEW = {
  kind: 'grade' as const,
  title: 'Bench Dan',
  stages: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }, { title: 'Four' }],
  stageIndex: 2,
};
const BENCH_RESULT: sceneAPI.BeatorajaResultInput = {
  result: {
    score: BENCH_SCORE,
    fast: 120,
    slow: 130,
    maxCombo: 654,
    cleared: true,
    lamp: 'NORMAL',
    gaugeHistory: BENCH_GAUGE_HISTORY,
    scoreHistory: BENCH_SCORE_HISTORY,
    judgeTimings: BENCH_TIMINGS,
    course: BENCH_COURSE_VIEW,
  },
  gauge: BENCH_GAUGE,
  chartTotal: 300,
  breakdown: BENCH_BREAKDOWN,
  chart: { title: 'Bench', subtitle: '[ANOTHER]', artist: 'be-music', genre: 'BENCH' },
  skin: { name: 'Bench Skin', author: 'be-music' },
};
const BENCH_SONG: LibraryChart = {
  id: 'bench',
  sourceId: 'source',
  sourceLabel: 'Bench',
  sourceKind: 'directory',
  chartPath: 'Pack/bench.bms',
  directoryLabel: 'Pack',
  fileLabel: 'bench.bms',
  title: 'Bench',
  subtitle: '[ANOTHER]',
  artist: 'be-music',
  playLevel: 12,
  bpm: 150,
  totalNotes: 1200,
  chart: { metadata: { difficulty: 4 } } as unknown as LibraryChart['chart'],
};
const BENCH_DECIDE: sceneAPI.BeatorajaDecideInput = { chart: BENCH_SONG, mainBPM: 180, progress: 0.5 };
const BENCH_COURSE: LibraryCourse = {
  id: 'Dan#0',
  definition: {
    name: 'Bench Dan',
    kind: 'grade',
    stages: [],
    constraints: ['grade_mirror', 'gauge_lr2', 'no_speed'],
    trophies: [],
    release: true,
    source: { format: 'beatoraja-json' },
  },
  stages: [{ title: 'One', chart: BENCH_SONG }, { title: 'Two' }],
  playable: false,
};
const BENCH_SELECT_FACTS: sceneAPI.BeatorajaSelectChartFacts = {
  playVariant: '7',
  traits: { longNote: true, bga: true, bpmChange: true, random: false, stop: true, stageFile: true, banner: false },
  difficulty: 4,
  judgeRank: 2,
  total: 300,
  lnMode: 2,
  subartist: 'obj: bench',
  noteBreakdown: BENCH_BREAKDOWN,
  density: { peak: { whole: 21, afterDot: 4 }, end: { whole: 9, afterDot: 0 }, average: { whole: 6, afterDot: 5 } },
  lengthSeconds: 128,
  bpmRange: { min: 120, max: 200 },
  mainBPM: 180,
};
const BENCH_SONG_BAR: LibraryEntry = { kind: 'chart', chart: BENCH_SONG };
const BENCH_SELECT: sceneAPI.BeatorajaSelectInput = {
  focused: BENCH_SONG_BAR,
  chart: BENCH_SELECT_FACTS,
  folderLabel: 'Pack',
  searchText: 'bench',
  list: { keysFilter: 'KEYS_7', sort: 'LEVEL' },
  skin: { name: 'Bench Skin', author: 'be-music' },
  judgeTiming: -10,
  wallClock: { year: 2026, month: 10, day: 16, hour: 12, minute: 34, second: 56 },
};
const BENCH_COURSE_SELECT: sceneAPI.BeatorajaSelectInput = {
  ...BENCH_SELECT,
  focused: { kind: 'course', course: BENCH_COURSE },
};
const BENCH_FILES = new Map<string, Uint8Array>(
  [
    'Theme/sound/Cursor.wav',
    'sound/decide.ogg',
    'sound/back.wav',
    'sound/f-open.wav',
    'BGM/select.ogg',
    'Theme/Sound/clear.wav',
    'Theme/Sound/fail.wav',
    'Theme/Sound/course_clear.wav',
    ...Array.from({ length: 200 }, (_, index) => `Theme/parts/image${index}.png`),
  ].map((path) => [path, new Uint8Array(0)]),
);
const BENCH_DATE = new Date(2026, 9, 16, 12, 34, 56);

export function registerBeatorajaSkinSceneExportsCases(define: DefineBenchmarkCase): void {
  // Inputs and the score numbers
  define('skin-beatoraja.scene.beatorajaWallClockOf', {
    run: () => {
      sceneAPI.beatorajaWallClockOf(BENCH_DATE);
    },
  });
  define('skin-beatoraja.scene.beatorajaScoreRate', {
    run: () => {
      sceneAPI.beatorajaScoreRate(BENCH_SCORE.exScore, 1200);
    },
  });
  define('skin-beatoraja.scene.beatorajaNotesJudged', {
    run: () => {
      sceneAPI.beatorajaNotesJudged(BENCH_SCORE);
    },
  });
  define('skin-beatoraja.scene.beatorajaChartTotalReadout', {
    run: () => {
      sceneAPI.beatorajaChartTotalReadout(BENCH_GAUGE, 300);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaScoreNumber', {
    run: () => {
      sceneAPI.resolveBeatorajaScoreNumber(BEATORAJA_NUM.EARLY_GREAT, BENCH_PLAY_NUMBERS);
    },
  });
  define('skin-beatoraja.scene.beatorajaGenericRankOps', {
    run: () => {
      sceneAPI.beatorajaGenericRankOps(BENCH_SCORE);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaPlayScoreOps', {
    run: () => {
      sceneAPI.resolveBeatorajaPlayScoreOps(BENCH_SCORE, BENCH_GAUGE);
    },
  });

  // Texts
  define('skin-beatoraja.scene.joinBeatorajaText', {
    run: () => {
      sceneAPI.joinBeatorajaText('Bench', '[ANOTHER]');
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaChartText', {
    run: () => {
      sceneAPI.resolveBeatorajaChartText(BEATORAJA_TEXT.FULLTITLE, BENCH_RESULT.chart);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaSkinText', {
    run: () => {
      sceneAPI.resolveBeatorajaSkinText(BEATORAJA_TEXT.SKIN_NAME, BENCH_RESULT.skin);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaPlayText', {
    run: () => {
      sceneAPI.resolveBeatorajaPlayText(BEATORAJA_TEXT.TITLE, { chart: BENCH_RESULT.chart, course: BENCH_COURSE_VIEW });
    },
  });

  // Play numbers and ops
  define('skin-beatoraja.scene.beatorajaBPMAt', {
    run: () => {
      sceneAPI.beatorajaBPMAt(BENCH_BPM_SEGMENTS, 77_000, 150);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaPlayNumber', {
    run: () => {
      sceneAPI.resolveBeatorajaPlayNumber(BEATORAJA_NUM.NOWBPM, BENCH_PLAY_NUMBERS);
      sceneAPI.resolveBeatorajaPlayNumber(BEATORAJA_NUM.DURATION_GREEN, BENCH_PLAY_NUMBERS);
      sceneAPI.resolveBeatorajaPlayNumber(BEATORAJA_NUM.PERFECT, BENCH_PLAY_NUMBERS);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaChartTraitOps', {
    run: () => {
      sceneAPI.resolveBeatorajaChartTraitOps(BENCH_SELECT_FACTS.traits);
    },
  });
  define('skin-beatoraja.scene.beatorajaKeysongOp', {
    run: () => {
      sceneAPI.beatorajaKeysongOp('14');
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaGaugeTypeOps', {
    run: () => {
      sceneAPI.resolveBeatorajaGaugeTypeOps('EX-HARD');
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaPlayStartOps', {
    run: () => {
      sceneAPI.resolveBeatorajaPlayStartOps({ playVariant: '7', autoPlay: false, traits: BENCH_SELECT_FACTS.traits });
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaCoverOps', {
    run: () => {
      sceneAPI.resolveBeatorajaCoverOps(BENCH_COVER, true);
    },
  });
  define('skin-beatoraja.scene.beatorajaFastSlowOp', {
    run: () => {
      sceneAPI.beatorajaFastSlowOp(2, -4);
    },
  });

  // Play timers
  define('skin-beatoraja.scene.resolveBeatorajaLanePlacement', {
    run: () => {
      sceneAPI.resolveBeatorajaLanePlacement('24', '9', 8);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaLaneTimers', {
    run: () => {
      sceneAPI.resolveBeatorajaLaneTimers('release', BENCH_PLACEMENT);
    },
  });
  define('skin-beatoraja.scene.isBeatorajaComboJudge', {
    run: () => {
      sceneAPI.isBeatorajaComboJudge('GOOD');
    },
  });
  define('skin-beatoraja.scene.isBeatorajaCleanHit', {
    run: () => {
      sceneAPI.isBeatorajaCleanHit('GREAT');
    },
  });
  define('skin-beatoraja.scene.beatorajaJudgeIndex', {
    run: () => {
      sceneAPI.beatorajaJudgeIndex('POOR');
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaJudgeEffect', {
    run: () => {
      sceneAPI.resolveBeatorajaJudgeEffect({ judge: 'PERFECT', combo: 321, deltaMs: -3 }, BENCH_PLACEMENT, 1200);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaSeekTimers', {
    run: () => {
      sceneAPI.resolveBeatorajaSeekTimers({
        started: [0, 41, 46, 446, 51, 101, 140],
        beat: 128.2,
        gauge: BENCH_GAUGE,
        lastNoteBeats: { 1: 300 },
      });
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaFrameTimers', {
    run: () => {
      sceneAPI.resolveBeatorajaFrameTimers({
        beat: 128.2,
        previousBeat: 127.9,
        gauge: BENCH_GAUGE,
        previousGauge: 81,
        lastNoteBeats: { 1: 300 },
      });
    },
  });

  // Play gauge, graphs and offsets
  define('skin-beatoraja.scene.resolveBeatorajaGaugeState', {
    run: () => {
      sceneAPI.resolveBeatorajaGaugeState(BENCH_GAUGE);
    },
  });
  define('skin-beatoraja.scene.beatorajaGaugePercent', {
    run: () => {
      sceneAPI.beatorajaGaugePercent(BENCH_GAUGE);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaPlayGraphValue', {
    run: () => {
      sceneAPI.resolveBeatorajaPlayGraphValue(2, BENCH_PLAY_NUMBERS);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaPlaySliderValue', {
    run: () => {
      sceneAPI.resolveBeatorajaPlaySliderValue(6, BENCH_PLAY_NUMBERS);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaScorePolyline', {
    run: () => {
      sceneAPI.resolveBeatorajaScorePolyline(BENCH_SCORE_HISTORY, 1200);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaGaugePolyline', {
    run: () => {
      sceneAPI.resolveBeatorajaGaugePolyline(BENCH_GAUGE_HISTORY);
    },
  });
  define('skin-beatoraja.scene.beatorajaNoteBreakdownBars', {
    run: () => {
      sceneAPI.beatorajaNoteBreakdownBars(BENCH_BREAKDOWN);
    },
  });
  define('skin-beatoraja.scene.beatorajaJudgeCountBars', {
    run: () => {
      sceneAPI.beatorajaJudgeCountBars(BENCH_SCORE);
    },
  });
  define('skin-beatoraja.scene.beatorajaTimingHistogram', {
    run: () => {
      sceneAPI.beatorajaTimingHistogram(BENCH_TIMINGS.slice(0, 50));
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaPlayJudgeGraph', {
    run: () => {
      sceneAPI.resolveBeatorajaPlayJudgeGraph(1, { breakdown: BENCH_BREAKDOWN, score: BENCH_SCORE, recentTimings: [] });
    },
  });
  define('skin-beatoraja.scene.createBeatorajaJudgeStateGraph', {
    run: () => {
      sceneAPI.createBeatorajaJudgeStateGraph(BENCH_DISTRIBUTION);
    },
  });
  define('skin-beatoraja.scene.beatorajaJudgeStateSlot', {
    run: () => {
      sceneAPI.beatorajaJudgeStateSlot('BAD');
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaJudgeStateMove', {
    run: () => {
      sceneAPI.resolveBeatorajaJudgeStateMove(BENCH_JUDGE_STATE_GRAPH, 'GREAT', 64_250);
    },
  });
  define('skin-beatoraja.scene.beatorajaLaneJudgeRef', {
    run: () => {
      sceneAPI.beatorajaLaneJudgeRef(513);
    },
  });
  define('skin-beatoraja.scene.beatorajaLaneJudgeImage', {
    run: () => {
      sceneAPI.beatorajaLaneJudgeImage(1, 120);
    },
  });
  define('skin-beatoraja.scene.writeBeatorajaPlayOffset', {
    run: () => {
      sceneAPI.writeBeatorajaPlayOffset(OFFSET_HIDDEN_COVER, BENCH_OFFSET_INPUT, BENCH_OFFSET);
    },
  });

  // Decide
  define('skin-beatoraja.scene.resolveBeatorajaDecideNumber', {
    run: () => {
      sceneAPI.resolveBeatorajaDecideNumber(BEATORAJA_NUM.PLAYLEVEL, BENCH_DECIDE);
      sceneAPI.resolveBeatorajaDecideNumber(BEATORAJA_NUM.MAINBPM, BENCH_DECIDE);
      sceneAPI.resolveBeatorajaDecideNumber(BEATORAJA_NUM.LOADING_PROGRESS, BENCH_DECIDE);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaDecideOps', {
    run: () => {
      sceneAPI.resolveBeatorajaDecideOps(BENCH_DECIDE);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaDecideGraphValue', {
    run: () => {
      sceneAPI.resolveBeatorajaDecideGraphValue(102, BENCH_DECIDE);
    },
  });

  // Result
  define('skin-beatoraja.scene.beatorajaEarlyLateFromTimings', {
    run: () => {
      sceneAPI.beatorajaEarlyLateFromTimings(BENCH_TIMINGS.slice(0, 200));
    },
  });
  define('skin-beatoraja.scene.beatorajaTimingStats', {
    run: () => {
      sceneAPI.beatorajaTimingStats(BENCH_TIMINGS.slice(0, 200));
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaResultNumber', {
    run: () => {
      sceneAPI.resolveBeatorajaResultNumber(BEATORAJA_NUM.STDDEV_TIMING, BENCH_RESULT);
      sceneAPI.resolveBeatorajaResultNumber(BEATORAJA_NUM.LATE_GREAT, BENCH_RESULT);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaResultOps', {
    run: () => {
      sceneAPI.resolveBeatorajaResultOps(BENCH_RESULT);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaResultText', {
    run: () => {
      sceneAPI.resolveBeatorajaResultText(BEATORAJA_TEXT.FULLTITLE, BENCH_RESULT);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaResultGaugeState', {
    run: () => {
      sceneAPI.resolveBeatorajaResultGaugeState(BENCH_RESULT);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaResultGaugePercent', {
    run: () => {
      sceneAPI.resolveBeatorajaResultGaugePercent(BENCH_RESULT);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaResultGraphValue', {
    run: () => {
      sceneAPI.resolveBeatorajaResultGraphValue(7, BENCH_RESULT);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaResultPolyline', {
    run: () => {
      sceneAPI.resolveBeatorajaResultPolyline(107, BENCH_RESULT);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaResultJudgeGraph', {
    run: () => {
      sceneAPI.resolveBeatorajaResultJudgeGraph(2, BENCH_RESULT);
    },
  });

  // Select
  define('skin-beatoraja.scene.beatorajaKeysFilterIndex', {
    run: () => {
      sceneAPI.beatorajaKeysFilterIndex('KEYS_48');
    },
  });
  define('skin-beatoraja.scene.beatorajaSortIndex', {
    run: () => {
      sceneAPI.beatorajaSortIndex('NOTES');
    },
  });
  define('skin-beatoraja.scene.beatorajaKeyModeIndex', {
    run: () => {
      sceneAPI.beatorajaKeyModeIndex('9');
    },
  });
  define('skin-beatoraja.scene.beatorajaLNModeIndex', {
    run: () => {
      sceneAPI.beatorajaLNModeIndex(3);
    },
  });
  define('skin-beatoraja.scene.beatorajaDifficultyOps', {
    run: () => {
      sceneAPI.beatorajaDifficultyOps(4);
    },
  });
  define('skin-beatoraja.scene.beatorajaJudgeRankOp', {
    run: () => {
      sceneAPI.beatorajaJudgeRankOp(1);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaSelectBarOps', {
    run: () => {
      sceneAPI.resolveBeatorajaSelectBarOps(BENCH_SELECT);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaSelectText', {
    run: () => {
      sceneAPI.resolveBeatorajaSelectText(BEATORAJA_TEXT.FULLARTIST, BENCH_SELECT);
      sceneAPI.resolveBeatorajaSelectText(BEATORAJA_TEXT.COURSE1_TITLE + 1, BENCH_COURSE_SELECT);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaSelectNumber', {
    run: () => {
      sceneAPI.resolveBeatorajaSelectNumber(BEATORAJA_NUM.DENSITY_PEAK, BENCH_SELECT);
      sceneAPI.resolveBeatorajaSelectNumber(BEATORAJA_NUM.MAINBPM, BENCH_SELECT);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaSelectRefValue', {
    run: () => {
      sceneAPI.resolveBeatorajaSelectRefValue(308, BENCH_SELECT);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaSelectSliderValue', {
    run: () => {
      sceneAPI.resolveBeatorajaSelectSliderValue(18);
    },
  });

  // Course and clear lamp
  define('skin-beatoraja.scene.resolveBeatorajaCourseConstraintOps', {
    run: () => {
      sceneAPI.resolveBeatorajaCourseConstraintOps(BENCH_COURSE.definition.constraints);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaCourseBarOps', {
    run: () => {
      sceneAPI.resolveBeatorajaCourseBarOps(BENCH_COURSE, 106);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaCourseStageOps', {
    run: () => {
      sceneAPI.resolveBeatorajaCourseStageOps(BENCH_COURSE_VIEW);
    },
  });
  define('skin-beatoraja.scene.withBeatorajaCourseStageOps', {
    run: () => {
      sceneAPI.withBeatorajaCourseStageOps(new Set([900, 901]), BENCH_COURSE_VIEW);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaCourseText', {
    run: () => {
      sceneAPI.resolveBeatorajaCourseText(152, BENCH_COURSE_VIEW);
    },
  });
  define('skin-beatoraja.scene.beatorajaMissingCourseStages', {
    run: () => {
      sceneAPI.beatorajaMissingCourseStages(BENCH_COURSE);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaScoreTimers', {
    run: () => {
      sceneAPI.resolveBeatorajaScoreTimers({ exScore: 180, totalNotes: 100, hasJudgment: true, started: new Set() });
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaHCNTimers', {
    run: () => {
      sceneAPI.resolveBeatorajaHCNTimers({ lanes: [{ side: 2, plate: 2, lane: 26, gaining: true }], started: [] });
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaCharacterTimers', {
    run: () => {
      sceneAPI.resolveBeatorajaCharacterTimers({
        nowMs: 100,
        timers: new Map([
          [900, 0],
          [905, 0],
        ]),
        state: { lastNotes: [0, 0] },
        stage: 'playing',
        pastNotes: 1,
        latestJudge: 'GREAT',
        gaugeMax: false,
      });
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaOptionButton', {
    run: () => {
      sceneAPI.resolveBeatorajaOptionButton(54, { battleMode: 'OFF', dpFlip: true }, false);
      sceneAPI.resolveBeatorajaOptionButton(308, { longNoteMode: 'HCN' }, false);
      sceneAPI.resolveBeatorajaOptionButton(42, { random1P: 'H-RANDOM' }, false, { pms: true });
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaPlayOptionIndex', {
    run: () => {
      sceneAPI.resolveBeatorajaPlayOptionIndex(54, { battleMode: 'BATTLE-AS' });
      sceneAPI.resolveBeatorajaPlayOptionIndex(78, { gaugeAutoShift: 'BEST_CLEAR' });
      sceneAPI.resolveBeatorajaPlayOptionIndex(43, { random2P: 'S_RANDOM_PLAYABLE' });
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaOptionIndex', {
    run: () => {
      sceneAPI.resolveBeatorajaOptionIndex(370, { lamp: 'EX_HARD' });
    },
  });
  define('skin-beatoraja.scene.beatorajaClearLampOp', {
    run: () => {
      sceneAPI.beatorajaClearLampOp('EX_HARD');
    },
  });

  // Replay slots
  define('skin-beatoraja.scene.beatorajaReplayButtonSlot', {
    run: () => {
      sceneAPI.beatorajaReplayButtonSlot(316);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaResultReplayOps', {
    run: () => {
      sceneAPI.resolveBeatorajaResultReplayOps(['exists', 'saved', 'none', 'exists']);
    },
  });
  define('skin-beatoraja.scene.resolveBeatorajaSelectReplayOps', {
    run: () => {
      sceneAPI.resolveBeatorajaSelectReplayOps([true, false, true, false], 2);
    },
  });

  // System sounds
  define('skin-beatoraja.scene.discoverBeatorajaSystemSoundPaths', {
    run: () => {
      sceneAPI.discoverBeatorajaSystemSoundPaths(BENCH_FILES);
    },
  });
  define('skin-beatoraja.scene.discoverBeatorajaSelectBGMPath', {
    run: () => {
      sceneAPI.discoverBeatorajaSelectBGMPath(BENCH_FILES);
    },
  });
  define('skin-beatoraja.scene.pickBeatorajaThemeBGMPaths', {
    run: () => {
      sceneAPI.pickBeatorajaThemeBGMPaths(BENCH_FILES.keys());
    },
  });
}

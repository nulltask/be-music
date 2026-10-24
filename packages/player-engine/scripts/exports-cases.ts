import { cloneJSON } from '@be-music/chart-source';
import { resolveChart } from '@be-music/chart-model';
import { parseChart } from '@be-music/chart-parser';
import * as playerAPI from '@be-music/player-engine';
import * as courseAPI from '@be-music/player-engine/course';
import * as displayAPI from '@be-music/player-engine/display';
import * as lanesAPI from '@be-music/player-engine/lanes';
import * as replayAPI from '@be-music/player-engine/replay';
import * as recordsAPI from '@be-music/player-engine/records';
import * as rulesetAPI from '@be-music/player-engine/ruleset';
import * as signalsAPI from '@be-music/player-engine/signals';
import type { PlayerOptions } from '@be-music/player-engine';
import type { BeMusicReplay } from '@be-music/player-engine/replay';
import type { PlayerUIFramePayload } from '@be-music/player-engine/signals';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const BENCH_PLAYER_OPTIONS: PlayerOptions = {
  audio: false,
  tui: false,
  leadInMs: 0,
  speed: 8,
  highSpeed: 1,
  inferBmsLNTypeWhenMissing: true,
};

/** 64 measures of sixteenth notes over four lanes and a long note every other measure, at 150 BPM: 4 128 notes. */
const SEEK_REBUILD_CHART = parseChart(
  [
    '#TITLE seek rebuild',
    '#BPM 150',
    '#WAV01 missing01.wav',
    '#LNTYPE 1',
    ...Array.from({ length: 64 }, (_, measure) => {
      const id = String(measure).padStart(3, '0');
      return [
        `#${id}11:${'01'.repeat(16)}`,
        `#${id}12:${'01'.repeat(16)}`,
        `#${id}13:${'01'.repeat(16)}`,
        `#${id}14:${'01'.repeat(16)}`,
        `#${id}55:0100`,
      ];
    }).flat(),
  ].join('\n'),
  'bms',
);
const SEEK_REBUILD_SECONDS = 64 * 1.6;

export function registerPlayerExportsCases(define: DefineBenchmarkCase): void {
  define('player-engine.resolveChartRulesetFacts', {
    run: (fixtures) => {
      playerAPI.resolveChartRulesetFacts(fixtures.sampleBmsJSON);
    },
  });
  define('player-engine.createTempoClock', {
    run: () => {
      const clock = playerAPI.createTempoClock(1);
      clock.setTempoAtClockMs(1000, 1.25);
      clock.setTempoAtClockMs(2000, 0.75);
      clock.chartSecondsAt(2500);
      clock.clockMsAt(2.5);
      clock.initialTempoMsAt(2500);
      clock.rebase(3000, 1.5);
      clock.chartSecondsAt(3500);
    },
  });
  define('player-engine.resolvePlayChart', {
    run: (fixtures) => {
      playerAPI.resolvePlayChart(fixtures.controlFlowJSON, { random: () => 0.42 });
    },
  });
  define('player-engine.replay.resolveChartRulesetFacts', {
    run: (fixtures) => {
      replayAPI.resolveChartRulesetFacts(fixtures.sampleBmsJSON);
    },
  });
  define('player-engine.replay.resolvePlayChart', {
    run: (fixtures) => {
      replayAPI.resolvePlayChart(fixtures.controlFlowJSON, { random: () => 0.42 });
    },
  });
  define('player-engine.preparePlaybackChart', {
    run: (fixtures) => {
      playerAPI.preparePlaybackChart(
        resolveChart(fixtures.sampleBmsJSON, { chartPath: '.bms', inferBmsLNTypeWhenMissing: true }),
        { laneModeExtension: '.bms', longNoteModifier: 'REMOVE' },
      );
    },
  });
  define('player-engine.autoPlay', {
    run: async (fixtures) => {
      await runSilently(async () => {
        await playerAPI.autoPlay(fixtures.emptyBmsJSON, BENCH_PLAYER_OPTIONS);
        // The seek rebuild: a play started at the end of a dense chart (`startAtSeconds` is its first seek) re-simulates
        // its judge over every note before it, then ends at once.
        await playerAPI.autoPlay(SEEK_REBUILD_CHART, { ...BENCH_PLAYER_OPTIONS, startAtSeconds: SEEK_REBUILD_SECONDS });
      });
    },
    interactive: true,
    timeMs: 8,
    warmupTimeMs: 0,
  });
  define('player-engine.manualPlay', {
    run: async (fixtures) => {
      await runSilently(async () => {
        await playerAPI.manualPlay(fixtures.emptyBmsJSON, {
          ...BENCH_PLAYER_OPTIONS,
          judgeWindowMs: 80,
        });
      });
    },
    interactive: true,
    timeMs: 8,
    warmupTimeMs: 0,
  });
  define('player-engine.PlayerInterruptedError', {
    run: () => {
      new playerAPI.PlayerInterruptedError('escape');
    },
  });
  const benchMD5 = '0123456789abcdef0123456789abcdef';
  const benchSHA256 = 'a'.repeat(64);
  const benchLR2Course = `<courselist><course><title>Dan</title><line>7</line><type>2</type><hash>${'0'.repeat(10)}2${'0'.repeat(21)}${benchMD5.repeat(4)}</hash></course></courselist>`;
  const benchBeatorajaCourse = {
    name: 'Dan',
    hash: [{ md5: benchMD5, title: 'one' }, { sha256: benchSHA256 }],
    constraint: ['MIRROR', 'GAUGE_LR2', 'LN'],
    trophy: [{ name: 'gold', missrate: 2.5, scorerate: 85 }],
  };
  const benchTableHeader = {
    mode: 'beat-7k',
    course: [
      [{ name: 'sl0', constraint: ['grade_mirror', 'gauge_lr2'], md5: [benchMD5, benchMD5, benchMD5, benchMD5] }],
    ],
  };
  const benchCourse = courseAPI.parseBeatorajaCourseData(benchBeatorajaCourse)!;
  define('player-engine.course.courseConstraintGroup', {
    run: () => {
      courseAPI.courseConstraintGroup('gauge_lr2');
    },
  });
  define('player-engine.course.parseCourseConstraint', {
    run: () => {
      courseAPI.parseCourseConstraint('GAUGE_24KEYS');
    },
  });
  define('player-engine.course.normalizeCourseConstraints', {
    run: () => {
      courseAPI.normalizeCourseConstraints(['grade_mirror', 'CLASS', 'no_good', 'gauge_lr2', 'ln']);
    },
  });
  define('player-engine.course.isClassCourseConstraints', {
    run: () => {
      courseAPI.isClassCourseConstraints(['gauge_lr2', 'grade_mirror']);
    },
  });
  define('player-engine.course.normalizeCourseTrophies', {
    run: () => {
      courseAPI.normalizeCourseTrophies(benchBeatorajaCourse.trophy);
    },
  });
  define('player-engine.course.createCourseStageRef', {
    run: () => {
      courseAPI.createCourseStageRef({ md5: benchMD5, title: 'one' });
    },
  });
  define('player-engine.course.decodeCourseText', {
    run: () => {
      courseAPI.decodeCourseText(new TextEncoder().encode(benchLR2Course));
    },
  });
  const benchNonstopHeader = `0125${'0'.repeat(6)}1${'0'.repeat(21)}`;
  const benchNonstopChart = parseChart(
    ['#BPM 150', '#BPM01 180', '#00002:0.75', '#00111:01010101', '#00301:01', '#00408:01', '#00512:0001'].join('\n'),
    'bms',
  );
  const benchNonstopStage = courseAPI.createNonstopStageTiming(benchNonstopChart);
  const benchNonstopStages = [benchNonstopStage, benchNonstopStage, benchNonstopStage, benchNonstopStage];
  define('player-engine.course.parseLR2NonstopConnections', {
    run: () => {
      courseAPI.parseLR2NonstopConnections(benchNonstopHeader);
    },
  });
  define('player-engine.course.resolveNonstopLastMeasure', {
    run: () => {
      courseAPI.resolveNonstopLastMeasure(7.25);
      courseAPI.resolveNonstopLastMeasure(7.75);
    },
  });
  define('player-engine.course.createNonstopStageTiming', {
    run: () => {
      courseAPI.createNonstopStageTiming(benchNonstopChart);
    },
  });
  const benchNonstopInputs = [benchNonstopChart, benchNonstopChart, benchNonstopChart].map((chart) => ({ chart }));
  const bmsonNonstopChart = cloneJSON(benchNonstopChart);
  bmsonNonstopChart.sourceFormat = 'bmson';
  bmsonNonstopChart.bmson.info.resolution = 240;
  define('player-engine.course.stitchNonstopCourse', {
    run: () => {
      courseAPI.stitchNonstopCourse(benchNonstopInputs, { connections: ['fade', 'cut-fit'] });
      courseAPI.stitchNonstopCourse([{ chart: benchNonstopChart }, { chart: bmsonNonstopChart }], {
        connections: ['cut'],
      });
    },
  });
  define('player-engine.course.applyCourseLongNoteConstraint', {
    run: () => {
      courseAPI.applyCourseLongNoteConstraint(benchNonstopChart, ['cn']);
    },
  });
  define('player-engine.course.resolveCourseStageSettings', {
    run: () => {
      courseAPI.resolveCourseStageSettings(benchCourse);
    },
  });
  define('player-engine.course.resolveCourseLaneOptions', {
    run: () => {
      courseAPI.resolveCourseLaneOptions(benchCourse.constraints, {
        random1P: 'RANDOM',
        random2P: 'MIRROR',
        dpFlip: true,
      });
      courseAPI.resolveCourseLaneOptions(['grade_mirror'], { random1P: 'MIRROR', random2P: 'OFF', dpFlip: false });
    },
  });
  const benchLR2GradeDefinition = courseAPI.parseLR2CourseFile(benchLR2Course)[0]!;
  define('player-engine.course.isLR2GradeCourse', {
    run: () => {
      courseAPI.isLR2GradeCourse(benchLR2GradeDefinition);
    },
  });
  define('player-engine.course.resolveLR2GradeCoursePlaySettings', {
    run: () => {
      courseAPI.resolveLR2GradeCoursePlaySettings(benchLR2GradeDefinition, {
        gauge: 'EASY',
        hiddenSudden1P: 'SUDDEN',
        hiddenSudden2P: 'OFF',
        autoScratch1P: true,
        autoScratch2P: false,
        dpFlip: true,
        tempo: 1.1,
      });
    },
  });
  define('player-engine.course.resolveCourseStagePlaySettings', {
    run: () => {
      courseAPI.resolveCourseStagePlaySettings(benchLR2GradeDefinition, {
        random1P: 'RANDOM',
        random2P: 'OFF',
        dpFlip: true,
        gauge: 'EASY',
        hiddenSudden1P: 'SUDDEN',
        hiddenSudden2P: 'OFF',
        autoScratch1P: true,
        autoScratch2P: false,
        tempo: 1.1,
      });
    },
  });
  define('player-engine.course.isCourseHiSpeedLocked', {
    run: () => {
      courseAPI.isCourseHiSpeedLocked(['no_speed', 'gauge_lr2']);
    },
  });
  const benchStitched = courseAPI.stitchNonstopCourse(benchNonstopInputs, { connections: ['fade', 'cut-fit'] });
  const benchStitchedMap = benchStitched.ok ? benchStitched.map : { stages: [], tempo: [], stageRanks: [] };
  const benchReadoutPlacements = courseAPI.planNonstopCourse(benchNonstopStages.slice(0, 3), ['fade', 'cut-fit']);
  const benchReadoutStages = [0, 1, 2].map((index) => ({
    tempo: [
      { seconds: 0, bpm: 150 },
      { seconds: 4.8, bpm: 180 },
    ],
    headerBPM: 150,
    rank: index,
    noteHeads: { first: index * 10 + 1, last: index * 10 + 9 },
  }));
  define('player-engine.course.resolveNonstopTempo', {
    run: () => {
      courseAPI.resolveNonstopTempo(benchReadoutStages, benchReadoutPlacements);
      courseAPI.resolveNonstopTempo(benchReadoutStages, benchReadoutPlacements, { placement: 'lr2' });
    },
  });
  define('player-engine.course.nonstopBPMAt', {
    run: () => {
      courseAPI.nonstopBPMAt(benchStitchedMap.tempo, 3);
      courseAPI.nonstopBPMAt(benchStitchedMap.tempo, 30);
    },
  });
  define('player-engine.course.resolveNonstopStageRanks', {
    run: () => {
      courseAPI.resolveNonstopStageRanks(benchReadoutStages, benchReadoutPlacements);
      courseAPI.resolveNonstopStageRanks(benchReadoutStages, benchReadoutPlacements, { placement: 'lr2' });
    },
  });
  const benchStitchedChart = benchStitched.ok ? benchStitched.chart : benchNonstopChart;
  const benchSplitStages = [
    { offsetUs: 0, windowStartUs: 0, windowEndUs: 1_500_000, rate: 1 },
    { offsetUs: 500_000, windowStartUs: 1_500_000, rate: 1 },
  ];
  const benchSplitNoteStages = BENCH_REPLAY.chart.notes.map((note) => (note.timeUs < 1_500_000 ? 0 : 1));
  define('player-engine.replay.resolveNonstopReplayStages', {
    run: () => {
      replayAPI.resolveNonstopReplayStages(benchStitchedMap);
    },
  });
  define('player-engine.replay.resolveNonstopNoteStages', {
    run: () => {
      replayAPI.resolveNonstopNoteStages(benchStitchedChart, benchStitchedMap, BENCH_REPLAY.chart.notes);
    },
  });
  define('player-engine.replay.splitNonstopReplay', {
    run: () => {
      replayAPI.splitNonstopReplay(
        { replay: BENCH_REPLAY, stages: benchSplitStages, noteStages: benchSplitNoteStages },
        [{ title: 'A' }, { title: 'B' }],
        { ruleset: 'lr2' },
      );
    },
  });
  const benchPipelineStages = benchNonstopInputs.map((input, index) => ({
    chart: input.chart,
    chartPath: `stage${index}.bms`,
    facts: { title: `Stage ${index + 1}` },
  }));
  const benchPipelineOptions = { constraints: ['cn' as const], connections: ['fade' as const, 'cut-fit' as const] };
  define('player-engine.course.prepareNonstopCourse', {
    run: () => {
      courseAPI.prepareNonstopCourse(benchPipelineStages, { ...benchPipelineOptions, random: () => 0 });
    },
  });
  const benchPrepared = courseAPI.prepareNonstopCourse(benchPipelineStages, benchPipelineOptions);
  if (!benchPrepared.ok) throw new Error(`bench NONSTOP course failed to stitch: ${benchPrepared.reason}`);
  define('player-engine.course.resolveNonstopRun', {
    run: () => {
      courseAPI.resolveNonstopRun(benchPrepared.course, BENCH_REPLAY);
    },
  });
  define('player-engine.course.buildNonstopCourseReplay', {
    run: () => {
      courseAPI.buildNonstopCourseReplay(
        { name: 'Nonstop', kind: 'nonstop', constraints: ['cn'], trophies: [], release: true },
        benchPrepared.course,
        BENCH_REPLAY,
      );
    },
  });
  define('player-engine.course.planNonstopCourse', {
    run: () => {
      courseAPI.planNonstopCourse(benchNonstopStages, ['fade', 'cut-fit', 'blank1']);
      courseAPI.planNonstopCourse(benchNonstopStages, ['fade', 'cut-fit', 'blank1'], { placement: 'lr2' });
    },
  });
  define('player-engine.course.parseLR2CourseFile', {
    run: () => {
      courseAPI.parseLR2CourseFile(benchLR2Course);
    },
  });
  const benchLR2Parsed = courseAPI.parseLR2CourseFile(benchLR2Course)[0]!;
  define('player-engine.course.countLR2UnplayedStages', {
    run: () => {
      courseAPI.countLR2UnplayedStages(benchLR2Parsed);
    },
  });
  const benchDraftStage = { md5: 'a'.repeat(32), keyMode: 7, title: 'Song' };
  const benchDraft = { kind: 'nonstop' as const, name: 'Bench', stages: [benchDraftStage, benchDraftStage] };
  const benchMadeCourse = courseAPI.finishCourseDraft(benchDraft)!;
  define('player-engine.course.createCourseDraft', {
    run: () => {
      courseAPI.createCourseDraft('nonstop', 'Bench');
    },
  });
  define('player-engine.course.appendCourseDraftStage', {
    run: () => {
      courseAPI.appendCourseDraftStage(benchDraft, benchDraftStage);
    },
  });
  define('player-engine.course.removeLastCourseDraftStage', {
    run: () => {
      courseAPI.removeLastCourseDraftStage(benchDraft);
    },
  });
  define('player-engine.course.buildLR2CourseHash', {
    run: () => {
      courseAPI.buildLR2CourseHash({
        kind: 'nonstop',
        stageMD5s: ['a'.repeat(32), 'b'.repeat(32)],
        connections: ['cut'],
      });
    },
  });
  define('player-engine.course.finishCourseDraft', {
    run: () => {
      courseAPI.finishCourseDraft(benchDraft, { defaultConnection: 'cut' });
    },
  });
  define('player-engine.course.stepLR2NonstopConnection', {
    run: () => {
      courseAPI.stepLR2NonstopConnection('fade', 1);
      courseAPI.stepLR2NonstopConnection('fade', -1);
    },
  });
  define('player-engine.course.withNonstopConnection', {
    run: () => {
      courseAPI.withNonstopConnection(benchMadeCourse, 0, 'blank1');
    },
  });
  define('player-engine.course.defaultCourseMakerConstraints', {
    run: () => {
      courseAPI.defaultCourseMakerConstraints('grade');
    },
  });
  define('player-engine.course.withCourseConstraints', {
    run: () => {
      courseAPI.withCourseConstraints(benchMadeCourse, ['grade', 'gauge_7k', 'no_speed']);
    },
  });
  define('player-engine.course.courseConstraintEnumName', {
    run: () => {
      courseAPI.courseConstraintEnumName('grade_mirror');
    },
  });
  define('player-engine.course.serializeBeatorajaCourseFile', {
    run: () => {
      courseAPI.serializeBeatorajaCourseFile([benchMadeCourse]);
    },
  });
  define('player-engine.course.serializeLR2CourseFile', {
    run: () => {
      courseAPI.serializeLR2CourseFile([benchMadeCourse]);
    },
  });
  define('player-engine.course.parseBeatorajaCourseData', {
    run: () => {
      courseAPI.parseBeatorajaCourseData(benchBeatorajaCourse);
    },
  });
  define('player-engine.course.parseBeatorajaCourseFile', {
    run: () => {
      courseAPI.parseBeatorajaCourseFile(JSON.stringify([benchBeatorajaCourse]));
    },
  });
  define('player-engine.course.parseBeatorajaRandomCourseData', {
    run: () => {
      courseAPI.parseBeatorajaRandomCourseData({
        name: 'R',
        stage: [{ sql: 'level = 12' }, {}],
        rconstraint: ['distinct'],
      });
    },
  });
  define('player-engine.course.parseBeatorajaCommandFolderFile', {
    run: () => {
      courseAPI.parseBeatorajaCommandFolderFile(
        JSON.stringify([{ name: 'Random', rcourse: [{ name: 'R', stage: [{ sql: 'level = 12' }, {}] }] }]),
      );
    },
  });
  const benchFilterSQL =
    "song.level BETWEEN 11 AND 12 AND song.mode IN (7, 14) AND title NOT LIKE '%HYPER%' ORDER BY level DESC LIMIT 50";
  const benchFilter = courseAPI.parseCourseChartFilter(benchFilterSQL);
  const benchCharts = Array.from({ length: 200 }, (_, index) => ({
    md5: index.toString(16).padStart(32, '0'),
    sha256: index.toString(16).padStart(64, '0'),
    title: `song ${index}`,
    level: index % 13,
    mode: index % 2 === 0 ? 7 : 14,
  }));
  define('player-engine.course.parseCourseChartFilter', {
    run: () => {
      courseAPI.parseCourseChartFilter(benchFilterSQL);
    },
  });
  define('player-engine.course.evaluateCourseChartFilter', {
    run: () => {
      if (benchFilter.ok)
        for (const chartEntry of benchCharts) courseAPI.evaluateCourseChartFilter(benchFilter.filter, chartEntry);
    },
  });
  define('player-engine.course.selectCourseCharts', {
    run: () => {
      if (benchFilter.ok) courseAPI.selectCourseCharts(benchFilter.query, benchCharts, (chartEntry) => chartEntry);
    },
  });
  let benchSeed = 1;
  define('player-engine.course.drawRandomCourse', {
    run: () => {
      courseAPI.drawRandomCourse(
        {
          name: 'R',
          stages: [{ filter: 'level = 12' }, {}, { filter: 'level >= 10' }, {}],
          constraints: ['grade_mirror'],
          trophies: [],
          distinct: true,
        },
        benchCharts,
        () => {
          benchSeed = (benchSeed * 16807) % 2147483647;
          return (benchSeed - 1) / 2147483646;
        },
      );
    },
  });
  define('player-engine.course.resolveTableModeKeys', {
    run: () => {
      courseAPI.resolveTableModeKeys('beat-7k');
    },
  });
  define('player-engine.course.parseTableHeaderCourses', {
    run: () => {
      courseAPI.parseTableHeaderCourses(benchTableHeader);
    },
  });
  const benchTablePageURL = 'https://example.com/table/table.html';
  const benchTablePage = `<html><head><meta charset="utf-8"><meta content="header.json" name="bmstable"></head></html>`;
  const benchTableHeaderText = JSON.stringify({ name: 'Bench table', ...benchTableHeader });
  // A stub instead of the network: benchmarks must not fetch.
  const benchTableFetch = async (url: string): Promise<string> =>
    url === benchTablePageURL ? benchTablePage : benchTableHeaderText;
  define('player-engine.course.resolveTableHeaderURL', {
    run: () => {
      courseAPI.resolveTableHeaderURL(benchTablePageURL, benchTablePage);
    },
  });
  define('player-engine.course.fetchTableHeaderCourses', {
    run: async () => {
      await courseAPI.fetchTableHeaderCourses(benchTablePageURL, benchTableFetch);
    },
  });
  define('player-engine.course.resolveCourseStages', {
    run: () => {
      courseAPI.resolveCourseStages(benchCourse, { bySHA256: () => 'chart', byMD5: () => 'chart' });
    },
  });
  define('player-engine.replay.checkReplayEligibility', {
    run: () => {
      replayAPI.checkReplayEligibility(BENCH_REPLAY);
    },
  });
  define('player-engine.replay.serializeReplay', {
    run: () => {
      replayAPI.serializeReplay(BENCH_REPLAY);
    },
  });
  define('player-engine.replay.createReplayRecorder', {
    run: () => {
      const json = parseChart('#BPM 120\n#00111:01\n');
      const recorder = replayAPI.createReplayRecorder({
        json,
        chart: {
          notes: [],
          landmineNotes: [],
          invisibleNotes: [],
          activeFreeZoneChannels: new Set<string>(),
          scorableNotes: [],
          laneDisplayMode: '7keys',
        },
        play: { mode: 'manual', autoScratch: false },
      });
      recorder.recordInput('down', 0.5, ['z'], ['11']);
      recorder.discard();
    },
  });
  define('player-engine.replay.ReplayParseError', {
    run: () => {
      void new replayAPI.ReplayParseError('bench');
    },
  });
  define('player-engine.replay.resolveReplayFilename', {
    run: () => {
      replayAPI.resolveReplayFilename(BENCH_REPLAY, new Date(0));
    },
  });
  define('player-engine.replay.resolveRulesetConfig', {
    run: () => {
      replayAPI.resolveRulesetConfig(BENCH_REPLAY, 'beatoraja');
    },
  });
  define('player-engine.replay.resolveLR2DefaultTotal', {
    run: () => {
      replayAPI.resolveLR2DefaultTotal(1200);
    },
  });
  define('player-engine.replay.resolveBeatorajaDefaultTotal', {
    run: () => {
      replayAPI.resolveBeatorajaDefaultTotal(1200);
    },
  });
  define('player-engine.replay.resolve____GaugeUnit', {
    run: () => {
      replayAPI.resolve____GaugeUnit(1200);
    },
  });
  define('player-engine.replay.resolveLR2HardDamageMultiplier', {
    run: () => {
      replayAPI.resolveLR2HardDamageMultiplier(300, 1200);
    },
  });
  define('player-engine.replay.resolveBeatorajaHardRecoverMultiplier', {
    run: () => {
      replayAPI.resolveBeatorajaHardRecoverMultiplier(300, 1200);
    },
  });
  define('player-engine.replay.parseReplay', {
    run: () => {
      replayAPI.parseReplay(BENCH_REPLAY_JSON);
    },
  });
  define('player-engine.replay.simulateReplay', {
    run: () => {
      replayAPI.simulateReplay(BENCH_REPLAY, { ruleset: 'lr2' });
    },
  });
  define('player-engine.replay.simulateReplayRulesets', {
    run: () => {
      replayAPI.simulateReplayRulesets(BENCH_REPLAY);
    },
  });
  const benchCourseInfo = {
    name: 'Dan',
    kind: 'grade' as const,
    constraints: ['grade_mirror', 'gauge_lr2'],
    trophies: [{ name: 'gold', missRate: 5, scoreRate: 80 }],
  };
  const benchCourseLog = replayAPI.createCourseReplay({
    course: benchCourseInfo,
    stages: [
      { played: true, replay: BENCH_REPLAY },
      { played: true, replay: BENCH_REPLAY },
    ],
  });
  const benchCourseText = replayAPI.serializeCourseReplay(benchCourseLog);
  const benchStageResult = replayAPI.simulateReplay(BENCH_REPLAY, { ruleset: 'lr2' });
  const benchRunStageLog: BeMusicReplay = { ...BENCH_REPLAY, results: { native: benchStageResult } };
  const benchRunStages = [
    { chart: benchNonstopChart, chartPath: 'a.bms' },
    { chart: benchNonstopChart, chartPath: 'b.bms' },
  ];
  define('player-engine.course.CourseRun', {
    run: () => {
      const run = new courseAPI.CourseRun(benchCourse, benchRunStages);
      run.nextStage();
      run.recordStage(benchRunStageLog, { playSeconds: 16 });
      run.nextStage();
      run.buildReplay();
      run.recordStage(undefined, { practice: true, stageOutcome: benchStageResult });
      run.buildPracticeResult();
    },
  });
  define('player-engine.course.resolveGivenUpPlaySeconds', {
    run: () => {
      courseAPI.resolveGivenUpPlaySeconds(BENCH_REPLAY);
      courseAPI.resolveGivenUpPlaySeconds({ play: { ...BENCH_REPLAY.play, aborted: true, abortedAtUs: 4_000_000 } });
    },
  });
  define('player-engine.replay.aggregateCourseResult', {
    run: () => {
      replayAPI.aggregateCourseResult(
        'lr2/0',
        benchCourseInfo,
        [benchStageResult, benchStageResult],
        [10, 10],
        'GROOVE',
      );
    },
  });
  define('player-engine.replay.createCourseReplay', {
    run: () => {
      replayAPI.createCourseReplay({ course: benchCourseInfo, stages: [{ played: true, replay: BENCH_REPLAY }] });
    },
  });
  define('player-engine.replay.extractCourseStage', {
    run: () => {
      replayAPI.extractCourseStage(benchCourseLog, 1);
    },
  });
  define('player-engine.replay.parseCourseReplay', {
    run: () => {
      replayAPI.parseCourseReplay(benchCourseText);
    },
  });
  const benchLampScore = { total: 100, perfect: 90, great: 8, good: 2 };
  const benchRecordPlay = { lamp: 'HARD' as const, exScore: 1500, maxCombo: 400, missCount: 12 };
  const benchRecord = { lamp: 'EASY' as const, exScore: 1400, maxCombo: 500, missCount: 20, playCount: 3 };
  const benchRecordResult = {
    lamp: 'HARD' as const,
    cleared: true,
    maxCombo: 400,
    score: { total: 1000, perfect: 600, great: 300, good: 60, bad: 20, poor: 10, emptyPoor: 5, exScore: 1500 },
  };
  const benchRecordSummary = {
    ...benchRecordResult.score,
    gauge: { type: 'HARD', current: 40, max: 100, clearThreshold: 0, initial: 100, effectiveTotal: 300, cleared: true },
  };
  const benchRecordKind = { autoPlay: false, replay: false, course: false, tempo: 1 };
  define('player-engine.records.mergeBestRecord', {
    run: () => {
      recordsAPI.mergeBestRecord(benchRecord, benchRecordPlay);
    },
  });
  define('player-engine.records.mergeCourseStageRecord', {
    run: () => {
      recordsAPI.mergeCourseStageRecord(benchRecord, benchRecordPlay);
    },
  });
  define('player-engine.records.recordPlayFromResult', {
    run: () => {
      recordsAPI.recordPlayFromResult(benchRecordResult);
    },
  });
  define('player-engine.records.recordPlayFromSummary', {
    run: () => {
      recordsAPI.recordPlayFromSummary(benchRecordSummary, 400, 'lr2');
    },
  });
  define('player-engine.records.courseStageRecordPlayFromResult', {
    run: () => {
      recordsAPI.courseStageRecordPlayFromResult(benchRecordResult);
    },
  });
  define('player-engine.records.courseStageRecordPlayFromSummary', {
    run: () => {
      recordsAPI.courseStageRecordPlayFromSummary(benchRecordSummary, 400, 'lr2');
    },
  });
  define('player-engine.records.courseRunRecordPlay', {
    run: () => {
      recordsAPI.courseRunRecordPlay(benchRecordPlay);
    },
  });
  define('player-engine.records.playKeepsRecord', {
    run: () => {
      recordsAPI.playKeepsRecord(benchRecordKind);
    },
  });
  define('player-engine.records.courseStageKeepsRecord', {
    run: () => {
      recordsAPI.courseStageKeepsRecord(benchRecordKind);
    },
  });
  define('player-engine.records.isCourseRunAtAnotherTempo', {
    run: () => {
      recordsAPI.isCourseRunAtAnotherTempo(benchCourseLog);
    },
  });
  define('player-engine.records.isCourseRunAutoPlayed', {
    run: () => {
      recordsAPI.isCourseRunAutoPlayed(benchCourseLog);
    },
  });
  define('player-engine.records.courseRunKeepsRecord', {
    run: () => {
      recordsAPI.courseRunKeepsRecord(benchCourseLog);
    },
  });
  define('player-engine.ruleset.isClearLamp', {
    run: () => {
      rulesetAPI.isClearLamp('EX_HARD');
    },
  });
  define('player-engine.ruleset.clearLampRank', {
    run: () => {
      rulesetAPI.clearLampRank('FULL_COMBO');
    },
  });
  define('player-engine.ruleset.clearLampAtRank', {
    run: () => {
      rulesetAPI.clearLampAtRank(7);
    },
  });
  define('player-engine.ruleset.betterClearLamp', {
    run: () => {
      rulesetAPI.betterClearLamp('HARD', 'FULL_COMBO');
    },
  });
  define('player-engine.ruleset.topClearLamp', {
    run: () => {
      rulesetAPI.topClearLamp('lr2');
    },
  });
  define('player-engine.ruleset.isFullCombo', {
    run: () => {
      rulesetAPI.isFullCombo(benchLampScore);
    },
  });
  define('player-engine.ruleset.resolveClearLamp', {
    run: () => {
      rulesetAPI.resolveClearLamp({ ruleset: 'beatoraja', cleared: true, gauge: 'HARD', score: benchLampScore });
    },
  });
  define('player-engine.ruleset.resolveCourseClearLamp', {
    run: () => {
      rulesetAPI.resolveCourseClearLamp({
        ruleset: 'lr2',
        cleared: true,
        gauge: 'GRADE-HARD',
        gaugeType: 'HARD',
        noteCount: 1000,
        maxCombo: 400,
        judge: { great: 120, good: 12 },
      });
    },
  });
  define('player-engine.ruleset.resolveMissCount', {
    run: () => {
      rulesetAPI.resolveMissCount({ bad: 3, poor: 5, emptyPoor: 2 }, 10);
    },
  });
  define('player-engine.ruleset.resolveGaugeTypes', {
    run: () => {
      rulesetAPI.resolveGaugeTypes('beatoraja');
    },
  });
  define('player-engine.ruleset.isGaugeType', {
    run: () => {
      rulesetAPI.isGaugeType('DEATH');
    },
  });
  define('player-engine.ruleset.createEmptyScore', {
    run: () => {
      rulesetAPI.createEmptyScore(1000);
    },
  });
  define('player-engine.ruleset.computeScoreRate', {
    run: () => {
      rulesetAPI.computeScoreRate({ total: 1000, exScore: 1650 });
    },
  });
  define('player-engine.ruleset.resolve____RankIndexFromScore', {
    run: () => {
      rulesetAPI.resolve____RankIndexFromScore({ total: 1000, exScore: 1650 });
    },
  });
  define('player-engine.ruleset.resolve____RankLabel', {
    run: () => {
      rulesetAPI.resolve____RankLabel(1650, 1000);
    },
  });
  define('player-engine.ruleset.resolveLR2MoneyScore', {
    run: () => {
      rulesetAPI.resolveLR2MoneyScore({ total: 1000, perfect: 700, great: 250, good: 30 });
    },
  });
  define('player-engine.ruleset.resolveDisplayedPoor', {
    run: () => {
      rulesetAPI.resolveDisplayedPoor({ poor: 5, emptyPoor: 2 }, true);
    },
  });
  define('player-engine.replay.resolveCourseLamp', {
    run: () => {
      replayAPI.resolveCourseLamp('beatoraja', benchStageResult, 'GROOVE');
    },
  });
  define('player-engine.replay.resolveCoursePlayedRuleset', {
    run: () => {
      replayAPI.resolveCoursePlayedRuleset(benchCourseLog);
    },
  });
  define('player-engine.replay.resolveRulesetResultLamp', {
    run: () => {
      replayAPI.resolveRulesetResultLamp(benchStageResult, 'lr2');
    },
  });
  define('player-engine.replay.resolveCourseReplayFilename', {
    run: () => {
      replayAPI.resolveCourseReplayFilename(benchCourseLog);
    },
  });
  define('player-engine.replay.resolveCourseStageStartGauge', {
    run: () => {
      replayAPI.resolveCourseStageStartGauge(
        'lr2',
        { kind: 'grade', carryIn: { gauge: 64, combo: 0, maxCombo: 0 } },
        'GROOVE',
      );
    },
  });
  define('player-engine.replay.resolveCourseTrophy', {
    run: () => {
      replayAPI.resolveCourseTrophy(benchCourseInfo.trophies, { missCount: 4, exScore: 170, noteCount: 100 });
    },
  });
  define('player-engine.replay.serializeCourseReplay', {
    run: () => {
      replayAPI.serializeCourseReplay(benchCourseLog);
    },
  });
  define('player-engine.replay.simulateCourseReplay', {
    run: () => {
      replayAPI.simulateCourseReplay(benchCourseLog, { ruleset: 'lr2' });
    },
  });
  const benchKeyedCourseLog = replayAPI.createCourseReplay({
    course: benchCourseInfo,
    stages: [
      {
        played: true,
        replay: {
          ...BENCH_REPLAY,
          chart: {
            ...BENCH_REPLAY.chart,
            chartFingerprint: 'bmfp0:bench-stage-1',
            playFingerprint: 'bmfp0:bench-stage-1',
          },
          play: { ...BENCH_REPLAY.play, course: { kind: 'grade' } },
        },
      },
      {
        played: false,
        facts: {
          sourceFormat: 'bms',
          laneMode: '7keys',
          lnMode: 1,
          judgeRank: { percent: 75 },
          notes: { normal: 64, long: { 1: 0, 2: 0, 3: 0 } },
        },
        chartFingerprint: 'bmfp0:bench-stage-2',
      },
    ],
  });
  define('player-engine.replay.createCourseFingerprintDocument', {
    run: () => {
      replayAPI.createCourseFingerprintDocument({
        kind: 'nonstop',
        constraints: [],
        stageChartFingerprints: ['bmfp0:a', 'bmfp0:b', 'bmfp0:c'],
        nonstop: { connections: ['cut'], placement: 'intended' },
      });
    },
  });
  const optionState = { hiSpeed: 2, hsFix: 'STARTBPM', displayAreaInfo: 'ON' };
  const optionChanges = [{ timeUs: 1_000_000, values: { hiSpeed: 3 } }];
  define('player-engine.replay.parseReplayOptionState', {
    run: () => {
      replayAPI.parseReplayOptionState(optionState);
    },
  });
  define('player-engine.replay.parseReplayOptionChanges', {
    run: () => {
      replayAPI.parseReplayOptionChanges(optionChanges);
    },
  });
  define('player-engine.replay.resolveReplayOptionsAt', {
    run: () => {
      replayAPI.resolveReplayOptionsAt(optionState, optionChanges, 2_000_000);
    },
  });
  define('player-engine.replay.diffReplayOptions', {
    run: () => {
      replayAPI.diffReplayOptions(optionState, { ...optionState, hiSpeed: 3 });
    },
  });
  const benchView = { hiSpeed: 2, hsFix: 'MAIN', covers: [{ side: '1P' as const, sudden: 0.2, hidden: 0, lift: 0.1 }] };
  const benchViewChanges = [
    { timeUs: 1_000_000, hiSpeed: 2.5 },
    { timeUs: 2_000_000, covers: [{ side: '1P' as const, sudden: 0.3, hidden: 0, lift: 0.1 }] },
  ];
  const benchTempoChanges = [
    { timeUs: 1_000_000, tempo: 1.25 },
    { timeUs: 2_000_000, tempo: 1 },
  ];
  define('player-engine.replay.resolveReplayViewAt', {
    run: () => {
      replayAPI.resolveReplayViewAt(benchView, benchViewChanges, 1_500_000);
    },
  });
  define('player-engine.replay.resolveReplayTempoAt', {
    run: () => {
      replayAPI.resolveReplayTempoAt(1, benchTempoChanges, 1_500_000);
    },
  });
  define('player-engine.replay.playedAtAnotherTempo', {
    run: () => {
      replayAPI.playedAtAnotherTempo({ tempoChanges: benchTempoChanges });
    },
  });
  define('player-engine.replay.resolveReplayView', {
    run: () => {
      replayAPI.resolveReplayView(benchView, { hiSpeed: 1 }, replayAPI.DEFAULT_REPLAY_PLAYBACK_OPTIONS);
    },
  });
  define('player-engine.replay.resolveReplayHiSpeed', {
    run: () => {
      replayAPI.resolveReplayHiSpeed(
        { ...benchView, hiSpeedScale: 'beatoraja', visibleMs: 400 },
        'be-music',
        (ms) => 1000 / ms,
      );
    },
  });
  define('player-engine.replay.roundReplayView', {
    run: () => {
      replayAPI.roundReplayView({ ...benchView, hiSpeed: 2.5000000000000004 });
    },
  });
  define('player-engine.replay.diffReplayView', {
    run: () => {
      replayAPI.diffReplayView(benchView, { ...benchView, hiSpeed: 2.5 });
    },
  });
  define('player-engine.replay.createReplayViewCoalescer', {
    run: () => {
      const coalescer = replayAPI.createReplayViewCoalescer(benchView);
      coalescer.observe({ ...benchView, hiSpeed: 2.5 }, 0);
    },
  });
  define('player-engine.replay.parseReplayViewState', {
    run: () => {
      replayAPI.parseReplayViewState(benchView, 'worker-play.view');
    },
  });
  define('player-engine.replay.parseReplayViewChanges', {
    run: () => {
      replayAPI.parseReplayViewChanges(benchViewChanges, 'worker-play.viewChanges');
    },
  });
  define('player-engine.replay.parseReplayTempoChanges', {
    run: () => {
      replayAPI.parseReplayTempoChanges(benchTempoChanges, 'worker-play.tempoChanges');
    },
  });
  define('player-engine.replay.computeCourseFingerprint', {
    run: () => {
      replayAPI.computeCourseFingerprint({
        kind: 'grade',
        constraints: ['grade_mirror', 'gauge_lr2'],
        stageChartFingerprints: ['bmfp0:a', 'bmfp0:b', 'bmfp0:c', 'bmfp0:d'],
      });
    },
  });
  define('player-engine.replay.resolveCourseStageChartFingerprints', {
    run: () => {
      replayAPI.resolveCourseStageChartFingerprints(benchKeyedCourseLog);
    },
  });
  define('player-engine.replay.computeCourseReplayFingerprint', {
    run: () => {
      replayAPI.computeCourseReplayFingerprint(benchKeyedCourseLog);
    },
  });
  define('player-engine.replay.checkCourseReplayEligibility', {
    run: () => {
      replayAPI.checkCourseReplayEligibility(benchKeyedCourseLog);
    },
  });
  define('player-engine.ruleset.resolveJudgeWindowsMs', {
    run: (fixtures) => {
      rulesetAPI.resolveJudgeWindowsMs(fixtures.sampleBmsJSON, 250);
    },
  });
  define('player-engine.ruleset.isRulesetId', {
    run: () => {
      rulesetAPI.isRulesetId('beatoraja');
      rulesetAPI.isRulesetId('popn');
    },
  });
  registerSignalsCases(define);
  registerLanesCases(define);
  registerDisplayCases(define);
}

/** `@be-music/player-engine/signals`: the buses and state signals a host's runtimes exchange with a play. */
function registerSignalsCases(define: DefineBenchmarkCase): void {
  define('player-engine.signals.createPlayerInputSignalBus', {
    run: () => {
      const bus = signalsAPI.createPlayerInputSignalBus();
      bus.pushCommand({ kind: 'lane-input', tokens: ['KeyZ'] });
      bus.pushCommand({ kind: 'high-speed', action: 'increase' });
      bus.drainCommands();
    },
  });
  define('player-engine.signals.createPlayerUISignalBus', {
    run: () => {
      const bus = signalsAPI.createPlayerUISignalBus(BENCH_UI_FRAME);
      bus.publishFrame({ ...BENCH_UI_FRAME, currentBeat: 4, currentSeconds: 2 });
      bus.pushCommand({ kind: 'flash-lane', channel: '11' });
      bus.drainCommands();
    },
  });
  define('player-engine.signals.createPlayerStateSignals', {
    run: () => {
      const signals = signalsAPI.createPlayerStateSignals(2);
      signals.publishJudgeCombo('PERFECT', 1, '11', 0, 3);
      signals.publishJudgeCombo('GREAT', 2, '12', 1, -8);
      signals.drainPendingJudgeCombos();
    },
  });
  define('player-engine.signals.resolveHighSpeedControlActionFromLaneChannels', {
    run: () => {
      signalsAPI.resolveHighSpeedControlActionFromLaneChannels(['12', '14']);
    },
  });
  define('player-engine.signals.resolveHighSpeedMultiplier', {
    run: () => {
      signalsAPI.resolveHighSpeedMultiplier(3.25);
    },
  });
  define('player-engine.signals.applyHighSpeedControlAction', {
    run: () => {
      signalsAPI.applyHighSpeedControlAction(2, 'increase');
    },
  });
}

/** `@be-music/player-engine/lanes`: lane layout, key bindings and FREE ZONE input. */
function registerLanesCases(define: DefineBenchmarkCase): void {
  define('player-engine.lanes.resolveKeyChannel', {
    run: () => {
      lanesAPI.resolveKeyChannel({ code: 'KeyS' }, BENCH_7KEY_CHANNELS);
    },
  });
  define('player-engine.lanes.resolveSideKeySlot', {
    run: () => {
      lanesAPI.resolveSideKeySlot('25', '14');
    },
  });
  define('player-engine.lanes.resolveLR2LaneIndex', {
    run: () => {
      lanesAPI.resolveLR2LaneIndex('26', '14');
    },
  });
  define('player-engine.lanes.resolveSideRelativeLaneIndex', {
    run: () => {
      lanesAPI.resolveSideRelativeLaneIndex('23', '14');
    },
  });
  define('player-engine.lanes.isScratch', {
    run: () => {
      lanesAPI.isScratch('16');
      lanesAPI.isScratch('11');
    },
  });
  define('player-engine.lanes.resolveWheelLaneDirection', {
    run: () => {
      lanesAPI.resolveWheelLaneDirection('1P', '24');
    },
  });
  define('player-engine.lanes.randomizeSRandomNotes', {
    run: () => {
      for (const ruleset of ['lr2', 'beatoraja'] as const) {
        lanesAPI.randomizeSRandomNotes(
          [
            { channel: '11', timeMs: 0, endTimeMs: 1000 },
            { channel: '12', timeMs: 10 },
            { channel: '12', timeMs: 30 },
            { channel: '12', timeMs: 1100 },
          ],
          ['11', '12', '13', '14', '15'],
          { ruleset, random: () => 0.5 },
        );
      }
    },
  });
  define('player-engine.lanes.resolveLaneOptionChannels', {
    run: () => {
      lanesAPI.resolveLaneOptionChannels('1P', '7');
      lanesAPI.resolveLaneOptionChannels('1P', '5');
      lanesAPI.resolveLaneOptionChannels('1P', '9', [{ channel: '22' }]);
      lanesAPI.resolveLaneOptionChannels('2P', '48');
    },
  });
  define('player-engine.lanes.isPlayableInputChannel', {
    run: () => {
      lanesAPI.isPlayableInputChannel('17');
      lanesAPI.isPlayableInputChannel('01');
    },
  });
  define('player-engine.lanes.resolveAutoScratchSides', {
    run: () => {
      lanesAPI.resolveAutoScratchSides({ autoScratch1P: true, autoScratch2P: false });
    },
  });
  define('player-engine.lanes.resolveAutoScratchChannels', {
    run: () => {
      lanesAPI.resolveAutoScratchChannels({ autoScratch1P: true }, ['16', '26']);
    },
  });
  define('player-engine.lanes.resolveLaneChannels', {
    run: () => {
      lanesAPI.resolveLaneChannels(BENCH_LANE_NOTES, '7');
    },
  });
  define('player-engine.lanes.resolvePlayVariantLaneChannels', {
    run: () => {
      lanesAPI.resolvePlayVariantLaneChannels(BENCH_LANE_NOTES, '7');
    },
  });
  define('player-engine.lanes.createLaneBindings', {
    run: () => {
      lanesAPI.createLaneBindings(BENCH_7KEY_CHANNELS, { playVariant: '7', platform: 'linux' });
    },
  });
  define('player-engine.lanes.appendFreeZoneInputChannels', {
    run: () => {
      const channels = [...BENCH_7KEY_CHANNELS, '17'];
      const bindings = lanesAPI.createLaneBindings(BENCH_7KEY_CHANNELS, { playVariant: '7', platform: 'linux' });
      lanesAPI.appendFreeZoneInputChannels(lanesAPI.createInputTokenToChannelsMap(bindings), bindings, channels);
    },
  });
  define('player-engine.lanes.resolveLaneDisplayMode', {
    run: () => {
      lanesAPI.resolveLaneDisplayMode(BENCH_7KEY_CHANNELS, { playVariant: '7' });
    },
  });
  define('player-engine.lanes.createInputTokenToChannelsMap', {
    run: () => {
      lanesAPI.createInputTokenToChannelsMap(BENCH_7KEY_BINDINGS);
    },
  });
}

/** `@be-music/player-engine/display`: play notes, scrolling, the BGA cue and the chart facts a host shows. */
function registerDisplayCases(define: DefineBenchmarkCase): void {
  define('player-engine.display.extractTimedNotes', {
    run: (fixtures) => {
      displayAPI.extractTimedNotes(fixtures.sampleBmsJSON, {
        includeLandmine: true,
        includeInvisible: true,
        inferBmsLNTypeWhenMissing: true,
      });
    },
  });
  define('player-engine.display.extractPlayableNotes', {
    run: (fixtures) => {
      displayAPI.extractPlayableNotes(fixtures.sampleBmsJSON, { inferBmsLNTypeWhenMissing: true });
    },
  });
  define('player-engine.display.extractLandmineNotes', {
    run: (fixtures) => {
      displayAPI.extractLandmineNotes(fixtures.sampleBmsJSON);
    },
  });
  define('player-engine.display.extractInvisiblePlayableNotes', {
    run: (fixtures) => {
      displayAPI.extractInvisiblePlayableNotes(fixtures.sampleBmsJSON);
    },
  });
  define('player-engine.display.toTimedPlayableNote', {
    run: (fixtures) => {
      resolveChart(fixtures.sampleBmsJSON).notes.map(displayAPI.toTimedPlayableNote);
    },
  });
  define('player-engine.display.toTimedInvisibleNote', {
    run: (fixtures) => {
      resolveChart(fixtures.sampleBmsJSON).notes.map(displayAPI.toTimedInvisibleNote);
    },
  });
  define('player-engine.display.toTimedLandmineNote', {
    run: (fixtures) => {
      resolveChart(fixtures.sampleBmsJSON).notes.map(displayAPI.toTimedLandmineNote);
    },
  });
  define('player-engine.display.ScrollDistanceMapper', {
    run: () => {
      const mapper = new displayAPI.ScrollDistanceMapper(BENCH_SCROLL_TIMELINE, BENCH_SPEED_TIMELINE);
      mapper.distanceBetween(1, 9);
      mapper.maxBeatWithinDistance(1, 6);
    },
  });
  define('player-engine.display.createScrollDistanceMapper', {
    run: () => {
      const mapper = displayAPI.createScrollDistanceMapper(BENCH_SCROLL_TIMELINE, BENCH_SPEED_TIMELINE);
      mapper.firstBeatBeyondDistance(2, 6);
      mapper.hasBidirectionalScrollWithinLookahead(2);
    },
  });
  define('player-engine.display.pickActiveBGACue', {
    run: () => {
      displayAPI.pickActiveBGACue(BENCH_BGA_CUES, 37.3);
    },
  });
  define('player-engine.display.pickActiveBGAKey', {
    run: () => {
      displayAPI.pickActiveBGAKey(BENCH_BGA_CUES, 37.3);
    },
  });
  define('player-engine.display.resolveDisplayedJudgeRankValue', {
    run: (fixtures) => {
      displayAPI.resolveDisplayedJudgeRankValue(fixtures.sampleBmsJSON);
    },
  });
  define('player-engine.display.resolveDisplayedJudgeRankLabel', {
    run: (fixtures) => {
      displayAPI.resolveDisplayedJudgeRankLabel(fixtures.sampleBmsonJSON);
    },
  });
  define('player-engine.display.resolveDisplayedPlayLevelValue', {
    run: (fixtures) => {
      displayAPI.resolveDisplayedPlayLevelValue(fixtures.sampleBmsJSON);
    },
  });
  define('player-engine.display.resolveDisplayedDifficultyValue', {
    run: (fixtures) => {
      displayAPI.resolveDisplayedDifficultyValue(fixtures.sampleBmsJSON);
    },
  });
  define('player-engine.display.formatSeconds', {
    run: () => {
      displayAPI.formatSeconds(3725.37);
    },
  });
  define('player-engine.display.resolveAltModifierLabel', {
    run: () => {
      displayAPI.resolveAltModifierLabel('darwin');
      displayAPI.resolveAltModifierLabel('linux');
    },
  });
  define('player-engine.display.isImageResizeAlgorithm', {
    run: () => {
      displayAPI.isImageResizeAlgorithm('lanczos');
      displayAPI.isImageResizeAlgorithm('bicubic');
    },
  });
}

const BENCH_UI_FRAME: PlayerUIFramePayload = {
  currentBeat: 0,
  currentSeconds: 0,
  totalSeconds: 120,
  summary: {
    total: 64,
    perfect: 0,
    fast: 0,
    slow: 0,
    great: 0,
    good: 0,
    bad: 0,
    poor: 0,
    emptyPoor: 0,
    exScore: 0,
    score: 0,
  },
  notes: Array.from({ length: 32 }, (_, index) => ({
    channel: `1${(index % 7) + 1}`,
    beat: index * 0.5,
    seconds: index * 0.25,
    judged: false,
  })),
};
const BENCH_7KEY_CHANNELS = ['16', '11', '12', '13', '14', '15', '18', '19'];
const BENCH_7KEY_BINDINGS = lanesAPI.createLaneBindings(BENCH_7KEY_CHANNELS, { playVariant: '7', platform: 'linux' });
const BENCH_LANE_NOTES = Array.from({ length: 256 }, (_, index) => ({
  channel: BENCH_7KEY_CHANNELS[index % BENCH_7KEY_CHANNELS.length]!,
}));
const BENCH_SCROLL_TIMELINE = [
  { beat: 0, speed: 1 },
  { beat: 8, speed: 0.5 },
  { beat: 16, speed: -1 },
  { beat: 24, speed: 1 },
];
const BENCH_SPEED_TIMELINE = [
  { beat: 0, speed: 1 },
  { beat: 12, speed: 2 },
];
const BENCH_BGA_CUES = Array.from({ length: 512 }, (_, index) => ({ seconds: index * 0.125, key: `${index}` }));

const BENCH_REPLAY: BeMusicReplay = {
  format: 'be-music-replay',
  version: 0,
  clock: { unit: 'us', origin: 'chart-zero' },
  chart: {
    title: 'bench',
    sourceFormat: 'bms',
    laneMode: '7keys',
    total: 300,
    lnMode: 1,
    judgeRank: { percent: 75, sourceRank: 2 },
    noteCount: 64,
    notes: Array.from({ length: 64 }, (_, index) => ({
      id: index,
      channel: `1${(index % 7) + 1}`,
      type: 'normal' as const,
      timeUs: 250_000 * (index + 1),
    })),
  },
  inputs: Array.from({ length: 128 }, (_, index) => ({
    seq: index,
    timeUs: 125_000 * (index + 1) + (index % 2 === 0 ? 5_000 : 0),
    action: index % 2 === 0 ? ('down' as const) : ('up' as const),
    channels: [`1${((index >> 1) % 7) + 1}`],
  })),
  play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE' },
};
const BENCH_REPLAY_JSON = JSON.stringify(BENCH_REPLAY);

async function runSilently<T>(task: () => Promise<T>): Promise<T> {
  const stdout = process.stdout as NodeJS.WriteStream & { write: typeof process.stdout.write };
  const stderr = process.stderr as NodeJS.WriteStream & { write: typeof process.stderr.write };
  const originalStdoutWrite = stdout.write;
  const originalStderrWrite = stderr.write;

  stdout.write = ((..._args: unknown[]) => true) as typeof stdout.write;
  stderr.write = ((..._args: unknown[]) => true) as typeof stderr.write;

  try {
    return await task();
  } finally {
    stdout.write = originalStdoutWrite;
    stderr.write = originalStderrWrite;
  }
}

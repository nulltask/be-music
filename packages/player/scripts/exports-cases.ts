import { resolveChart } from '@be-music/chart';
import { parseChart } from '@be-music/parser';
import * as playerAPI from '@be-music/player';
import * as audioSinkAPI from '@be-music/player/audio-sink';
import * as courseAPI from '@be-music/player/course';
import * as displayAPI from '@be-music/player/display';
import * as lanesAPI from '@be-music/player/lanes';
import * as playlogAPI from '@be-music/player/playlog';
import * as recordsAPI from '@be-music/player/records';
import * as rulesetAPI from '@be-music/player/ruleset';
import * as signalsAPI from '@be-music/player/signals';
import type { PlayerOptions } from '@be-music/player';
import type { WebAudioContextLike } from '@be-music/player/audio-sink';
import type { BeMusicPlaylog } from '@be-music/player/playlog';
import type { PlayerUIFramePayload } from '@be-music/player/signals';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const BENCH_PLAYER_OPTIONS: PlayerOptions = {
  audio: false,
  tui: false,
  leadInMs: 0,
  speed: 8,
  highSpeed: 1,
  inferBmsLNTypeWhenMissing: true,
};

export function registerPlayerExportsCases(define: DefineBenchmarkCase): void {
  define('player.resolveChartRulesetFacts', {
    run: (fixtures) => {
      playerAPI.resolveChartRulesetFacts(fixtures.sampleBmsJSON);
    },
  });
  define('player.createTempoClock', {
    run: () => {
      const clock = playerAPI.createTempoClock(1);
      clock.setTempoAtClockMs(1000, 1.25);
      clock.setTempoAtClockMs(2000, 0.75);
      clock.chartSecondsAt(2500);
      clock.clockMsAt(2.5);
      clock.initialTempoMsAt(2500);
    },
  });
  define('player.resolvePlayChart', {
    run: (fixtures) => {
      playerAPI.resolvePlayChart(fixtures.controlFlowJSON, { random: () => 0.42 });
    },
  });
  define('player.playlog.resolveChartRulesetFacts', {
    run: (fixtures) => {
      playlogAPI.resolveChartRulesetFacts(fixtures.sampleBmsJSON);
    },
  });
  define('player.playlog.resolvePlayChart', {
    run: (fixtures) => {
      playlogAPI.resolvePlayChart(fixtures.controlFlowJSON, { random: () => 0.42 });
    },
  });
  define('player.preparePlaybackChart', {
    run: (fixtures) => {
      playerAPI.preparePlaybackChart(
        resolveChart(fixtures.sampleBmsJSON, { chartPath: '.bms', inferBmsLNTypeWhenMissing: true }),
        { laneModeExtension: '.bms' },
      );
    },
  });
  define('player.autoPlay', {
    run: async (fixtures) => {
      await runSilently(async () => {
        await playerAPI.autoPlay(fixtures.emptyBmsJSON, BENCH_PLAYER_OPTIONS);
      });
    },
    interactive: true,
    timeMs: 8,
    warmupTimeMs: 0,
  });
  define('player.manualPlay', {
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
  define('player.PlayerInterruptedError', {
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
  define('player.course.courseConstraintGroup', {
    run: () => {
      courseAPI.courseConstraintGroup('gauge_lr2');
    },
  });
  define('player.course.parseCourseConstraint', {
    run: () => {
      courseAPI.parseCourseConstraint('GAUGE_24KEYS');
    },
  });
  define('player.course.normalizeCourseConstraints', {
    run: () => {
      courseAPI.normalizeCourseConstraints(['grade_mirror', 'CLASS', 'no_good', 'gauge_lr2', 'ln']);
    },
  });
  define('player.course.isClassCourseConstraints', {
    run: () => {
      courseAPI.isClassCourseConstraints(['gauge_lr2', 'grade_mirror']);
    },
  });
  define('player.course.normalizeCourseTrophies', {
    run: () => {
      courseAPI.normalizeCourseTrophies(benchBeatorajaCourse.trophy);
    },
  });
  define('player.course.createCourseStageRef', {
    run: () => {
      courseAPI.createCourseStageRef({ md5: benchMD5, title: 'one' });
    },
  });
  define('player.course.decodeCourseText', {
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
  define('player.course.parseLR2NonstopConnections', {
    run: () => {
      courseAPI.parseLR2NonstopConnections(benchNonstopHeader);
    },
  });
  define('player.course.resolveNonstopLastMeasure', {
    run: () => {
      courseAPI.resolveNonstopLastMeasure(7.25);
      courseAPI.resolveNonstopLastMeasure(7.75);
    },
  });
  define('player.course.createNonstopStageTiming', {
    run: () => {
      courseAPI.createNonstopStageTiming(benchNonstopChart);
    },
  });
  const benchNonstopInputs = [benchNonstopChart, benchNonstopChart, benchNonstopChart].map((chart) => ({ chart }));
  define('player.course.stitchNonstopCourse', {
    run: () => {
      courseAPI.stitchNonstopCourse(benchNonstopInputs, { connections: ['fade', 'cut-fit'] });
    },
  });
  define('player.course.applyCourseLongNoteConstraint', {
    run: () => {
      courseAPI.applyCourseLongNoteConstraint(benchNonstopChart, ['cn']);
    },
  });
  define('player.course.resolveCourseStageSettings', {
    run: () => {
      courseAPI.resolveCourseStageSettings(benchCourse);
    },
  });
  define('player.course.resolveCourseLaneOptions', {
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
  define('player.course.isLR2GradeCourse', {
    run: () => {
      courseAPI.isLR2GradeCourse(benchLR2GradeDefinition);
    },
  });
  define('player.course.resolveLR2GradeCoursePlaySettings', {
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
  define('player.course.resolveCourseStagePlaySettings', {
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
  define('player.course.isCourseHiSpeedLocked', {
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
  define('player.course.resolveNonstopTempo', {
    run: () => {
      courseAPI.resolveNonstopTempo(benchReadoutStages, benchReadoutPlacements);
      courseAPI.resolveNonstopTempo(benchReadoutStages, benchReadoutPlacements, { placement: 'lr2' });
    },
  });
  define('player.course.nonstopBPMAt', {
    run: () => {
      courseAPI.nonstopBPMAt(benchStitchedMap.tempo, 3);
      courseAPI.nonstopBPMAt(benchStitchedMap.tempo, 30);
    },
  });
  define('player.course.resolveNonstopStageRanks', {
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
  const benchSplitNoteStages = BENCH_PLAYLOG.chart.notes.map((note) => (note.timeUs < 1_500_000 ? 0 : 1));
  define('player.playlog.resolveNonstopPlaylogStages', {
    run: () => {
      playlogAPI.resolveNonstopPlaylogStages(benchStitchedMap);
    },
  });
  define('player.playlog.resolveNonstopNoteStages', {
    run: () => {
      playlogAPI.resolveNonstopNoteStages(benchStitchedChart, benchStitchedMap, BENCH_PLAYLOG.chart.notes);
    },
  });
  define('player.playlog.splitNonstopPlaylog', {
    run: () => {
      playlogAPI.splitNonstopPlaylog(
        { playlog: BENCH_PLAYLOG, stages: benchSplitStages, noteStages: benchSplitNoteStages },
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
  define('player.course.prepareNonstopCourse', {
    run: () => {
      courseAPI.prepareNonstopCourse(benchPipelineStages, { ...benchPipelineOptions, random: () => 0 });
    },
  });
  const benchPrepared = courseAPI.prepareNonstopCourse(benchPipelineStages, benchPipelineOptions);
  if (!benchPrepared.ok) throw new Error(`bench NONSTOP course failed to stitch: ${benchPrepared.reason}`);
  define('player.course.resolveNonstopRun', {
    run: () => {
      courseAPI.resolveNonstopRun(benchPrepared.course, BENCH_PLAYLOG);
    },
  });
  define('player.course.buildNonstopCoursePlaylog', {
    run: () => {
      courseAPI.buildNonstopCoursePlaylog(
        { name: 'Nonstop', kind: 'nonstop', constraints: ['cn'], trophies: [], release: true },
        benchPrepared.course,
        BENCH_PLAYLOG,
      );
    },
  });
  define('player.course.planNonstopCourse', {
    run: () => {
      courseAPI.planNonstopCourse(benchNonstopStages, ['fade', 'cut-fit', 'blank1']);
      courseAPI.planNonstopCourse(benchNonstopStages, ['fade', 'cut-fit', 'blank1'], { placement: 'lr2' });
    },
  });
  define('player.course.parseLR2CourseFile', {
    run: () => {
      courseAPI.parseLR2CourseFile(benchLR2Course);
    },
  });
  const benchLR2Parsed = courseAPI.parseLR2CourseFile(benchLR2Course)[0]!;
  define('player.course.countLR2UnplayedStages', {
    run: () => {
      courseAPI.countLR2UnplayedStages(benchLR2Parsed);
    },
  });
  const benchDraftStage = { md5: 'a'.repeat(32), keyMode: 7, title: 'Song' };
  const benchDraft = { kind: 'nonstop' as const, name: 'Bench', stages: [benchDraftStage, benchDraftStage] };
  const benchMadeCourse = courseAPI.finishCourseDraft(benchDraft)!;
  define('player.course.createCourseDraft', {
    run: () => {
      courseAPI.createCourseDraft('nonstop', 'Bench');
    },
  });
  define('player.course.appendCourseDraftStage', {
    run: () => {
      courseAPI.appendCourseDraftStage(benchDraft, benchDraftStage);
    },
  });
  define('player.course.removeLastCourseDraftStage', {
    run: () => {
      courseAPI.removeLastCourseDraftStage(benchDraft);
    },
  });
  define('player.course.buildLR2CourseHash', {
    run: () => {
      courseAPI.buildLR2CourseHash({
        kind: 'nonstop',
        stageMD5s: ['a'.repeat(32), 'b'.repeat(32)],
        connections: ['cut'],
      });
    },
  });
  define('player.course.finishCourseDraft', {
    run: () => {
      courseAPI.finishCourseDraft(benchDraft, { defaultConnection: 'cut' });
    },
  });
  define('player.course.stepLR2NonstopConnection', {
    run: () => {
      courseAPI.stepLR2NonstopConnection('fade', 1);
      courseAPI.stepLR2NonstopConnection('fade', -1);
    },
  });
  define('player.course.withNonstopConnection', {
    run: () => {
      courseAPI.withNonstopConnection(benchMadeCourse, 0, 'blank1');
    },
  });
  define('player.course.defaultCourseMakerConstraints', {
    run: () => {
      courseAPI.defaultCourseMakerConstraints('grade');
    },
  });
  define('player.course.withCourseConstraints', {
    run: () => {
      courseAPI.withCourseConstraints(benchMadeCourse, ['grade', 'gauge_7k', 'no_speed']);
    },
  });
  define('player.course.courseConstraintEnumName', {
    run: () => {
      courseAPI.courseConstraintEnumName('grade_mirror');
    },
  });
  define('player.course.serializeBeatorajaCourseFile', {
    run: () => {
      courseAPI.serializeBeatorajaCourseFile([benchMadeCourse]);
    },
  });
  define('player.course.serializeLR2CourseFile', {
    run: () => {
      courseAPI.serializeLR2CourseFile([benchMadeCourse]);
    },
  });
  define('player.course.parseBeatorajaCourseData', {
    run: () => {
      courseAPI.parseBeatorajaCourseData(benchBeatorajaCourse);
    },
  });
  define('player.course.parseBeatorajaCourseFile', {
    run: () => {
      courseAPI.parseBeatorajaCourseFile(JSON.stringify([benchBeatorajaCourse]));
    },
  });
  define('player.course.parseBeatorajaRandomCourseData', {
    run: () => {
      courseAPI.parseBeatorajaRandomCourseData({
        name: 'R',
        stage: [{ sql: 'level = 12' }, {}],
        rconstraint: ['distinct'],
      });
    },
  });
  define('player.course.parseBeatorajaCommandFolderFile', {
    run: () => {
      courseAPI.parseBeatorajaCommandFolderFile(
        JSON.stringify([{ name: 'Random', rcourse: [{ name: 'R', stage: [{ sql: 'level = 12' }, {}] }] }]),
      );
    },
  });
  const benchFilterSQL =
    "song.level BETWEEN 11 AND 12 AND song.mode IN (7, 14) AND title NOT LIKE '%HYPER%' ORDER BY level DESC LIMIT 50";
  const benchFilter = courseAPI.parseCourseSongFilter(benchFilterSQL);
  const benchSongs = Array.from({ length: 200 }, (_, index) => ({
    md5: index.toString(16).padStart(32, '0'),
    sha256: index.toString(16).padStart(64, '0'),
    title: `song ${index}`,
    level: index % 13,
    mode: index % 2 === 0 ? 7 : 14,
  }));
  define('player.course.parseCourseSongFilter', {
    run: () => {
      courseAPI.parseCourseSongFilter(benchFilterSQL);
    },
  });
  define('player.course.evaluateCourseSongFilter', {
    run: () => {
      if (benchFilter.ok) for (const song of benchSongs) courseAPI.evaluateCourseSongFilter(benchFilter.filter, song);
    },
  });
  define('player.course.selectCourseSongs', {
    run: () => {
      if (benchFilter.ok) courseAPI.selectCourseSongs(benchFilter.query, benchSongs, (song) => song);
    },
  });
  let benchSeed = 1;
  define('player.course.drawRandomCourse', {
    run: () => {
      courseAPI.drawRandomCourse(
        {
          name: 'R',
          stages: [{ filter: 'level = 12' }, {}, { filter: 'level >= 10' }, {}],
          constraints: ['grade_mirror'],
          trophies: [],
          distinct: true,
        },
        benchSongs,
        () => {
          benchSeed = (benchSeed * 16807) % 2147483647;
          return (benchSeed - 1) / 2147483646;
        },
      );
    },
  });
  define('player.course.resolveTableModeKeys', {
    run: () => {
      courseAPI.resolveTableModeKeys('beat-7k');
    },
  });
  define('player.course.parseTableHeaderCourses', {
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
  define('player.course.resolveTableHeaderURL', {
    run: () => {
      courseAPI.resolveTableHeaderURL(benchTablePageURL, benchTablePage);
    },
  });
  define('player.course.fetchTableHeaderCourses', {
    run: async () => {
      await courseAPI.fetchTableHeaderCourses(benchTablePageURL, benchTableFetch);
    },
  });
  define('player.course.resolveCourseStages', {
    run: () => {
      courseAPI.resolveCourseStages(benchCourse, { bySHA256: () => 'chart', byMD5: () => 'chart' });
    },
  });
  define('player.playlog.checkPlaylogEligibility', {
    run: () => {
      playlogAPI.checkPlaylogEligibility(BENCH_PLAYLOG);
    },
  });
  define('player.playlog.serializePlaylog', {
    run: () => {
      playlogAPI.serializePlaylog(BENCH_PLAYLOG);
    },
  });
  define('player.playlog.createPlaylogRecorder', {
    run: () => {
      const json = parseChart('#BPM 120\n#00111:01\n');
      playlogAPI
        .createPlaylogRecorder({
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
        })
        .recordInput('down', 0.5, ['z'], ['11']);
    },
  });
  define('player.playlog.PlaylogParseError', {
    run: () => {
      void new playlogAPI.PlaylogParseError('bench');
    },
  });
  define('player.playlog.resolvePlaylogFilename', {
    run: () => {
      playlogAPI.resolvePlaylogFilename(BENCH_PLAYLOG, new Date(0));
    },
  });
  define('player.playlog.resolveRulesetConfig', {
    run: () => {
      playlogAPI.resolveRulesetConfig(BENCH_PLAYLOG, 'beatoraja');
    },
  });
  define('player.playlog.resolveLR2DefaultTotal', {
    run: () => {
      playlogAPI.resolveLR2DefaultTotal(1200);
    },
  });
  define('player.playlog.resolveBeatorajaDefaultTotal', {
    run: () => {
      playlogAPI.resolveBeatorajaDefaultTotal(1200);
    },
  });
  define('player.playlog.resolveIIDXGaugeUnit', {
    run: () => {
      playlogAPI.resolveIIDXGaugeUnit(1200);
    },
  });
  define('player.playlog.resolveLR2HardDamageMultiplier', {
    run: () => {
      playlogAPI.resolveLR2HardDamageMultiplier(300, 1200);
    },
  });
  define('player.playlog.resolveBeatorajaHardRecoverMultiplier', {
    run: () => {
      playlogAPI.resolveBeatorajaHardRecoverMultiplier(300, 1200);
    },
  });
  define('player.playlog.parsePlaylog', {
    run: () => {
      playlogAPI.parsePlaylog(BENCH_PLAYLOG_JSON);
    },
  });
  define('player.playlog.simulatePlaylog', {
    run: () => {
      playlogAPI.simulatePlaylog(BENCH_PLAYLOG, { ruleset: 'lr2' });
    },
  });
  define('player.playlog.simulatePlaylogRulesets', {
    run: () => {
      playlogAPI.simulatePlaylogRulesets(BENCH_PLAYLOG);
    },
  });
  const benchCourseInfo = {
    name: 'Dan',
    kind: 'grade' as const,
    constraints: ['grade_mirror', 'gauge_lr2'],
    trophies: [{ name: 'gold', missRate: 5, scoreRate: 80 }],
  };
  const benchCourseLog = playlogAPI.createCoursePlaylog({
    course: benchCourseInfo,
    stages: [
      { played: true, playlog: BENCH_PLAYLOG },
      { played: true, playlog: BENCH_PLAYLOG },
    ],
  });
  const benchCourseText = playlogAPI.serializeCoursePlaylog(benchCourseLog);
  const benchStageResult = playlogAPI.simulatePlaylog(BENCH_PLAYLOG, { ruleset: 'lr2' });
  const benchRunStageLog: BeMusicPlaylog = { ...BENCH_PLAYLOG, results: { native: benchStageResult } };
  const benchRunStages = [
    { chart: benchNonstopChart, chartPath: 'a.bms' },
    { chart: benchNonstopChart, chartPath: 'b.bms' },
  ];
  define('player.course.CourseRun', {
    run: () => {
      const run = new courseAPI.CourseRun(benchCourse, benchRunStages);
      run.nextStage();
      run.recordStage(benchRunStageLog, { playSeconds: 16 });
      run.nextStage();
      run.buildPlaylog();
    },
  });
  define('player.course.resolveGivenUpPlaySeconds', {
    run: () => {
      courseAPI.resolveGivenUpPlaySeconds(BENCH_PLAYLOG);
      courseAPI.resolveGivenUpPlaySeconds({ play: { ...BENCH_PLAYLOG.play, aborted: true, abortedAtUs: 4_000_000 } });
    },
  });
  define('player.playlog.aggregateCourseResult', {
    run: () => {
      playlogAPI.aggregateCourseResult(
        'lr2/0',
        benchCourseInfo,
        [benchStageResult, benchStageResult],
        [10, 10],
        'GROOVE',
      );
    },
  });
  define('player.playlog.createCoursePlaylog', {
    run: () => {
      playlogAPI.createCoursePlaylog({ course: benchCourseInfo, stages: [{ played: true, playlog: BENCH_PLAYLOG }] });
    },
  });
  define('player.playlog.extractCourseStage', {
    run: () => {
      playlogAPI.extractCourseStage(benchCourseLog, 1);
    },
  });
  define('player.playlog.parseCoursePlaylog', {
    run: () => {
      playlogAPI.parseCoursePlaylog(benchCourseText);
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
  define('player.records.mergeBestRecord', {
    run: () => {
      recordsAPI.mergeBestRecord(benchRecord, benchRecordPlay);
    },
  });
  define('player.records.mergeCourseStageRecord', {
    run: () => {
      recordsAPI.mergeCourseStageRecord(benchRecord, benchRecordPlay);
    },
  });
  define('player.records.recordPlayFromResult', {
    run: () => {
      recordsAPI.recordPlayFromResult(benchRecordResult);
    },
  });
  define('player.records.recordPlayFromSummary', {
    run: () => {
      recordsAPI.recordPlayFromSummary(benchRecordSummary, 400, 'lr2');
    },
  });
  define('player.records.courseStageRecordPlayFromResult', {
    run: () => {
      recordsAPI.courseStageRecordPlayFromResult(benchRecordResult);
    },
  });
  define('player.records.courseStageRecordPlayFromSummary', {
    run: () => {
      recordsAPI.courseStageRecordPlayFromSummary(benchRecordSummary, 400, 'lr2');
    },
  });
  define('player.records.courseRunRecordPlay', {
    run: () => {
      recordsAPI.courseRunRecordPlay(benchRecordPlay);
    },
  });
  define('player.records.playKeepsRecord', {
    run: () => {
      recordsAPI.playKeepsRecord(benchRecordKind);
    },
  });
  define('player.records.courseStageKeepsRecord', {
    run: () => {
      recordsAPI.courseStageKeepsRecord(benchRecordKind);
    },
  });
  define('player.records.isCourseRunAtAnotherTempo', {
    run: () => {
      recordsAPI.isCourseRunAtAnotherTempo(benchCourseLog);
    },
  });
  define('player.records.isCourseRunAutoPlayed', {
    run: () => {
      recordsAPI.isCourseRunAutoPlayed(benchCourseLog);
    },
  });
  define('player.records.courseRunKeepsRecord', {
    run: () => {
      recordsAPI.courseRunKeepsRecord(benchCourseLog);
    },
  });
  define('player.ruleset.isClearLamp', {
    run: () => {
      rulesetAPI.isClearLamp('EX_HARD');
    },
  });
  define('player.ruleset.clearLampRank', {
    run: () => {
      rulesetAPI.clearLampRank('FULL_COMBO');
    },
  });
  define('player.ruleset.clearLampAtRank', {
    run: () => {
      rulesetAPI.clearLampAtRank(7);
    },
  });
  define('player.ruleset.betterClearLamp', {
    run: () => {
      rulesetAPI.betterClearLamp('HARD', 'FULL_COMBO');
    },
  });
  define('player.ruleset.topClearLamp', {
    run: () => {
      rulesetAPI.topClearLamp('lr2');
    },
  });
  define('player.ruleset.isFullCombo', {
    run: () => {
      rulesetAPI.isFullCombo(benchLampScore);
    },
  });
  define('player.ruleset.resolveClearLamp', {
    run: () => {
      rulesetAPI.resolveClearLamp({ ruleset: 'beatoraja', cleared: true, gauge: 'HARD', score: benchLampScore });
    },
  });
  define('player.ruleset.resolveCourseClearLamp', {
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
  define('player.ruleset.resolveMissCount', {
    run: () => {
      rulesetAPI.resolveMissCount({ bad: 3, poor: 5, emptyPoor: 2 }, 10);
    },
  });
  define('player.ruleset.isGaugeType', {
    run: () => {
      rulesetAPI.isGaugeType('DEATH');
    },
  });
  define('player.ruleset.createEmptyScore', {
    run: () => {
      rulesetAPI.createEmptyScore(1000);
    },
  });
  define('player.ruleset.computeScoreRate', {
    run: () => {
      rulesetAPI.computeScoreRate({ total: 1000, exScore: 1650 });
    },
  });
  define('player.ruleset.resolveIIDXRankIndexFromScore', {
    run: () => {
      rulesetAPI.resolveIIDXRankIndexFromScore({ total: 1000, exScore: 1650 });
    },
  });
  define('player.ruleset.resolveIIDXRankLabel', {
    run: () => {
      rulesetAPI.resolveIIDXRankLabel(1650, 1000);
    },
  });
  define('player.ruleset.resolveLR2MoneyScore', {
    run: () => {
      rulesetAPI.resolveLR2MoneyScore({ total: 1000, perfect: 700, great: 250, good: 30 });
    },
  });
  define('player.ruleset.resolveDisplayedPoor', {
    run: () => {
      rulesetAPI.resolveDisplayedPoor({ poor: 5, emptyPoor: 2 }, true);
    },
  });
  define('player.playlog.resolveCourseLamp', {
    run: () => {
      playlogAPI.resolveCourseLamp('beatoraja', benchStageResult, 'GROOVE');
    },
  });
  define('player.playlog.resolveCoursePlayedRuleset', {
    run: () => {
      playlogAPI.resolveCoursePlayedRuleset(benchCourseLog);
    },
  });
  define('player.playlog.resolveRulesetResultLamp', {
    run: () => {
      playlogAPI.resolveRulesetResultLamp(benchStageResult, 'lr2');
    },
  });
  define('player.playlog.resolveCoursePlaylogFilename', {
    run: () => {
      playlogAPI.resolveCoursePlaylogFilename(benchCourseLog);
    },
  });
  define('player.playlog.resolveCourseStageStartGauge', {
    run: () => {
      playlogAPI.resolveCourseStageStartGauge(
        'lr2',
        { kind: 'grade', carryIn: { gauge: 64, combo: 0, maxCombo: 0 } },
        'GROOVE',
      );
    },
  });
  define('player.playlog.resolveCourseTrophy', {
    run: () => {
      playlogAPI.resolveCourseTrophy(benchCourseInfo.trophies, { missCount: 4, exScore: 170, noteCount: 100 });
    },
  });
  define('player.playlog.serializeCoursePlaylog', {
    run: () => {
      playlogAPI.serializeCoursePlaylog(benchCourseLog);
    },
  });
  define('player.playlog.simulateCoursePlaylog', {
    run: () => {
      playlogAPI.simulateCoursePlaylog(benchCourseLog, { ruleset: 'lr2' });
    },
  });
  const benchKeyedCourseLog = playlogAPI.createCoursePlaylog({
    course: benchCourseInfo,
    stages: [
      {
        played: true,
        playlog: {
          ...BENCH_PLAYLOG,
          chart: {
            ...BENCH_PLAYLOG.chart,
            chartFingerprint: 'bmfp0:bench-stage-1',
            playFingerprint: 'bmfp0:bench-stage-1',
          },
          play: { ...BENCH_PLAYLOG.play, course: { kind: 'grade' } },
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
  define('player.playlog.createCourseFingerprintDocument', {
    run: () => {
      playlogAPI.createCourseFingerprintDocument({
        kind: 'nonstop',
        constraints: [],
        stageChartFingerprints: ['bmfp0:a', 'bmfp0:b', 'bmfp0:c'],
        nonstop: { connections: ['cut'], placement: 'intended' },
      });
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
  define('player.playlog.resolvePlaylogViewAt', {
    run: () => {
      playlogAPI.resolvePlaylogViewAt(benchView, benchViewChanges, 1_500_000);
    },
  });
  define('player.playlog.resolvePlaylogTempoAt', {
    run: () => {
      playlogAPI.resolvePlaylogTempoAt(1, benchTempoChanges, 1_500_000);
    },
  });
  define('player.playlog.playedAtAnotherTempo', {
    run: () => {
      playlogAPI.playedAtAnotherTempo({ tempoChanges: benchTempoChanges });
    },
  });
  define('player.playlog.resolveReplayView', {
    run: () => {
      playlogAPI.resolveReplayView(benchView, { hiSpeed: 1 }, playlogAPI.DEFAULT_PLAYLOG_VIEW_REPLAY);
    },
  });
  define('player.playlog.resolveReplayHiSpeed', {
    run: () => {
      playlogAPI.resolveReplayHiSpeed(
        { ...benchView, hiSpeedScale: 'beatoraja', visibleMs: 400 },
        'be-music',
        (ms) => 1000 / ms,
      );
    },
  });
  define('player.playlog.roundPlaylogView', {
    run: () => {
      playlogAPI.roundPlaylogView({ ...benchView, hiSpeed: 2.5000000000000004 });
    },
  });
  define('player.playlog.diffPlaylogView', {
    run: () => {
      playlogAPI.diffPlaylogView(benchView, { ...benchView, hiSpeed: 2.5 });
    },
  });
  define('player.playlog.createPlaylogViewCoalescer', {
    run: () => {
      const coalescer = playlogAPI.createPlaylogViewCoalescer(benchView);
      coalescer.observe({ ...benchView, hiSpeed: 2.5 }, 0);
    },
  });
  define('player.playlog.parsePlaylogViewState', {
    run: () => {
      playlogAPI.parsePlaylogViewState(benchView, 'play.view');
    },
  });
  define('player.playlog.parsePlaylogViewChanges', {
    run: () => {
      playlogAPI.parsePlaylogViewChanges(benchViewChanges, 'play.viewChanges');
    },
  });
  define('player.playlog.parsePlaylogTempoChanges', {
    run: () => {
      playlogAPI.parsePlaylogTempoChanges(benchTempoChanges, 'play.tempoChanges');
    },
  });
  define('player.playlog.computeCourseFingerprint', {
    run: () => {
      playlogAPI.computeCourseFingerprint({
        kind: 'grade',
        constraints: ['grade_mirror', 'gauge_lr2'],
        stageChartFingerprints: ['bmfp0:a', 'bmfp0:b', 'bmfp0:c', 'bmfp0:d'],
      });
    },
  });
  define('player.playlog.resolveCourseStageChartFingerprints', {
    run: () => {
      playlogAPI.resolveCourseStageChartFingerprints(benchKeyedCourseLog);
    },
  });
  define('player.playlog.computeCoursePlaylogFingerprint', {
    run: () => {
      playlogAPI.computeCoursePlaylogFingerprint(benchKeyedCourseLog);
    },
  });
  define('player.playlog.checkCoursePlaylogEligibility', {
    run: () => {
      playlogAPI.checkCoursePlaylogEligibility(benchKeyedCourseLog);
    },
  });
  define('player.ruleset.resolveJudgeWindowsMs', {
    run: (fixtures) => {
      rulesetAPI.resolveJudgeWindowsMs(fixtures.sampleBmsJSON, 250);
    },
  });
  define('player.ruleset.isPlaylogRulesetId', {
    run: () => {
      rulesetAPI.isPlaylogRulesetId('beatoraja');
      rulesetAPI.isPlaylogRulesetId('popn');
    },
  });
  registerSignalsCases(define);
  registerLanesCases(define);
  registerDisplayCases(define);
  registerAudioSinkCases(define);
}

/** `@be-music/player/signals`: the buses and state signals a host's runtimes exchange with a play. */
function registerSignalsCases(define: DefineBenchmarkCase): void {
  define('player.signals.createPlayerInputSignalBus', {
    run: () => {
      const bus = signalsAPI.createPlayerInputSignalBus();
      bus.pushCommand({ kind: 'lane-input', tokens: ['KeyZ'] });
      bus.pushCommand({ kind: 'high-speed', action: 'increase' });
      bus.drainCommands();
    },
  });
  define('player.signals.createPlayerUISignalBus', {
    run: () => {
      const bus = signalsAPI.createPlayerUISignalBus(BENCH_UI_FRAME);
      bus.publishFrame({ ...BENCH_UI_FRAME, currentBeat: 4, currentSeconds: 2 });
      bus.pushCommand({ kind: 'flash-lane', channel: '11' });
      bus.drainCommands();
    },
  });
  define('player.signals.createPlayerStateSignals', {
    run: () => {
      const signals = signalsAPI.createPlayerStateSignals(2);
      signals.publishJudgeCombo('PERFECT', 1, '11', 0, 3);
      signals.publishJudgeCombo('GREAT', 2, '12', 1, -8);
      signals.drainPendingJudgeCombos();
    },
  });
  define('player.signals.resolveHighSpeedControlActionFromLaneChannels', {
    run: () => {
      signalsAPI.resolveHighSpeedControlActionFromLaneChannels(['12', '14']);
    },
  });
  define('player.signals.resolveHighSpeedMultiplier', {
    run: () => {
      signalsAPI.resolveHighSpeedMultiplier(3.25);
    },
  });
  define('player.signals.applyHighSpeedControlAction', {
    run: () => {
      signalsAPI.applyHighSpeedControlAction(2, 'increase');
    },
  });
}

/** `@be-music/player/lanes`: lane layout, key bindings and FREE ZONE input. */
function registerLanesCases(define: DefineBenchmarkCase): void {
  define('player.lanes.resolveKeyChannel', {
    run: () => {
      lanesAPI.resolveKeyChannel({ code: 'KeyS' }, BENCH_7KEY_CHANNELS);
    },
  });
  define('player.lanes.resolveSideKeySlot', {
    run: () => {
      lanesAPI.resolveSideKeySlot('25', '14');
    },
  });
  define('player.lanes.resolveLR2LaneIndex', {
    run: () => {
      lanesAPI.resolveLR2LaneIndex('26', '14');
    },
  });
  define('player.lanes.resolveSideRelativeLaneIndex', {
    run: () => {
      lanesAPI.resolveSideRelativeLaneIndex('23', '14');
    },
  });
  define('player.lanes.isScratch', {
    run: () => {
      lanesAPI.isScratch('16');
      lanesAPI.isScratch('11');
    },
  });
  define('player.lanes.resolveWheelLaneDirection', {
    run: () => {
      lanesAPI.resolveWheelLaneDirection('1P', '24');
    },
  });
  define('player.lanes.resolveLaneOptionChannels', {
    run: () => {
      lanesAPI.resolveLaneOptionChannels('1P', '7');
    },
  });
  define('player.lanes.isPlayableInputChannel', {
    run: () => {
      lanesAPI.isPlayableInputChannel('17');
      lanesAPI.isPlayableInputChannel('01');
    },
  });
  define('player.lanes.resolveLaneChannels', {
    run: () => {
      lanesAPI.resolveLaneChannels(BENCH_LANE_NOTES, '7');
    },
  });
  define('player.lanes.resolvePlayVariantLaneChannels', {
    run: () => {
      lanesAPI.resolvePlayVariantLaneChannels(BENCH_LANE_NOTES, '7');
    },
  });
  define('player.lanes.createLaneBindings', {
    run: () => {
      lanesAPI.createLaneBindings(BENCH_7KEY_CHANNELS, { playVariant: '7', platform: 'linux' });
    },
  });
  define('player.lanes.appendFreeZoneInputChannels', {
    run: () => {
      const channels = [...BENCH_7KEY_CHANNELS, '17'];
      const bindings = lanesAPI.createLaneBindings(BENCH_7KEY_CHANNELS, { playVariant: '7', platform: 'linux' });
      lanesAPI.appendFreeZoneInputChannels(lanesAPI.createInputTokenToChannelsMap(bindings), bindings, channels);
    },
  });
  define('player.lanes.resolveLaneDisplayMode', {
    run: () => {
      lanesAPI.resolveLaneDisplayMode(BENCH_7KEY_CHANNELS, { playVariant: '7' });
    },
  });
  define('player.lanes.createInputTokenToChannelsMap', {
    run: () => {
      lanesAPI.createInputTokenToChannelsMap(BENCH_7KEY_BINDINGS);
    },
  });
}

/** `@be-music/player/display`: play notes, scrolling, the BGA cue and the chart facts a host shows. */
function registerDisplayCases(define: DefineBenchmarkCase): void {
  define('player.display.extractTimedNotes', {
    run: (fixtures) => {
      displayAPI.extractTimedNotes(fixtures.sampleBmsJSON, {
        includeLandmine: true,
        includeInvisible: true,
        inferBmsLNTypeWhenMissing: true,
      });
    },
  });
  define('player.display.extractPlayableNotes', {
    run: (fixtures) => {
      displayAPI.extractPlayableNotes(fixtures.sampleBmsJSON, { inferBmsLNTypeWhenMissing: true });
    },
  });
  define('player.display.extractLandmineNotes', {
    run: (fixtures) => {
      displayAPI.extractLandmineNotes(fixtures.sampleBmsJSON);
    },
  });
  define('player.display.extractInvisiblePlayableNotes', {
    run: (fixtures) => {
      displayAPI.extractInvisiblePlayableNotes(fixtures.sampleBmsJSON);
    },
  });
  define('player.display.toTimedPlayableNote', {
    run: (fixtures) => {
      resolveChart(fixtures.sampleBmsJSON).notes.map(displayAPI.toTimedPlayableNote);
    },
  });
  define('player.display.toTimedInvisibleNote', {
    run: (fixtures) => {
      resolveChart(fixtures.sampleBmsJSON).notes.map(displayAPI.toTimedInvisibleNote);
    },
  });
  define('player.display.toTimedLandmineNote', {
    run: (fixtures) => {
      resolveChart(fixtures.sampleBmsJSON).notes.map(displayAPI.toTimedLandmineNote);
    },
  });
  define('player.display.ScrollDistanceMapper', {
    run: () => {
      const mapper = new displayAPI.ScrollDistanceMapper(BENCH_SCROLL_TIMELINE, BENCH_SPEED_TIMELINE);
      mapper.distanceBetween(1, 9);
      mapper.maxBeatWithinDistance(1, 6);
    },
  });
  define('player.display.createScrollDistanceMapper', {
    run: () => {
      const mapper = displayAPI.createScrollDistanceMapper(BENCH_SCROLL_TIMELINE, BENCH_SPEED_TIMELINE);
      mapper.firstBeatBeyondDistance(2, 6);
      mapper.hasBidirectionalScrollWithinLookahead(2);
    },
  });
  define('player.display.pickActiveBGACue', {
    run: () => {
      displayAPI.pickActiveBGACue(BENCH_BGA_CUES, 37.3);
    },
  });
  define('player.display.pickActiveBGAKey', {
    run: () => {
      displayAPI.pickActiveBGAKey(BENCH_BGA_CUES, 37.3);
    },
  });
  define('player.display.resolveDisplayedJudgeRankValue', {
    run: (fixtures) => {
      displayAPI.resolveDisplayedJudgeRankValue(fixtures.sampleBmsJSON);
    },
  });
  define('player.display.resolveDisplayedJudgeRankLabel', {
    run: (fixtures) => {
      displayAPI.resolveDisplayedJudgeRankLabel(fixtures.sampleBmsonJSON);
    },
  });
  define('player.display.resolveDisplayedPlayLevelValue', {
    run: (fixtures) => {
      displayAPI.resolveDisplayedPlayLevelValue(fixtures.sampleBmsJSON);
    },
  });
  define('player.display.resolveDisplayedDifficultyValue', {
    run: (fixtures) => {
      displayAPI.resolveDisplayedDifficultyValue(fixtures.sampleBmsJSON);
    },
  });
  define('player.display.formatSeconds', {
    run: () => {
      displayAPI.formatSeconds(3725.37);
    },
  });
  define('player.display.resolveAltModifierLabel', {
    run: () => {
      displayAPI.resolveAltModifierLabel('darwin');
      displayAPI.resolveAltModifierLabel('linux');
    },
  });
  define('player.display.isImageResizeAlgorithm', {
    run: () => {
      displayAPI.isImageResizeAlgorithm('lanczos');
      displayAPI.isImageResizeAlgorithm('bicubic');
    },
  });
}

/** `@be-music/player/audio-sink`: the PCM sinks over Web Audio. */
function registerAudioSinkCases(define: DefineBenchmarkCase): void {
  define('player.audio-sink.createBrowserAudioSink', {
    run: () => {
      const sink = audioSinkAPI.createBrowserAudioSink(createBenchAudioContext(), {
        sampleRate: 44_100,
        channels: 2,
        samplesPerFrame: 512,
        mode: 'manual',
      });
      sink.write(BENCH_PCM_CHUNK);
      sink.getClockState();
    },
  });
  define('player.audio-sink.createNodeAudioSink', {
    // Opens the machine's audio output through node-web-audio-api.
    run: async () => {
      const sink = await audioSinkAPI.createNodeAudioSink({
        sampleRate: 44_100,
        channels: 2,
        samplesPerFrame: 512,
        mode: 'manual',
      });
      sink?.destroy();
    },
    interactive: true,
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
const BENCH_PCM_CHUNK = new Uint8Array(new Int16Array(1024).buffer);

function createBenchAudioContext(): WebAudioContextLike {
  return {
    currentTime: 0,
    destination: {},
    createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => ({ buffer: null, connect: () => undefined, start: () => undefined }),
    suspend: async () => undefined,
    resume: async () => undefined,
  };
}

const BENCH_PLAYLOG: BeMusicPlaylog = {
  format: 'be-music-playlog',
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
const BENCH_PLAYLOG_JSON = JSON.stringify(BENCH_PLAYLOG);

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

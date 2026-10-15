import { resolveChart } from '@be-music/chart';
import { parseChart } from '@be-music/parser';
import * as playerApi from '@be-music/player';
import * as courseApi from '@be-music/player/course';
import * as judgingApi from '@be-music/player/judging';
import * as playlogApi from '@be-music/player/playlog';
import type { PlayerOptions } from '@be-music/player';
import type { BeMusicPlaylog } from '@be-music/player/playlog';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const BENCH_PLAYER_OPTIONS: PlayerOptions = {
  audio: false,
  tui: false,
  leadInMs: 0,
  speed: 8,
  highSpeed: 1,
  inferBmsLnTypeWhenMissing: true,
};

export function registerPlayerExportsCases(define: DefineBenchmarkCase): void {
  define('player.applyFastSlowForJudge', {
    run: () => {
      const summary = { fast: 0, slow: 0 };
      playerApi.applyFastSlowForJudge(summary, 'GREAT', -8);
    },
  });
  define('player.applyHighSpeedControlAction', {
    run: () => {
      playerApi.applyHighSpeedControlAction(2, 'increase');
    },
  });
  define('player.resolveHighSpeedControlActionFromLaneChannels', {
    run: () => {
      playerApi.resolveHighSpeedControlActionFromLaneChannels(['11']);
    },
  });
  define('player.resolveJudgeWindowsMs', {
    run: (fixtures) => {
      playerApi.resolveJudgeWindowsMs(fixtures.sampleBmsJson, 250);
    },
  });
  define('player.resolveChartRulesetFacts', {
    run: (fixtures) => {
      playerApi.resolveChartRulesetFacts(fixtures.sampleBmsJson);
    },
  });
  define('player.extractPlayableNotes', {
    run: (fixtures) => {
      playerApi.extractPlayableNotes(fixtures.sampleBmsJson, { inferBmsLnTypeWhenMissing: true });
    },
  });
  define('player.extractLandmineNotes', {
    run: (fixtures) => {
      playerApi.extractLandmineNotes(fixtures.sampleBmsJson);
    },
  });
  define('player.extractInvisiblePlayableNotes', {
    run: (fixtures) => {
      playerApi.extractInvisiblePlayableNotes(fixtures.sampleBmsJson);
    },
  });
  define('player.extractTimedNotes', {
    run: (fixtures) => {
      playerApi.extractTimedNotes(fixtures.sampleBmsJson, {
        includeLandmine: true,
        includeInvisible: true,
        inferBmsLnTypeWhenMissing: true,
      });
    },
  });
  define('player.formatRandomPatternSummary', {
    run: (fixtures) => {
      playerApi.formatRandomPatternSummary(fixtures.randomPatterns);
    },
  });
  define('player.shouldUseAutoMixBgmHeadroomControl', {
    run: () => {
      playerApi.shouldUseAutoMixBgmHeadroomControl({ limiter: false });
    },
  });
  define('player.resolveBgmHeadroomGain', {
    run: (fixtures) => {
      playerApi.resolveBgmHeadroomGain(fixtures.playableRenderResult, fixtures.bgmRenderResult);
    },
  });
  define('player.resolveBmsControlFlowForPlayback', {
    run: (fixtures) => {
      playerApi.resolveBmsControlFlowForPlayback(fixtures.controlFlowJson, () => 0.42);
    },
  });
  define('player.resolvePlayChart', {
    run: (fixtures) => {
      playerApi.resolvePlayChart(fixtures.controlFlowJson, { random: () => 0.42 });
    },
  });
  define('player.playlog.resolveChartRulesetFacts', {
    run: (fixtures) => {
      playlogApi.resolveChartRulesetFacts(fixtures.sampleBmsJson);
    },
  });
  define('player.playlog.resolvePlayChart', {
    run: (fixtures) => {
      playlogApi.resolvePlayChart(fixtures.controlFlowJson, { random: () => 0.42 });
    },
  });
  define('player.preparePlaybackChartData', {
    run: (fixtures) => {
      playerApi.preparePlaybackChartData(
        fixtures.sampleBmsJson,
        { showInvisibleNotes: true, laneModeExtension: '.bms' },
        true /* inferBmsLnTypeWhenMissing */,
        0 /* auxiliaryPlaybackEndSeconds */,
      );
    },
  });
  define('player.preparePlaybackChart', {
    run: (fixtures) => {
      playerApi.preparePlaybackChart(
        resolveChart(fixtures.sampleBmsJson, { chartPath: '.bms', inferBmsLnTypeWhenMissing: true }),
        { laneModeExtension: '.bms' },
      );
    },
  });
  define('player.judging.findClosestCandidateInWindow', {
    run: () => {
      judgingApi.findClosestCandidateInWindow(
        [
          { channel: '11', seconds: 0.95, hit: false },
          { channel: '11', seconds: 1.02, hit: false },
        ],
        { channel: '11', nowSec: 1, judgeWindowSec: 0.05, isConsumed: (note) => note.hit },
      );
    },
  });
  define('player.autoPlay', {
    run: async (fixtures) => {
      await runSilently(async () => {
        await playerApi.autoPlay(fixtures.emptyBmsJson, BENCH_PLAYER_OPTIONS);
      });
    },
    interactive: true,
    timeMs: 8,
    warmupTimeMs: 0,
  });
  define('player.manualPlay', {
    run: async (fixtures) => {
      await runSilently(async () => {
        await playerApi.manualPlay(fixtures.emptyBmsJson, {
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
      new playerApi.PlayerInterruptedError('escape');
    },
  });
  const benchMd5 = '0123456789abcdef0123456789abcdef';
  const benchSha256 = 'a'.repeat(64);
  const benchLr2Course = `<courselist><course><title>Dan</title><line>7</line><type>2</type><hash>${'0'.repeat(10)}2${'0'.repeat(21)}${benchMd5.repeat(4)}</hash></course></courselist>`;
  const benchBeatorajaCourse = {
    name: 'Dan',
    hash: [{ md5: benchMd5, title: 'one' }, { sha256: benchSha256 }],
    constraint: ['MIRROR', 'GAUGE_LR2', 'LN'],
    trophy: [{ name: 'gold', missrate: 2.5, scorerate: 85 }],
  };
  const benchTableHeader = {
    mode: 'beat-7k',
    course: [
      [{ name: 'sl0', constraint: ['grade_mirror', 'gauge_lr2'], md5: [benchMd5, benchMd5, benchMd5, benchMd5] }],
    ],
  };
  const benchCourse = courseApi.parseBeatorajaCourseData(benchBeatorajaCourse)!;
  define('player.course.courseConstraintGroup', {
    run: () => {
      courseApi.courseConstraintGroup('gauge_lr2');
    },
  });
  define('player.course.parseCourseConstraint', {
    run: () => {
      courseApi.parseCourseConstraint('GAUGE_24KEYS');
    },
  });
  define('player.course.normalizeCourseConstraints', {
    run: () => {
      courseApi.normalizeCourseConstraints(['grade_mirror', 'CLASS', 'no_good', 'gauge_lr2', 'ln']);
    },
  });
  define('player.course.isClassCourseConstraints', {
    run: () => {
      courseApi.isClassCourseConstraints(['gauge_lr2', 'grade_mirror']);
    },
  });
  define('player.course.normalizeCourseTrophies', {
    run: () => {
      courseApi.normalizeCourseTrophies(benchBeatorajaCourse.trophy);
    },
  });
  define('player.course.createCourseStageRef', {
    run: () => {
      courseApi.createCourseStageRef({ md5: benchMd5, title: 'one' });
    },
  });
  define('player.course.decodeCourseText', {
    run: () => {
      courseApi.decodeCourseText(new TextEncoder().encode(benchLr2Course));
    },
  });
  const benchNonstopHeader = `0125${'0'.repeat(6)}1${'0'.repeat(21)}`;
  const benchNonstopChart = parseChart(
    ['#BPM 150', '#BPM01 180', '#00002:0.75', '#00111:01010101', '#00301:01', '#00408:01', '#00512:0001'].join('\n'),
    'bms',
  );
  const benchNonstopStage = courseApi.createNonstopStageTiming(benchNonstopChart);
  const benchNonstopStages = [benchNonstopStage, benchNonstopStage, benchNonstopStage, benchNonstopStage];
  define('player.course.parseLr2NonstopConnections', {
    run: () => {
      courseApi.parseLr2NonstopConnections(benchNonstopHeader);
    },
  });
  define('player.course.resolveNonstopLastMeasure', {
    run: () => {
      courseApi.resolveNonstopLastMeasure(7.25);
      courseApi.resolveNonstopLastMeasure(7.75);
    },
  });
  define('player.course.createNonstopStageTiming', {
    run: () => {
      courseApi.createNonstopStageTiming(benchNonstopChart);
    },
  });
  const benchNonstopInputs = [benchNonstopChart, benchNonstopChart, benchNonstopChart].map((chart) => ({ chart }));
  define('player.course.stitchNonstopCourse', {
    run: () => {
      courseApi.stitchNonstopCourse(benchNonstopInputs, { connections: ['fade', 'cut-fit'] });
    },
  });
  define('player.course.applyCourseLongNoteConstraint', {
    run: () => {
      courseApi.applyCourseLongNoteConstraint(benchNonstopChart, ['cn']);
    },
  });
  const benchStitched = courseApi.stitchNonstopCourse(benchNonstopInputs, { connections: ['fade', 'cut-fit'] });
  const benchStitchedMap = benchStitched.ok ? benchStitched.map : { stages: [], tempo: [], stageRanks: [] };
  const benchReadoutPlacements = courseApi.planNonstopCourse(benchNonstopStages.slice(0, 3), ['fade', 'cut-fit']);
  const benchReadoutStages = [0, 1, 2].map((index) => ({
    tempo: [
      { seconds: 0, bpm: 150 },
      { seconds: 4.8, bpm: 180 },
    ],
    headerBpm: 150,
    rank: index,
    noteHeads: { first: index * 10 + 1, last: index * 10 + 9 },
  }));
  define('player.course.resolveNonstopTempo', {
    run: () => {
      courseApi.resolveNonstopTempo(benchReadoutStages, benchReadoutPlacements);
      courseApi.resolveNonstopTempo(benchReadoutStages, benchReadoutPlacements, { placement: 'lr2' });
    },
  });
  define('player.course.nonstopBpmAt', {
    run: () => {
      courseApi.nonstopBpmAt(benchStitchedMap.tempo, 3);
      courseApi.nonstopBpmAt(benchStitchedMap.tempo, 30);
    },
  });
  define('player.course.resolveNonstopStageRanks', {
    run: () => {
      courseApi.resolveNonstopStageRanks(benchReadoutStages, benchReadoutPlacements);
      courseApi.resolveNonstopStageRanks(benchReadoutStages, benchReadoutPlacements, { placement: 'lr2' });
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
      playlogApi.resolveNonstopPlaylogStages(benchStitchedMap);
    },
  });
  define('player.playlog.resolveNonstopNoteStages', {
    run: () => {
      playlogApi.resolveNonstopNoteStages(benchStitchedChart, benchStitchedMap, BENCH_PLAYLOG.chart.notes);
    },
  });
  define('player.playlog.splitNonstopPlaylog', {
    run: () => {
      playlogApi.splitNonstopPlaylog(
        { playlog: BENCH_PLAYLOG, stages: benchSplitStages, noteStages: benchSplitNoteStages },
        [{ title: 'A' }, { title: 'B' }],
        { ruleset: 'lr2' },
      );
    },
  });
  define('player.course.planNonstopCourse', {
    run: () => {
      courseApi.planNonstopCourse(benchNonstopStages, ['fade', 'cut-fit', 'blank1']);
      courseApi.planNonstopCourse(benchNonstopStages, ['fade', 'cut-fit', 'blank1'], { placement: 'lr2' });
    },
  });
  define('player.course.parseLr2CourseFile', {
    run: () => {
      courseApi.parseLr2CourseFile(benchLr2Course);
    },
  });
  const benchDraftStage = { md5: 'a'.repeat(32), keyMode: 7, title: 'Song' };
  const benchDraft = { kind: 'nonstop' as const, name: 'Bench', stages: [benchDraftStage, benchDraftStage] };
  const benchMadeCourse = courseApi.finishCourseDraft(benchDraft)!;
  define('player.course.createCourseDraft', {
    run: () => {
      courseApi.createCourseDraft('nonstop', 'Bench');
    },
  });
  define('player.course.appendCourseDraftStage', {
    run: () => {
      courseApi.appendCourseDraftStage(benchDraft, benchDraftStage);
    },
  });
  define('player.course.removeLastCourseDraftStage', {
    run: () => {
      courseApi.removeLastCourseDraftStage(benchDraft);
    },
  });
  define('player.course.buildLr2CourseHash', {
    run: () => {
      courseApi.buildLr2CourseHash({
        kind: 'nonstop',
        stageMd5s: ['a'.repeat(32), 'b'.repeat(32)],
        connections: ['cut'],
      });
    },
  });
  define('player.course.finishCourseDraft', {
    run: () => {
      courseApi.finishCourseDraft(benchDraft, { defaultConnection: 'cut' });
    },
  });
  define('player.course.stepLr2NonstopConnection', {
    run: () => {
      courseApi.stepLr2NonstopConnection('fade', 1);
      courseApi.stepLr2NonstopConnection('fade', -1);
    },
  });
  define('player.course.withNonstopConnection', {
    run: () => {
      courseApi.withNonstopConnection(benchMadeCourse, 0, 'blank1');
    },
  });
  define('player.course.defaultCourseMakerConstraints', {
    run: () => {
      courseApi.defaultCourseMakerConstraints('grade');
    },
  });
  define('player.course.withCourseConstraints', {
    run: () => {
      courseApi.withCourseConstraints(benchMadeCourse, ['grade', 'gauge_7k', 'no_speed']);
    },
  });
  define('player.course.courseConstraintEnumName', {
    run: () => {
      courseApi.courseConstraintEnumName('grade_mirror');
    },
  });
  define('player.course.serializeBeatorajaCourseFile', {
    run: () => {
      courseApi.serializeBeatorajaCourseFile([benchMadeCourse]);
    },
  });
  define('player.course.serializeLr2CourseFile', {
    run: () => {
      courseApi.serializeLr2CourseFile([benchMadeCourse]);
    },
  });
  define('player.course.parseBeatorajaCourseData', {
    run: () => {
      courseApi.parseBeatorajaCourseData(benchBeatorajaCourse);
    },
  });
  define('player.course.parseBeatorajaCourseFile', {
    run: () => {
      courseApi.parseBeatorajaCourseFile(JSON.stringify([benchBeatorajaCourse]));
    },
  });
  define('player.course.parseBeatorajaRandomCourseData', {
    run: () => {
      courseApi.parseBeatorajaRandomCourseData({
        name: 'R',
        stage: [{ sql: 'level = 12' }, {}],
        rconstraint: ['distinct'],
      });
    },
  });
  define('player.course.parseBeatorajaCommandFolderFile', {
    run: () => {
      courseApi.parseBeatorajaCommandFolderFile(
        JSON.stringify([{ name: 'Random', rcourse: [{ name: 'R', stage: [{ sql: 'level = 12' }, {}] }] }]),
      );
    },
  });
  const benchFilterSql = "song.level BETWEEN 11 AND 12 AND mode IN (7, 14) AND title NOT LIKE '%HYPER%'";
  const benchFilter = courseApi.parseCourseSongFilter(benchFilterSql);
  const benchSongs = Array.from({ length: 200 }, (_, index) => ({
    md5: index.toString(16).padStart(32, '0'),
    sha256: index.toString(16).padStart(64, '0'),
    title: `song ${index}`,
    level: index % 13,
    mode: index % 2 === 0 ? 7 : 14,
  }));
  define('player.course.parseCourseSongFilter', {
    run: () => {
      courseApi.parseCourseSongFilter(benchFilterSql);
    },
  });
  define('player.course.evaluateCourseSongFilter', {
    run: () => {
      if (benchFilter.ok) for (const song of benchSongs) courseApi.evaluateCourseSongFilter(benchFilter.filter, song);
    },
  });
  let benchSeed = 1;
  define('player.course.drawRandomCourse', {
    run: () => {
      courseApi.drawRandomCourse(
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
      courseApi.resolveTableModeKeys('beat-7k');
    },
  });
  define('player.course.parseTableHeaderCourses', {
    run: () => {
      courseApi.parseTableHeaderCourses(benchTableHeader);
    },
  });
  const benchTablePageUrl = 'https://example.com/table/table.html';
  const benchTablePage = `<html><head><meta charset="utf-8"><meta content="header.json" name="bmstable"></head></html>`;
  const benchTableHeaderText = JSON.stringify({ name: 'Bench table', ...benchTableHeader });
  // A stub instead of the network: benchmarks must not fetch.
  const benchTableFetch = async (url: string): Promise<string> =>
    url === benchTablePageUrl ? benchTablePage : benchTableHeaderText;
  define('player.course.resolveTableHeaderUrl', {
    run: () => {
      courseApi.resolveTableHeaderUrl(benchTablePageUrl, benchTablePage);
    },
  });
  define('player.course.fetchTableHeaderCourses', {
    run: async () => {
      await courseApi.fetchTableHeaderCourses(benchTablePageUrl, benchTableFetch);
    },
  });
  define('player.course.resolveCourseStages', {
    run: () => {
      courseApi.resolveCourseStages(benchCourse, { bySha256: () => 'chart', byMd5: () => 'chart' });
    },
  });
  define('player.playlog.checkPlaylogEligibility', {
    run: () => {
      playlogApi.checkPlaylogEligibility(BENCH_PLAYLOG);
    },
  });
  define('player.playlog.serializePlaylog', {
    run: () => {
      playlogApi.serializePlaylog(BENCH_PLAYLOG);
    },
  });
  define('player.playlog.parsePlaylog', {
    run: () => {
      playlogApi.parsePlaylog(BENCH_PLAYLOG_JSON);
    },
  });
  define('player.playlog.simulatePlaylog', {
    run: () => {
      playlogApi.simulatePlaylog(BENCH_PLAYLOG, { ruleset: 'lr2' });
    },
  });
  define('player.playlog.simulatePlaylogRulesets', {
    run: () => {
      playlogApi.simulatePlaylogRulesets(BENCH_PLAYLOG);
    },
  });
  const benchCourseInfo = {
    name: 'Dan',
    kind: 'grade' as const,
    constraints: ['grade_mirror', 'gauge_lr2'],
    trophies: [{ name: 'gold', missRate: 5, scoreRate: 80 }],
  };
  const benchCourseLog = playlogApi.createCoursePlaylog({
    course: benchCourseInfo,
    stages: [
      { played: true, playlog: BENCH_PLAYLOG },
      { played: true, playlog: BENCH_PLAYLOG },
    ],
  });
  const benchCourseText = playlogApi.serializeCoursePlaylog(benchCourseLog);
  const benchStageResult = playlogApi.simulatePlaylog(BENCH_PLAYLOG, { ruleset: 'lr2' });
  define('player.playlog.aggregateCourseResult', {
    run: () => {
      playlogApi.aggregateCourseResult(
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
      playlogApi.createCoursePlaylog({ course: benchCourseInfo, stages: [{ played: true, playlog: BENCH_PLAYLOG }] });
    },
  });
  define('player.playlog.extractCourseStage', {
    run: () => {
      playlogApi.extractCourseStage(benchCourseLog, 1);
    },
  });
  define('player.playlog.parseCoursePlaylog', {
    run: () => {
      playlogApi.parseCoursePlaylog(benchCourseText);
    },
  });
  define('player.playlog.resolveCourseLamp', {
    run: () => {
      playlogApi.resolveCourseLamp('beatoraja', benchStageResult, 'GROOVE');
    },
  });
  define('player.playlog.resolveCoursePlaylogFilename', {
    run: () => {
      playlogApi.resolveCoursePlaylogFilename(benchCourseLog);
    },
  });
  define('player.playlog.resolveCourseTrophy', {
    run: () => {
      playlogApi.resolveCourseTrophy(benchCourseInfo.trophies, { missCount: 4, exScore: 170, noteCount: 100 });
    },
  });
  define('player.playlog.serializeCoursePlaylog', {
    run: () => {
      playlogApi.serializeCoursePlaylog(benchCourseLog);
    },
  });
  define('player.playlog.simulateCoursePlaylog', {
    run: () => {
      playlogApi.simulateCoursePlaylog(benchCourseLog, { ruleset: 'lr2' });
    },
  });
  const benchKeyedCourseLog = playlogApi.createCoursePlaylog({
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
      playlogApi.createCourseFingerprintDocument({
        kind: 'nonstop',
        constraints: [],
        stageChartFingerprints: ['bmfp0:a', 'bmfp0:b', 'bmfp0:c'],
        nonstop: { connections: ['cut'], placement: 'intended' },
      });
    },
  });
  define('player.playlog.computeCourseFingerprint', {
    run: () => {
      playlogApi.computeCourseFingerprint({
        kind: 'grade',
        constraints: ['grade_mirror', 'gauge_lr2'],
        stageChartFingerprints: ['bmfp0:a', 'bmfp0:b', 'bmfp0:c', 'bmfp0:d'],
      });
    },
  });
  define('player.playlog.resolveCourseStageChartFingerprints', {
    run: () => {
      playlogApi.resolveCourseStageChartFingerprints(benchKeyedCourseLog);
    },
  });
  define('player.playlog.computeCoursePlaylogFingerprint', {
    run: () => {
      playlogApi.computeCoursePlaylogFingerprint(benchKeyedCourseLog);
    },
  });
  define('player.playlog.checkCoursePlaylogEligibility', {
    run: () => {
      playlogApi.checkCoursePlaylogEligibility(benchKeyedCourseLog);
    },
  });
  define('player.playlog.computeScoreRate', {
    run: () => {
      playlogApi.computeScoreRate({ total: 1000, exScore: 1650 });
    },
  });
  define('player.playlog.resolveIidxRankLabel', {
    run: () => {
      playlogApi.resolveIidxRankLabel(1650, 1000);
    },
  });
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

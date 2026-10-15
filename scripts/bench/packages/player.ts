import * as playerApi from '@be-music/player';
import * as courseApi from '@be-music/player/course';
import * as judgingApi from '@be-music/player/judging';
import * as playlogApi from '@be-music/player/playlog';
import { registerPlayerExportsCases } from '../../../packages/player/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const playerBenchmarkPackage: BenchmarkPackageDefinition = {
  module: {
    ...(playerApi as Record<string, unknown>),
    ...Object.fromEntries(Object.entries(courseApi).map(([name, value]) => [`course.${name}`, value])),
    'judging.findClosestCandidateInWindow': judgingApi.findClosestCandidateInWindow,
    'playlog.checkPlaylogEligibility': playlogApi.checkPlaylogEligibility,
    'playlog.serializePlaylog': playlogApi.serializePlaylog,
    'playlog.parsePlaylog': playlogApi.parsePlaylog,
    'playlog.simulatePlaylog': playlogApi.simulatePlaylog,
    'playlog.simulatePlaylogRulesets': playlogApi.simulatePlaylogRulesets,
    'playlog.aggregateCourseResult': playlogApi.aggregateCourseResult,
    'playlog.createCoursePlaylog': playlogApi.createCoursePlaylog,
    'playlog.extractCourseStage': playlogApi.extractCourseStage,
    'playlog.parseCoursePlaylog': playlogApi.parseCoursePlaylog,
    'playlog.resolveCourseLamp': playlogApi.resolveCourseLamp,
    'playlog.resolveCoursePlaylogFilename': playlogApi.resolveCoursePlaylogFilename,
    'playlog.resolveCourseTrophy': playlogApi.resolveCourseTrophy,
    'playlog.serializeCoursePlaylog': playlogApi.serializeCoursePlaylog,
    'playlog.simulateCoursePlaylog': playlogApi.simulateCoursePlaylog,
    'playlog.checkCoursePlaylogEligibility': playlogApi.checkCoursePlaylogEligibility,
    'playlog.computeCourseFingerprint': playlogApi.computeCourseFingerprint,
    'playlog.computeCoursePlaylogFingerprint': playlogApi.computeCoursePlaylogFingerprint,
    'playlog.resolveCourseStageChartFingerprints': playlogApi.resolveCourseStageChartFingerprints,
    'playlog.resolveNonstopPlaylogStages': playlogApi.resolveNonstopPlaylogStages,
    'playlog.resolveNonstopNoteStages': playlogApi.resolveNonstopNoteStages,
    'playlog.splitNonstopPlaylog': playlogApi.splitNonstopPlaylog,
    'playlog.resolveChartRulesetFacts': playlogApi.resolveChartRulesetFacts,
    'playlog.resolvePlayChart': playlogApi.resolvePlayChart,
    'playlog.computeScoreRate': playlogApi.computeScoreRate,
    'playlog.resolveIidxRankLabel': playlogApi.resolveIidxRankLabel,
  },
  registerCases: registerPlayerExportsCases,
};

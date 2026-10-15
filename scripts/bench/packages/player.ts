import * as playerApi from '@be-music/player';
import * as judgingApi from '@be-music/player/judging';
import * as playlogApi from '@be-music/player/playlog';
import { registerPlayerExportsCases } from '../../../packages/player/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const playerBenchmarkPackage: BenchmarkPackageDefinition = {
  module: {
    ...(playerApi as Record<string, unknown>),
    'judging.findClosestCandidateInWindow': judgingApi.findClosestCandidateInWindow,
    'playlog.checkPlaylogEligibility': playlogApi.checkPlaylogEligibility,
    'playlog.serializePlaylog': playlogApi.serializePlaylog,
    'playlog.parsePlaylog': playlogApi.parsePlaylog,
    'playlog.simulatePlaylog': playlogApi.simulatePlaylog,
    'playlog.simulatePlaylogRulesets': playlogApi.simulatePlaylogRulesets,
    'playlog.computeScoreRate': playlogApi.computeScoreRate,
    'playlog.resolveIidxRankLabel': playlogApi.resolveIidxRankLabel,
  },
  registerCases: registerPlayerExportsCases,
};

import * as playerApi from '@be-music/player';
import * as courseApi from '@be-music/player/course';
import * as judgingApi from '@be-music/player/judging';
import * as playlogApi from '@be-music/player/playlog';
import * as rulesetApi from '@be-music/player/ruleset';
import { registerPlayerExportsCases } from '../../../packages/player/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const playerBenchmarkPackage: BenchmarkPackageDefinition = {
  module: {
    ...(playerApi as Record<string, unknown>),
    ...Object.fromEntries(Object.entries(courseApi).map(([name, value]) => [`course.${name}`, value])),
    ...Object.fromEntries(Object.entries(rulesetApi).map(([name, value]) => [`ruleset.${name}`, value])),
    'judging.findClosestCandidateInWindow': judgingApi.findClosestCandidateInWindow,
    // Every playlog export, as for course: a new export needs a case, and a removed one drops its case.
    ...Object.fromEntries(Object.entries(playlogApi).map(([name, value]) => [`playlog.${name}`, value])),
  },
  registerCases: registerPlayerExportsCases,
};

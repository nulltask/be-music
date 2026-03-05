import * as playerApi from '@be-music/player';
import { registerPlayerExportsCases } from '../../../packages/player/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const playerBenchmarkPackage: BenchmarkPackageDefinition = {
  module: playerApi as Record<string, unknown>,
  registerCases: registerPlayerExportsCases,
};

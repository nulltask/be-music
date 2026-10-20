import * as playerWebCoreAPI from '@be-music/player-web';
import { registerPlayerWebCoreExportsCases } from '../../../packages/player-web/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const playerWebCoreBenchmarkPackage: BenchmarkPackageDefinition = {
  module: playerWebCoreAPI as Record<string, unknown>,
  registerCases: registerPlayerWebCoreExportsCases,
};

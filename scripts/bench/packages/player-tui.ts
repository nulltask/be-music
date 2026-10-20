import * as playerTuiAPI from '@be-music/player-terminal';
import { registerPlayerTUIExportsCases } from '../../../packages/player-terminal/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const playerTUIBenchmarkPackage: BenchmarkPackageDefinition = {
  module: playerTuiAPI as Record<string, unknown>,
  registerCases: registerPlayerTUIExportsCases,
};

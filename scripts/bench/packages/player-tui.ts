import * as playerTuiAPI from '@be-music/player-tui';
import { registerPlayerTUIExportsCases } from '../../../packages/player-tui/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const playerTUIBenchmarkPackage: BenchmarkPackageDefinition = {
  module: playerTuiAPI as Record<string, unknown>,
  registerCases: registerPlayerTUIExportsCases,
};

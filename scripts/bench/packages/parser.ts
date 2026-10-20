import * as parserAPI from '@be-music/chart-parser';
import { registerParserExportsCases } from '../../../packages/chart-parser/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const parserBenchmarkPackage: BenchmarkPackageDefinition = {
  module: parserAPI as Record<string, unknown>,
  registerCases: registerParserExportsCases,
};

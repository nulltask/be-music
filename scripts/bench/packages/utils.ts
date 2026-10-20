import * as utilsAPI from '@be-music/shared-utils';
import * as optionalNodeModuleAPI from '@be-music/shared-utils/optional-node-module';
import * as workerizeAPI from '@be-music/shared-utils/workerize';
import { registerUtilsExportsCases } from '../../../packages/shared-utils/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const utilsBenchmarkPackage: BenchmarkPackageDefinition = {
  module: {
    ...(utilsAPI as Record<string, unknown>),
    // The Node-only subpaths the root leaves out, as `<subpath>.<name>`.
    ...Object.fromEntries(
      Object.entries(optionalNodeModuleAPI).map(([name, value]) => [`optional-node-module.${name}`, value]),
    ),
    ...Object.fromEntries(Object.entries(workerizeAPI).map(([name, value]) => [`workerize.${name}`, value])),
  },
  registerCases: registerUtilsExportsCases,
};

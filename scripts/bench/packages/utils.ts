import * as utilsApi from '@be-music/utils';
import * as optionalNodeModuleApi from '@be-music/utils/optional-node-module';
import * as workerizeApi from '@be-music/utils/workerize';
import { registerUtilsExportsCases } from '../../../packages/utils/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const utilsBenchmarkPackage: BenchmarkPackageDefinition = {
  module: {
    ...(utilsApi as Record<string, unknown>),
    // The Node-only subpaths the root leaves out, as `<subpath>.<name>`.
    ...Object.fromEntries(
      Object.entries(optionalNodeModuleApi).map(([name, value]) => [`optional-node-module.${name}`, value]),
    ),
    ...Object.fromEntries(Object.entries(workerizeApi).map(([name, value]) => [`workerize.${name}`, value])),
  },
  registerCases: registerUtilsExportsCases,
};

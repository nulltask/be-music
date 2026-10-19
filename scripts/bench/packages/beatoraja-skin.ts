import * as beatorajaSkinAPI from '@be-music/beatoraja-skin';
import * as sceneAPI from '@be-music/beatoraja-skin/scene';
import { registerBeatorajaSkinExportsCases } from '../../../packages/beatoraja-skin/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const beatorajaSkinBenchmarkPackage: BenchmarkPackageDefinition = {
  module: {
    // The skin parser, the element helpers and the theme loader of the main entry.
    ...(beatorajaSkinAPI as Record<string, unknown>),
    // Every `@be-music/beatoraja-skin/scene` export, as `scene.<name>`: a new resolver needs a case, a removed one drops it.
    ...Object.fromEntries(Object.entries(sceneAPI).map(([name, value]) => [`scene.${name}`, value])),
  },
  registerCases: registerBeatorajaSkinExportsCases,
};

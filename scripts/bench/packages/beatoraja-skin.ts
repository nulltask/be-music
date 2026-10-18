import * as beatorajaSkinApi from '@be-music/beatoraja-skin';
import * as sceneApi from '@be-music/beatoraja-skin/scene';
import { registerBeatorajaSkinExportsCases } from '../../../packages/beatoraja-skin/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const beatorajaSkinBenchmarkPackage: BenchmarkPackageDefinition = {
  module: {
    // The skin parser, the element helpers and the theme loader of the main entry.
    ...(beatorajaSkinApi as Record<string, unknown>),
    // Every `@be-music/beatoraja-skin/scene` export, as `scene.<name>`: a new resolver needs a case, a removed one drops it.
    ...Object.fromEntries(Object.entries(sceneApi).map(([name, value]) => [`scene.${name}`, value])),
  },
  registerCases: registerBeatorajaSkinExportsCases,
};

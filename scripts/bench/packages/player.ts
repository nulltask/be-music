import * as playerAPI from '@be-music/player-engine';
import * as courseAPI from '@be-music/player-engine/course';
import * as displayAPI from '@be-music/player-engine/display';
import * as lanesAPI from '@be-music/player-engine/lanes';
import * as replayAPI from '@be-music/player-engine/replay';
import * as recordsAPI from '@be-music/player-engine/records';
import * as rulesetAPI from '@be-music/player-engine/ruleset';
import * as signalsAPI from '@be-music/player-engine/signals';
import { registerPlayerExportsCases } from '../../../packages/player-engine/scripts/exports-cases.ts';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

/** Every export of `entry`, keyed `<prefix>.<name>`: a new export needs a case, and a removed one drops its case. */
function prefixed(prefix: string, entry: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entry).map(([name, value]) => [`${prefix}.${name}`, value]));
}

export const playerBenchmarkPackage: BenchmarkPackageDefinition = {
  module: {
    ...(playerAPI as Record<string, unknown>),
    ...prefixed('signals', signalsAPI),
    ...prefixed('lanes', lanesAPI),
    ...prefixed('display', displayAPI),
    ...prefixed('course', courseAPI),
    ...prefixed('records', recordsAPI),
    ...prefixed('ruleset', rulesetAPI),
    ...prefixed('replay', replayAPI),
  },
  registerCases: registerPlayerExportsCases,
};

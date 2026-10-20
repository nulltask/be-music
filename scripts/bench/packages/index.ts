import {
  PACKAGE_NAMES,
  type BenchmarkPackageDefinition,
  type DefineBenchmarkCase,
  type PackageName,
} from '../exports.types.ts';
import { audioRendererBenchmarkPackage } from './audio-renderer.ts';
import { beatorajaSkinBenchmarkPackage } from './beatoraja-skin.ts';
import { chartBenchmarkPackage } from './chart.ts';
import { editorBenchmarkPackage } from './editor.ts';
import { jsonBenchmarkPackage } from './json.ts';
import { parserBenchmarkPackage } from './parser.ts';
import { lr2SkinBenchmarkPackage } from './lr2-skin.ts';
import { playerBenchmarkPackage } from './player.ts';
import { playerTUIBenchmarkPackage } from './player-tui.ts';
import { sceneModelBenchmarkPackage } from './scene-model.ts';
import { playerWebCoreBenchmarkPackage } from './player-web.ts';
import { skinSDKBenchmarkPackage } from './skin-sdk.ts';
import { stringifierBenchmarkPackage } from './stringifier.ts';
import { utilsBenchmarkPackage } from './utils.ts';

export const PACKAGE_DEFINITIONS: Record<PackageName, BenchmarkPackageDefinition> = {
  'shared-utils': utilsBenchmarkPackage,
  'chart-source': jsonBenchmarkPackage,
  'chart-model': chartBenchmarkPackage,
  'chart-parser': parserBenchmarkPackage,
  'chart-writer': stringifierBenchmarkPackage,
  'chart-editor': editorBenchmarkPackage,
  'chart-audio-renderer': audioRendererBenchmarkPackage,
  'player-engine': playerBenchmarkPackage,
  'player-scene-model': sceneModelBenchmarkPackage,
  'player-terminal': playerTUIBenchmarkPackage,
  'skin-lr2': lr2SkinBenchmarkPackage,
  'skin-beatoraja': beatorajaSkinBenchmarkPackage,
  'player-skin-sdk': skinSDKBenchmarkPackage,
  'player-browser': playerWebCoreBenchmarkPackage,
};

export function registerAllExportsBenchmarkCases(define: DefineBenchmarkCase): void {
  for (const packageName of PACKAGE_NAMES) {
    PACKAGE_DEFINITIONS[packageName].registerCases(define);
  }
}

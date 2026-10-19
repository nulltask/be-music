import type { BeMusicJson } from '@be-music/json';
import { normalizePath } from '@be-music/utils/core';
import { resolveChartAudioAsset, resolveChartBgaAsset } from './collection.ts';
import type { BrowserSongAssetEntry, BrowserSongAssetSource } from './types.ts';

/** One stage of a NONSTOP course as the host has it: its chart, where it was loaded from, and its chart path. */
export interface NonstopAssetStage {
  chart: BeMusicJson;
  source: BrowserSongAssetSource;
  chartPath: string;
}

/** The chart path a stitched NONSTOP chart is played under: its resources are named from the source root. */
export const NONSTOP_CHART_PATH = 'nonstop.bms';

/**
 * The assets of a stitched NONSTOP chart, whose stages can come from different folders or sources:
 *
 * - `assetPath` is `stitchNonstopCourse`'s `assetPath`: it finds a stage's WAV / BMP file the way that stage alone would
 *   (`#PATH_WAV`, the codec and image-extension fallbacks, LR2's parent-folder lookup) and names it `s<stage>/<the file's
 *   key in its source>`; a file that is not there keeps its declared path under the stage's chart folder;
 * - `source` holds every file `assetPath` found, under those names, for the stitched chart (played as
 *   {@link NONSTOP_CHART_PATH}) to load.
 */
export function createNonstopAssets(stages: readonly NonstopAssetStage[]): {
  source: BrowserSongAssetSource;
  assetPath: (stage: number, kind: 'wav' | 'bmp', path: string) => string;
} {
  const files = new Map<string, BrowserSongAssetEntry>();
  const keyOf = stages.map(() => undefined as Map<BrowserSongAssetEntry, string> | undefined);
  const keyIn = (stage: number, entry: BrowserSongAssetEntry): string | undefined => {
    let index = keyOf[stage];
    if (index === undefined) {
      index = new Map();
      for (const [key, value] of stages[stage]!.source.files) if (!index.has(value)) index.set(value, key);
      keyOf[stage] = index;
    }
    return index.get(entry);
  };
  const source: BrowserSongAssetSource = {
    id: `nonstop:${stages.map((stage) => `${stage.source.id}:${stage.chartPath}`).join('|')}`,
    kind: 'files',
    label: 'NONSTOP',
    files,
  };
  const assetPath = (index: number, kind: 'wav' | 'bmp', path: string): string => {
    const stage = stages[index];
    if (stage === undefined) return path;
    const pathWav = stage.chart.bms.pathWav;
    const entry =
      kind === 'wav'
        ? resolveChartAudioAsset(
            stage.source,
            stage.chartPath,
            path,
            typeof pathWav === 'string' ? { pathPrefix: pathWav } : {},
          )
        : resolveChartBgaAsset(stage.source, stage.chartPath, path)?.entry;
    const key = entry !== undefined ? keyIn(index, entry) : undefined;
    if (entry === undefined || key === undefined) {
      const folder = stage.chartPath.includes('/')
        ? stage.chartPath.slice(0, stage.chartPath.lastIndexOf('/') + 1)
        : '';
      return normalizePath(`s${index}/${folder}${path}`);
    }
    const name = `s${index}/${key}`;
    files.set(name, entry);
    return name;
  };
  return { source, assetPath };
}

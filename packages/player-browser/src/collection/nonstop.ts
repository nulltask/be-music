import type { BeMusicJSON } from '@be-music/chart-source';
import { normalizePath } from '@be-music/shared-utils/core';
import { parseBMSExBMP, resolveBmsWAVResources } from '@be-music/chart-model';
import { yieldToTask } from '../compute/yield.ts';
import { resolveChartAudioAssetCandidates, resolveChartBGAAsset } from './collection.ts';
import type { BrowserAssetEntry, BrowserAssetSource } from './types.ts';

/** One stage of a NONSTOP course as the host has it: its chart, where it was loaded from, and its chart path. */
export interface NonstopAssetStage {
  chart: BeMusicJSON;
  source: BrowserAssetSource;
  chartPath: string;
}

/** The chart path a stitched NONSTOP chart is played under: its resources are named from the source root. */
export const NONSTOP_CHART_PATH = 'nonstop.bms';

/** How a stage's WAV / BMP path resolved: the name it is filed under, and the files behind it (none when missing). */
interface NonstopAssetMatch {
  name: string;
  entry?: BrowserAssetEntry;
  /** A WAV's files in fallback order (`resolveChartAudioAssetCandidates`), the first being `entry`. */
  candidates?: readonly BrowserAssetEntry[];
}

/** How long {@link createNonstopAssets}'s `prefetch` resolves paths before it yields to the host, in milliseconds. */
const PREFETCH_SLICE_MS = 8;

/**
 * The assets of a stitched NONSTOP chart, whose stages can come from different folders or sources:
 *
 * - `assetPath` is `stitchNonstopCourse`'s `assetPath`: it finds a stage's WAV / BMP file the way that stage alone would
 *   (`#PATH_WAV`, the codec and image-extension fallbacks, LR2's parent-folder lookup) and names it `s<stage>/<the file's
 *   key in its source>`; a file that is not there keeps its declared path under the stage's chart folder;
 * - `source` holds every file `assetPath` found, under those names, for the stitched chart (played as
 *   {@link NONSTOP_CHART_PATH}) to load;
 * - `prefetch` looks up every WAV / BMP path the stage charts declare ahead of the stitch, yielding to the host between
 *   slices of lookups, so the stitch itself (synchronous) finds them done instead of blocking the page on a large
 *   library. Nothing is filed until `assetPath` asks for it;
 * - `setStageCharts` hands over the stage charts as played (control flow resolved), whose `#PATH_WAV` `assetPath`
 *   follows.
 */
export function createNonstopAssets(stages: readonly NonstopAssetStage[]): {
  source: BrowserAssetSource;
  assetPath: (stage: number, kind: 'wav' | 'bmp', path: string) => string;
  prefetch: (options?: { yieldToHost?: () => Promise<void>; now?: () => number }) => Promise<void>;
  setStageCharts: (charts: readonly BeMusicJSON[]) => void;
} {
  const files = new Map<string, BrowserAssetEntry>();
  const audioFallbacks = new Map<string, readonly BrowserAssetEntry[]>();
  let charts: readonly BeMusicJSON[] = stages.map((stage) => stage.chart);
  const keyOf = stages.map(() => undefined as Map<BrowserAssetEntry, string> | undefined);
  // Only for a match the resolver found without a key (a composite stage source's own fallback): a reverse index over
  // the stage source's files, which a library source of many thousand files makes costly to build.
  const keyIn = (stage: number, entry: BrowserAssetEntry): string | undefined => {
    let index = keyOf[stage];
    if (index === undefined) {
      index = new Map();
      for (const [key, value] of stages[stage]!.source.files) if (!index.has(value)) index.set(value, key);
      keyOf[stage] = index;
    }
    return index.get(entry);
  };
  const source: BrowserAssetSource = {
    id: `nonstop:${stages.map((stage) => `${stage.source.id}:${stage.chartPath}`).join('|')}`,
    kind: 'files',
    label: 'NONSTOP',
    files,
    audioFallbacks,
  };
  const matches = new Map<string, NonstopAssetMatch>();
  const pathPrefixOf = (index: number): string | undefined => {
    const pathWAV = charts[index]?.bms.pathWAV;
    return typeof pathWAV === 'string' ? pathWAV : undefined;
  };
  const matchKey = (index: number, kind: 'wav' | 'bmp', path: string): string =>
    kind === 'wav' ? `${index}\0wav\0${pathPrefixOf(index) ?? ''}\0${path}` : `${index}\0bmp\0${path}`;
  const resolve = (index: number, kind: 'wav' | 'bmp', path: string): NonstopAssetMatch | undefined => {
    const stage = stages[index];
    if (stage === undefined) return undefined;
    const key = matchKey(index, kind, path);
    const cached = matches.get(key);
    if (cached !== undefined) return cached;
    let match: NonstopAssetMatch | undefined;
    if (kind === 'wav') {
      const pathPrefix = pathPrefixOf(index);
      const found = resolveChartAudioAssetCandidates(
        stage.source,
        stage.chartPath,
        path,
        pathPrefix !== undefined ? { pathPrefix } : {},
      );
      const first = found[0];
      const firstKey = first === undefined ? undefined : (first.key ?? keyIn(index, first.entry));
      if (first !== undefined && firstKey !== undefined) {
        match = { name: `s${index}/${firstKey}`, entry: first.entry, candidates: found.map(({ entry }) => entry) };
      }
    } else {
      const found = resolveChartBGAAsset(stage.source, stage.chartPath, path);
      if (found !== undefined) match = { name: `s${index}/${found.key}`, entry: found.entry };
    }
    if (match === undefined) {
      const folder = stage.chartPath.includes('/')
        ? stage.chartPath.slice(0, stage.chartPath.lastIndexOf('/') + 1)
        : '';
      match = { name: normalizePath(`s${index}/${folder}${path}`) };
    }
    matches.set(key, match);
    return match;
  };
  const assetPath = (index: number, kind: 'wav' | 'bmp', path: string): string => {
    const match = resolve(index, kind, path);
    if (match === undefined) return path;
    if (match.entry === undefined) return match.name;
    if (match.candidates !== undefined) audioFallbacks.set(normalizePath(match.name), match.candidates);
    files.set(match.name, match.entry);
    return match.name;
  };
  const prefetch = async (options: { yieldToHost?: () => Promise<void>; now?: () => number } = {}): Promise<void> => {
    const yieldToHost = options.yieldToHost ?? yieldToTask;
    const now = options.now ?? (() => performance.now());
    let sliceStart = now();
    for (const [index, stage] of stages.entries()) {
      const { chart } = stage;
      const lookups: Array<['wav' | 'bmp', string]> = [];
      for (const path of Object.values(resolveBmsWAVResources(chart))) lookups.push(['wav', path]);
      for (const path of Object.values(chart.resources.bmp)) lookups.push(['bmp', path]);
      for (const raw of Object.values(chart.bms.exBMP)) {
        const filename = parseBMSExBMP(raw)?.filename;
        if (filename !== undefined) lookups.push(['bmp', filename]);
      }
      for (const header of chart.bmson.bga.header) lookups.push(['bmp', header.name]);
      for (const [kind, path] of lookups) {
        if (typeof path !== 'string' || path.length === 0) continue;
        resolve(index, kind, path);
        if (now() - sliceStart >= PREFETCH_SLICE_MS) {
          await yieldToHost();
          sliceStart = now();
        }
      }
    }
  };
  return {
    source,
    assetPath,
    prefetch,
    setStageCharts: (next) => {
      charts = next;
    },
  };
}

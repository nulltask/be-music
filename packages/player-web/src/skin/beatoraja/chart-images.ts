/**
 * A chart's own images as a beatoraja skin draws them: its `#STAGEFILE`, `#BACKBMP` and `#BANNER` in the synthetic
 * image slots -100, -101 and -102 (ModernChic paints the stage file behind the decide screen's title, the default skin
 * under the result's score readouts).
 */

import type { LibraryChart } from '@be-music/scene-model';
import type { Texture } from 'pixi.js';
import { loadAssetBytes } from '../../collection/file-lookup.ts';
import type { BrowserSongAssetSource } from '../../collection/types.ts';
import { logger } from '../../logger.ts';
// Through the LR2 texture module, which registers the DDS decoder with the shared loader.
import { loadTextureFromBytes } from '../lr2/textures.ts';

const log = logger('beatoraja-tex');

/** A chart's images, decoded; an image the chart lacks, or one that would not decode, is left out. */
export interface BeatorajaChartImages {
  stageFile?: Texture;
  backBMP?: Texture;
  banner?: Texture;
}

/** The image of a synthetic slot: -100 the stage file, -101 the back image, -102 the banner; `undefined` otherwise. */
export function resolveBeatorajaChartImage(
  images: BeatorajaChartImages | undefined,
  syntheticId: number,
): Texture | undefined {
  if (images === undefined) return undefined;
  switch (syntheticId) {
    case -100:
      return images.stageFile;
    case -101:
      return images.backBMP;
    case -102:
      return images.banner;
    default:
      return undefined;
  }
}

/**
 * Decodes a chart's `#STAGEFILE`, `#BACKBMP` and `#BANNER` from `source`, each looked up next to the chart, then at the
 * source's root. Each is best-effort: a missing or malformed image is left out, and nothing loads without a source.
 */
export async function loadBeatorajaChartImages(
  chart: Pick<LibraryChart, 'chart' | 'chartPath'>,
  source: BrowserSongAssetSource | undefined,
): Promise<BeatorajaChartImages> {
  if (source === undefined) return {};
  const meta = chart.chart.metadata;
  const chartDir = chart.chartPath.includes('/') ? chart.chartPath.slice(0, chart.chartPath.lastIndexOf('/')) : '';
  const decode = async (relPath: string | undefined): Promise<Texture | undefined> => {
    if (relPath === undefined || relPath.length === 0) return undefined;
    // `#STAGEFILE foo.png` lives next to the chart: a leading slash is dropped and the path joined under the chart's
    // folder, with the bare path as a fallback.
    const normalized = relPath.replace(/^\/+/, '');
    const candidates = [chartDir.length > 0 ? `${chartDir}/${normalized}` : normalized, normalized];
    for (const candidate of candidates) {
      const entry = source.files.get(candidate);
      if (entry === undefined) continue;
      const bytes = await loadAssetBytes(entry);
      if (bytes === undefined) continue;
      try {
        return await loadTextureFromBytes(candidate, bytes);
      } catch (error) {
        log.info('chart image decode failed', { path: candidate, error });
        return undefined;
      }
    }
    return undefined;
  };
  const [stageFile, backBMP, banner] = await Promise.all([
    decode(meta.stageFile),
    decode(meta.backBMP),
    decode(meta.banner),
  ]);
  const images: BeatorajaChartImages = {};
  if (stageFile !== undefined) images.stageFile = stageFile;
  if (backBMP !== undefined) images.backBMP = backBMP;
  if (banner !== undefined) images.banner = banner;
  return images;
}

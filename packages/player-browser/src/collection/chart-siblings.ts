import { resolveLRXHeaderPath, resolveLRXMoviePath } from '@be-music/chart-parser';
import { dirname } from '@be-music/shared-utils/core';
import type { ChartSiblingBytes } from '../compute/tasks.ts';
import { loadAssetBytes, lookupBytesCaseInsensitive } from './file-lookup.ts';
import type { BrowserAssetEntry } from './types.ts';

/**
 * The files a chart reads beside it, looked up in the dropped files: for an LRX `.lrs` chart, its `.lrh` header and
 * the `.lrm` BGA file the header (or the `.lrs`) names, both case-insensitively in the chart's folder. Other charts
 * read nothing else.
 */
/** Whether the chart at `chartPath` reads files beside it ({@link loadChartSiblings}): an LRX `.lrs` chart. */
export function hasChartSiblings(chartPath: string): boolean {
  return chartPath.toLowerCase().endsWith('.lrs');
}

export async function loadChartSiblings(
  files: ReadonlyMap<string, BrowserAssetEntry>,
  chartPath: string,
  chartBytes: Uint8Array,
): Promise<ChartSiblingBytes | undefined> {
  if (!hasChartSiblings(chartPath)) return undefined;
  const lrh = await loadAssetBytes(lookupBytesCaseInsensitive(files, resolveLRXHeaderPath(chartPath)));
  const folder = dirname(chartPath);
  const moviePath = resolveLRXMoviePath(chartBytes, lrh).replace(/\\/g, '/');
  const lrm = await loadAssetBytes(lookupBytesCaseInsensitive(files, folder ? `${folder}/${moviePath}` : moviePath));
  return { ...(lrh ? { lrh } : {}), ...(lrm ? { lrm } : {}) };
}

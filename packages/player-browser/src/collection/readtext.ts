/**
 * The text file shipped next to a chart (an LR2 skin's READ TEXT button, a Be-Music Skin's readme toggle): finding it
 * among the chart's files and decoding it. BMS authors traditionally ship notes and changelogs this way.
 */

import { decodeBMSText } from '@be-music/chart-parser';
import { dirname } from '@be-music/shared-utils/core';
import { loadAssetBytes, resolveChartSource } from './collection.ts';
import type { LibraryChart } from '@be-music/player-scene-model';
import type { BrowserChartCollection } from './types.ts';

/** The `.txt` files directly inside the folder of `song`'s chart, in the source's order. */
function readtextPaths(collection: BrowserChartCollection, chartEntry: LibraryChart): string[] {
  const source = resolveChartSource(collection, chartEntry);
  if (!source) return [];
  const dir = dirname(chartEntry.chartPath).toLowerCase();
  const paths: string[] = [];
  for (const path of source.files.keys()) {
    if (!path.toLowerCase().endsWith('.txt')) continue;
    if (dirname(path).toLowerCase() === dir) paths.push(path);
  }
  return paths;
}

/** Whether the folder of `song`'s chart holds a text (`.txt`) file: LR2's readme (ops 174 / 175). */
export function hasReadtextForChart(collection: BrowserChartCollection, chartEntry: LibraryChart): boolean {
  return readtextPaths(collection, chartEntry).length > 0;
}

/**
 * The decoded contents of the first `.txt` file directly inside the folder of `song`'s chart (no sub-folder, no folder
 * above), in the source's order (the directory listing, or a ZIP's central directory), or `undefined` when there is
 * none. The files of a dropped folder are read on demand.
 */
export async function findReadtextForChart(
  collection: BrowserChartCollection,
  chartEntry: LibraryChart,
): Promise<string | undefined> {
  const source = resolveChartSource(collection, chartEntry);
  if (!source) return undefined;
  for (const path of readtextPaths(collection, chartEntry)) {
    const entry = source.files.get(path);
    if (entry === undefined) continue;
    const bytes = await loadAssetBytes(entry);
    if (!bytes) continue;
    return decodeReadtextBytes(bytes);
  }
  return undefined;
}

/**
 * Decodes raw `.txt` bytes to a string, detecting the encoding as a chart's own text is (`decodeBMSText` of
 * `@be-music/chart-parser`): a BOM first (UTF-8, UTF-16), then strict UTF-8, Korean EUC-KR, and otherwise the
 * likeliest of Shift_JIS (the LR2 era's notes), EUC-JP and Latin-1. There is always some string.
 */
export function decodeReadtextBytes(bytes: Uint8Array): string {
  return decodeBMSText(bytes).text;
}

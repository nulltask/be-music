/**
 * Node runtime adapter: reading a chart from disk. The parser itself (`./core/`) only ever sees text and bytes, so it
 * runs unchanged in the browser; this module is the one place that reaches for `node:fs`, and it does so lazily, so
 * importing the package in a browser bundle never loads it.
 */
import type { BeMusicJSON } from '@be-music/chart-source';
import { decodeBMSText, decodeUTF8Text } from './core/bms-text-decode.ts';
import { parseBMS, parseBmson, parseChart } from './core/parser.ts';

export interface ParseChartFileOptions {
  signal?: AbortSignal;
}

export async function parseChartFile(filePath: string, options: ParseChartFileOptions = {}): Promise<BeMusicJSON> {
  const [{ readFile }, { extname }] = await Promise.all([import('node:fs/promises'), import('node:path')]);
  const buffer = await readFile(filePath, {
    signal: options.signal,
  });
  const extension = extname(filePath).toLowerCase();
  if (extension === '.bmson') {
    return parseBmson(decodeUTF8Text(buffer));
  }
  if (extension === '.json') {
    return parseChart(decodeUTF8Text(buffer), 'json');
  }
  const decoded = decodeBMSText(buffer);
  return parseBMS(decoded.text);
}

/**
 * Node runtime adapter: reading a chart from disk. The parser itself (`./core/`) only ever sees text and bytes, so it
 * runs unchanged in the browser; this module is the one place that reaches for `node:fs`, and it does so lazily, so
 * importing the package in a browser bundle never loads it.
 */
import type { BeMusicJson } from '@be-music/json';
import { decodeBmsText, decodeUtf8Text } from './core/bms-text-decode.ts';
import { parseBms, parseBmson, parseChart } from './core/parser.ts';

export interface ParseChartFileOptions {
  signal?: AbortSignal;
}

export async function parseChartFile(filePath: string, options: ParseChartFileOptions = {}): Promise<BeMusicJson> {
  const [{ readFile }, { extname }] = await Promise.all([import('node:fs/promises'), import('node:path')]);
  const buffer = await readFile(filePath, {
    signal: options.signal,
  });
  const extension = extname(filePath).toLowerCase();
  if (extension === '.bmson') {
    return parseBmson(decodeUtf8Text(buffer));
  }
  if (extension === '.json') {
    return parseChart(decodeUtf8Text(buffer), 'json');
  }
  const decoded = decodeBmsText(buffer);
  return parseBms(decoded.text);
}

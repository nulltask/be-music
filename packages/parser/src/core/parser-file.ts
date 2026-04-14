import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { BeMusicJson } from '@be-music/json';
import { decodeBmsText, decodeUtf8Text } from './bms-text-decoder.ts';
import { parseBms, parseBmson, parseChart } from './parser.ts';

export interface ParseChartFileOptions {
  signal?: AbortSignal;
}

export async function parseChartFile(filePath: string, options: ParseChartFileOptions = {}): Promise<BeMusicJson> {
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

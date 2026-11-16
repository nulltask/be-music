/**
 * Node runtime adapter: reading a chart from disk. The parser itself (`./core/`) only ever sees text and bytes, so it
 * runs unchanged in the browser; this module is the one place that reaches for `node:fs`, and it does so lazily, so
 * importing the package in a browser bundle never loads it.
 */
import type { BeMusicJSON } from '@be-music/chart-source';
import { decodeUTF8Text } from './core/bms-text-decode.ts';
import { parseBMSBytes } from './core/bms-bytes.ts';
import { parseN2SBytes } from './core/n2s.ts';
import { parseBmson, parseChart } from './core/parser.ts';
import { parseLRXBytes, resolveLRXHeaderPath, resolveLRXMoviePath } from './core/lrx.ts';

export interface ParseChartFileOptions {
  signal?: AbortSignal;
}

export async function parseChartFile(filePath: string, options: ParseChartFileOptions = {}): Promise<BeMusicJSON> {
  const [{ readFile }, { dirname, extname, join }] = await Promise.all([
    import('node:fs/promises'),
    import('node:path'),
  ]);
  const buffer = await readFile(filePath, {
    signal: options.signal,
  });
  const extension = extname(filePath).toLowerCase();
  if (extension === '.lrs') {
    // An LRX chart reads its `.lrh` header and the BGA file it names from beside it, when they are there.
    const readSibling = (path: string) => readFile(path, { signal: options.signal }).catch(() => undefined);
    const lrh = await readSibling(resolveLRXHeaderPath(filePath));
    const lrm = await readSibling(join(dirname(filePath), resolveLRXMoviePath(buffer, lrh).replace(/\\/g, '/')));
    return parseLRXBytes({ lrs: buffer, ...(lrh ? { lrh } : {}), ...(lrm ? { lrm } : {}) });
  }
  if (extension === '.bmson') {
    return parseBmson(decodeUTF8Text(buffer));
  }
  if (extension === '.json') {
    return parseChart(decodeUTF8Text(buffer), 'json');
  }
  if (extension === '.n2s') {
    return parseN2SBytes(buffer);
  }
  return parseBMSBytes(buffer);
}

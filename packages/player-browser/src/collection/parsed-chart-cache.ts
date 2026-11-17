import { sha256HexAsync } from '@be-music/shared-utils/hash';
import { runBrowserTask } from '../compute/index.ts';
import { parseChartTask, type ParseChartTaskInput, type ParseChartTaskResult } from '../compute/tasks.ts';

/**
 * Where a host keeps parsed charts across page loads, keyed by {@link parsedChartCacheKey}. The collection loader
 * looks a chart up before parsing it and hands every chart it parsed to {@link ParsedChartCache.set}.
 *
 * Both methods may fail; the loader then parses the chart as if nothing were cached.
 */
export interface ParsedChartCache {
  get(key: string): Promise<ParseChartTaskResult | undefined>;
  /**
   * The values of `keys`, in their order, read together: a host whose lookups each cost a round trip (IndexedDB)
   * answers a library's worth of keys in one. Without it the keys are looked up one by one.
   */
  getMany?(keys: readonly string[]): Promise<Array<ParseChartTaskResult | undefined>>;
  /**
   * Keeps a parse result. The loader goes on to change the chart it holds once the returned promise settles, so the
   * implementation must have copied `value` by then (IndexedDB's `put` copies it when it is called); it need not wait
   * for the write to land.
   */
  set(key: string, value: ParseChartTaskResult): Promise<void>;
}

/**
 * What of a chart's path its parse result depends on: bmson, LRX, BMS text or a Nanasi Groove 2 `.n2s` container, and
 * the `.pms` extension that decides the play variant (an `.n2s` chart is PMS too). Two files with the same bytes under
 * the same kind of name parse the same.
 */
export function parsedChartPathKind(path: string): 'bmson' | 'lrx' | 'n2s' | 'pms' | 'bms' {
  const lower = path.toLowerCase();
  if (lower.endsWith('.bmson')) return 'bmson';
  if (lower.endsWith('.lrs')) return 'lrx';
  if (lower.endsWith('.n2s')) return 'n2s';
  if (lower.endsWith('.pms')) return 'pms';
  return 'bms';
}

/** The cache key of a chart file: the SHA-256 (lowercase hex) of its bytes and {@link parsedChartPathKind}. */
export function parsedChartCacheKey(sha256: string, path: string): string {
  return `${sha256}:${parsedChartPathKind(path)}`;
}

/**
 * The cache keys of chart files a host has seen before, by chart path, so a file it knows is unchanged (the same size
 * and modification time as when it was last read) is looked up in the {@link ParsedChartCache} without being read and
 * hashed again. The collection loader asks {@link ChartCacheKeyBook.known} before reading a chart file and reports
 * every key it works out from a file's bytes to {@link ChartCacheKeyBook.learned}.
 */
export interface ChartCacheKeyBook {
  /** The key the chart file at `path` had when it was last read, when the file is known not to have changed since. */
  known(path: string): string | undefined;
  /** The key of the chart file at `path`, worked out from its bytes now. */
  learned(path: string, key: string): void;
}

/**
 * The charts kept under `keys`, in their order: the charts a {@link ChartCacheKeyBook} names, without their files'
 * bytes. A key the cache has nothing for (or cannot read) gives `undefined`.
 */
export async function readParsedCharts(
  cache: ParsedChartCache | undefined,
  keys: readonly string[],
): Promise<Array<ParseChartTaskResult | undefined>> {
  if (cache === undefined || keys.length === 0) return keys.map(() => undefined);
  let values: readonly unknown[];
  try {
    values =
      cache.getMany !== undefined
        ? await cache.getMany(keys)
        : await Promise.all(keys.map((key) => cache.get(key).catch(() => undefined)));
  } catch {
    return keys.map(() => undefined);
  }
  return keys.map((_, index) => {
    const value = values[index];
    return isParseChartTaskResult(value) ? value : undefined;
  });
}

/**
 * Parses a chart file, through `cache` when one is given: a chart already parsed under the same key comes back from
 * the cache, and a chart parsed now is kept in it. Hashing or cache failures fall back to parsing. `onKey` receives
 * the file's cache key once it is worked out.
 */
export async function parseChartThroughCache(
  input: ParseChartTaskInput,
  cache: ParsedChartCache | undefined,
  onKey?: (key: string) => void,
): Promise<ParseChartTaskResult> {
  let key: string | undefined;
  if (cache !== undefined) {
    try {
      let hashed = parsedChartCacheKey(await sha256HexAsync(input.bytes), input.path);
      // An LRX chart also reads its header and BGA file, so those take part in the key.
      if (input.siblings !== undefined) {
        for (const sibling of [input.siblings.lrh, input.siblings.lrm]) {
          hashed += `:${sibling === undefined ? '-' : await sha256HexAsync(sibling)}`;
        }
      }
      key = hashed;
      onKey?.(hashed);
      const cached = await cache.get(key);
      if (isParseChartTaskResult(cached)) return cached;
    } catch {
      // Unhashable or unreadable: parse it.
    }
  }
  const result = await runBrowserTask('parse-chart', input, () => parseChartTask(input));
  if (cache !== undefined && key !== undefined) {
    try {
      await cache.set(key, result);
    } catch {
      // A cache that cannot keep it costs only the next load's parse.
    }
  }
  return result;
}

/** Whether a cached value has the shape of a parse result, so an entry from another build cannot break the load. */
function isParseChartTaskResult(value: unknown): value is ParseChartTaskResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Partial<ParseChartTaskResult>;
  return (
    typeof result.chart === 'object' &&
    result.chart !== null &&
    typeof result.scored === 'object' &&
    result.scored !== null &&
    typeof result.scored.notes === 'number' &&
    Array.isArray(result.strings)
  );
}

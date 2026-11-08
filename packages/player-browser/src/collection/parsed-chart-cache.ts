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
   * Keeps a parse result. The loader goes on to change the chart it holds once the returned promise settles, so the
   * implementation must have copied `value` by then (IndexedDB's `put` copies it when it is called); it need not wait
   * for the write to land.
   */
  set(key: string, value: ParseChartTaskResult): Promise<void>;
}

/**
 * What of a chart's path its parse result depends on: bmson or BMS text, and the `.pms` extension that decides the
 * play variant. Two files with the same bytes under the same kind of name parse the same.
 */
export function parsedChartPathKind(path: string): 'bmson' | 'pms' | 'bms' {
  const lower = path.toLowerCase();
  if (lower.endsWith('.bmson')) return 'bmson';
  if (lower.endsWith('.pms')) return 'pms';
  return 'bms';
}

/** The cache key of a chart file: the SHA-256 (lowercase hex) of its bytes and {@link parsedChartPathKind}. */
export function parsedChartCacheKey(sha256: string, path: string): string {
  return `${sha256}:${parsedChartPathKind(path)}`;
}

/**
 * Parses a chart file, through `cache` when one is given: a chart already parsed under the same key comes back from
 * the cache, and a chart parsed now is kept in it. Hashing or cache failures fall back to parsing.
 */
export async function parseChartThroughCache(
  input: ParseChartTaskInput,
  cache: ParsedChartCache | undefined,
): Promise<ParseChartTaskResult> {
  let key: string | undefined;
  if (cache !== undefined) {
    try {
      key = parsedChartCacheKey(await sha256HexAsync(input.bytes), input.path);
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

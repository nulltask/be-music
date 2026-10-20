/**
 * BMS Search (https://bmssearch.net) lookups. BMS Search files every chart (a "pattern", keyed by the file's SHA-256 or
 * MD5) under the work it belongs to (a "BMS"): the original charts and the add-on charts (差分) of one song share it.
 * Its maintainers link the charts by hand, so a chart may not be linked yet, and a link may change; the Leaderboard
 * keeps the link as a chartset and checks it again from time to time (docs/leaderboard.md section 7).
 *
 * The public API needs no key: `GET https://api.bmssearch.net/v1/patterns/sha256/{sha256}` or `.../patterns/{md5}`.
 */

export const BMS_SEARCH_API = 'https://api.bmssearch.net/v1';

/** Sent with every request, so BMS Search can tell where the calls come from. */
export const BMS_SEARCH_USER_AGENT = 'be-music-leaderboard (+https://github.com/nulltask/be-music)';

/** Whether a chart came in the work's own package or as a separately distributed add-on (差分). */
export type PackType = 'included' | 'additional';

/** What BMS Search knows about one chart file. */
export interface BMSSearchPattern {
  /** The work the chart is filed under, or null while nobody has linked it. */
  chartset: { id: string; title: string; event: string | null } | null;
  packType: PackType | null;
}

/** BMS Search's ids are short URL-safe strings (`mqcgl4L22QF7yc`); anything else is ignored. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

/** Reads a pattern response (`GET /patterns/...`), keeping only the fields the Leaderboard uses. */
export function parseBMSSearchPattern(json: unknown): BMSSearchPattern {
  const pattern = record(json) ?? {};
  const bms = record(pattern.bms);
  const id = text(bms?.id);
  const packType =
    pattern.packType === 'INCLUDED' ? 'included' : pattern.packType === 'ADDITIONAL' ? 'additional' : null;
  if (bms === undefined || id === null || !ID_PATTERN.test(id)) return { chartset: null, packType };
  return {
    chartset: { id, title: text(bms.title) ?? id, event: text(record(bms.exhibition)?.name) },
    packType,
  };
}

/** The pattern URLs to try for a chart's file hashes: SHA-256 first, then MD5. */
export function bmsSearchPatternURLs(aliases: ReadonlyArray<{ kind: 'sha256' | 'md5'; hash: string }>): string[] {
  const ordered = [...aliases].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'sha256' ? -1 : 1));
  return ordered.map((alias) =>
    alias.kind === 'sha256'
      ? `${BMS_SEARCH_API}/patterns/sha256/${encodeURIComponent(alias.hash)}`
      : `${BMS_SEARCH_API}/patterns/${encodeURIComponent(alias.hash)}`,
  );
}

/**
 * Looks a chart up by its file hashes. The first file BMS Search knows decides; `undefined` when it knows none of them.
 * Throws when BMS Search cannot be reached or answers with an error, so the caller tries again later.
 */
export async function lookupBMSSearchPattern(
  fetcher: typeof fetch,
  aliases: ReadonlyArray<{ kind: 'sha256' | 'md5'; hash: string }>,
): Promise<BMSSearchPattern | undefined> {
  for (const url of bmsSearchPatternURLs(aliases)) {
    const response = await fetcher(url, {
      headers: { accept: 'application/json', 'user-agent': BMS_SEARCH_USER_AGENT },
    });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`BMS Search answered ${response.status} for ${url}`);
    return parseBMSSearchPattern(await response.json());
  }
  return undefined;
}

import { and, asc, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { chart, chartAlias, chartset } from '../db/schema.ts';
import { lookupBmsSearchPattern, type BmsSearchPattern } from './bms-search.ts';

/** How long a chart's BMS Search answer stands before it is asked again. */
export const RECHECK_LINKED_MS = 30 * 24 * 60 * 60 * 1000;
/** Unlinked charts are asked more often: BMS Search's maintainers may link them any day. */
export const RECHECK_UNLINKED_MS = 7 * 24 * 60 * 60 * 1000;
/** Charts asked about per scheduled run, well under a Worker's subrequest limit (two lookups per chart at most). */
export const REFRESH_BATCH = 20;

/** Looks a chart up by its file hashes; `undefined` when BMS Search knows none of them. */
export type ChartsetLookup = (
  aliases: ReadonlyArray<{ kind: 'sha256' | 'md5'; hash: string }>,
) => Promise<BmsSearchPattern | undefined>;

/** The lookup against the live BMS Search API. */
export const bmsSearchLookup =
  (fetcher: typeof fetch = fetch): ChartsetLookup =>
  (aliases) =>
    lookupBmsSearchPattern(fetcher, aliases);

/**
 * Asks BMS Search which work a chart belongs to and files the chart under that chartset (or under none). A chart with
 * no file hash has nothing to look up and is only marked checked. When BMS Search cannot be reached the chart stays
 * unchecked, so the next run tries again.
 */
export async function refreshChartset(
  db: Database,
  lookup: ChartsetLookup,
  chartFingerprint: string,
  now: number,
): Promise<void> {
  const aliases = await db
    .select({ kind: chartAlias.kind, hash: chartAlias.hash })
    .from(chartAlias)
    .where(eq(chartAlias.chartFingerprint, chartFingerprint));
  let found: BmsSearchPattern | undefined;
  try {
    found = aliases.length === 0 ? undefined : await lookup(aliases);
  } catch (error) {
    console.warn(`chartset lookup failed for ${chartFingerprint}`, error);
    return;
  }
  const checkedAt = new Date(now);
  const linked = found?.chartset ?? null;
  if (linked !== null) {
    await db
      .insert(chartset)
      .values({ id: linked.id, title: linked.title, event: linked.event, createdAt: checkedAt, updatedAt: checkedAt })
      .onConflictDoUpdate({
        target: chartset.id,
        set: { title: linked.title, event: linked.event, updatedAt: checkedAt },
      });
  }
  await db
    .update(chart)
    .set({ chartsetId: linked?.id ?? null, packType: found?.packType ?? null, chartsetCheckedAt: checkedAt })
    .where(eq(chart.chartFingerprint, chartFingerprint));
}

/** Files a newly seen chart: only when BMS Search has not been asked about it yet. */
export async function refreshChartsetIfUnchecked(
  db: Database,
  lookup: ChartsetLookup,
  chartFingerprint: string,
  now: number,
): Promise<void> {
  const found = await db.query.chart.findFirst({
    where: eq(chart.chartFingerprint, chartFingerprint),
    columns: { chartsetCheckedAt: true },
  });
  if (found === undefined || found.chartsetCheckedAt !== null) return;
  await refreshChartset(db, lookup, chartFingerprint, now);
}

/**
 * The scheduled run: asks BMS Search about up to {@link REFRESH_BATCH} charts, never-checked ones first, then the ones
 * whose answer is oldest past its re-check period. Returns how many charts it asked about.
 */
export async function refreshStaleChartsets(
  db: Database,
  lookup: ChartsetLookup,
  now: number,
  limit = REFRESH_BATCH,
): Promise<number> {
  const due = await db
    .select({ chartFingerprint: chart.chartFingerprint })
    .from(chart)
    .where(
      or(
        isNull(chart.chartsetCheckedAt),
        and(isNotNull(chart.chartsetId), lt(chart.chartsetCheckedAt, new Date(now - RECHECK_LINKED_MS))),
        and(isNull(chart.chartsetId), lt(chart.chartsetCheckedAt, new Date(now - RECHECK_UNLINKED_MS))),
      ),
    )
    .orderBy(asc(chart.chartsetCheckedAt))
    .limit(limit);
  for (const { chartFingerprint } of due) {
    await refreshChartset(db, lookup, chartFingerprint, now);
  }
  return due.length;
}

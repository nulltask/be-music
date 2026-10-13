/** @jsxImportSource hono/jsx */
import { openDatabase } from '../db/client.ts';
import { ChartsetChartsTable } from './components/tables.tsx';
import { loadChartset, loadChartsetCharts } from './data.ts';
import { Layout, PageHeader } from './layout.tsx';
import { meta, notFound, PAGE_CACHE, type PageContext } from './page.tsx';

/** A chartset: the charts of one work, the original package's and the add-ons, as BMS Search files them. */
export async function chartsetPage(c: PageContext<'/leaderboard/chartsets/:id'>) {
  const db = openDatabase(c.env.DB);
  const [found, charts] = await Promise.all([
    loadChartset(db, c.req.param('id')),
    loadChartsetCharts(db, c.req.param('id')),
  ]);
  if (found === undefined) return notFound(c, 'This chartset');
  c.header('cache-control', PAGE_CACHE);
  return c.html(
    <Layout
      meta={meta(c, found.title, `${found.title} — ${charts.length} charts on the be-music Leaderboard.`, [
        { label: found.title, kind: 'chartset' },
      ])}
    >
      <PageHeader title={found.title} kind="chartset">
        {found.event !== null ? `${found.event} · ` : ''}
        {charts.length} chart{charts.length === 1 ? '' : 's'} ·
        <a
          class="underline-offset-4 hover:underline"
          href={`https://bmssearch.net/bmses/${encodeURIComponent(found.id)}`}
          rel="noopener"
          target="_blank"
        >
          BMS Search
        </a>
      </PageHeader>
      <ChartsetChartsTable charts={charts} />
      <p class="text-muted-foreground text-sm">
        Charts are grouped as BMS Search files them, by hand; a chart it has not filed yet stays on its own.
      </p>
    </Layout>,
  );
}

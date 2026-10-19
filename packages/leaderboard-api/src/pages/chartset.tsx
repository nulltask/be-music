/** @jsxImportSource hono/jsx */
import { openDatabase } from '../db/client.ts';
import { ChartsetChartsList } from './components/lists.tsx';
import { loadChartset, loadChartsetCharts } from './data.ts';
import { Layout, PageHeader } from './layout.tsx';
import { meta, notFound, PAGE_CACHE, pageMessages, type PageContext } from './page.tsx';

/** A chartset: the charts of one work, the original package's and the add-ons, as BMS Search files them. */
export async function chartsetPage(c: PageContext<'/chartsets/:id'>) {
  const db = openDatabase(c.env.DB);
  const [found, charts] = await Promise.all([
    loadChartset(db, c.req.param('id')),
    loadChartsetCharts(db, c.req.param('id')),
  ]);
  if (found === undefined) return notFound(c, 'chartset');
  c.header('cache-control', PAGE_CACHE);
  const t = pageMessages(c).chartset;
  return c.html(
    <Layout
      meta={meta(c, found.title, t.description(found.title, charts.length), [{ label: found.title, kind: 'chartset' }])}
    >
      <PageHeader title={found.title} kind="chartset">
        {found.event !== null ? `${found.event} · ` : ''}
        {t.charts(charts.length)} ·
        <a
          class="underline-offset-4 hover:underline"
          href={`https://bmssearch.net/bmses/${encodeURIComponent(found.id)}`}
          rel="noopener"
          target="_blank"
        >
          BMS Search
        </a>
      </PageHeader>
      <ChartsetChartsList charts={charts} />
      <p class="text-muted-foreground text-sm">{t.grouping}</p>
    </Layout>,
  );
}

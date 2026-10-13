/** @jsxImportSource hono/jsx */
import type { Child } from 'hono/jsx';
import { openDatabase } from '../db/client.ts';
import { loadScoreDetail } from '../scores/detail.ts';
import { ResultsTable } from './components/tables.tsx';
import { Details, LampLegend } from './components/cards.tsx';
import { chartHref, LocalTime, playerHref, Tag } from './components/basics.tsx';
import { loadChartsetOf } from './data.ts';
import { chartTitle, RULESET_LABELS } from './format.ts';
import { Layout, PageHeader } from './layout.tsx';
import { displayRuleset, meta, notFound, PAGE_CACHE, withArtist, type PageContext, chartsetCrumbs } from './page.tsx';

/** One play under every ruleset, with how it was played. */
export async function scorePage(c: PageContext<'/leaderboard/scores/:id'>) {
  const db = openDatabase(c.env.DB);
  const detail = await loadScoreDetail(db, c.req.param('id'));
  if (detail === undefined || detail.player === null) return notFound(c, 'This score');
  const { player } = detail;
  const filed = await loadChartsetOf(db, detail.chart.chartsetId);
  const title = chartTitle(detail.chart.title, detail.chart.chartFingerprint);
  const played = detail.results.find((result) => result.ruleset === detail.score.playedRuleset);
  const description =
    played !== undefined
      ? `${player.displayName} · ${title} · EX ${played.exScore} (${RULESET_LABELS[played.ruleset]})`
      : `${player.displayName} · ${title}`;
  c.header('cache-control', PAGE_CACHE);
  return c.html(
    <Layout
      meta={meta(c, `${title} — ${player.displayName}`, description, [
        ...chartsetCrumbs(filed),
        { label: title, href: chartHref(detail.chart.chartFingerprint) },
        { label: `${player.displayName}’s play` },
      ])}
    >
      <PageHeader
        title={
          <a class="underline-offset-4 hover:underline" href={chartHref(detail.chart.chartFingerprint)}>
            {title}
          </a>
        }
      >
        {withArtist(detail.chart.artist)}played by
        <a class="text-foreground font-medium underline-offset-4 hover:underline" href={playerHref(player.handle)}>
          {player.displayName}
        </a>
        {player.anonymous ? <Tag>anonymous</Tag> : null}
      </PageHeader>
      <ResultsTable
        results={detail.results}
        playedRuleset={detail.score.playedRuleset}
        displayRuleset={displayRuleset(c)}
      />
      <Details
        title="Play"
        rows={[
          ['Played', <LocalTime at={detail.score.createdAt.getTime()} />],
          ['Gauge', detail.score.gauge],
          ['Assists', detail.score.assisted ? detail.score.assistFlags.join(', ') : 'none'],
          ['Verification', detail.score.verification],
          ['Chart', <span class="font-mono text-xs">{detail.chart.chartFingerprint}</span>],
          ...(detail.score.replayVisibility === 'public'
            ? ([
                [
                  'Replay',
                  <a
                    class="underline-offset-4 hover:underline"
                    href={`/api/v0/scores/${encodeURIComponent(detail.score.id)}/playlog`}
                    download
                  >
                    Download play log
                  </a>,
                ],
              ] as Array<[string, Child]>)
            : []),
        ]}
      />
      <LampLegend />
    </Layout>,
  );
}

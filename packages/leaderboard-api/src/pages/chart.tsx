/** @jsxImportSource hono/jsx */
import type { Child } from 'hono/jsx';
import { openDatabase } from '../db/client.ts';
import { isOn } from '../http/query.ts';
import { countPlayers, loadRanking } from '../ranking.ts';
import { RankingTable } from './components/tables.tsx';
import { Details, DistributionCard, Elsewhere, LampLegend, Stats } from './components/cards.tsx';
import { EntityIcon } from './components/entity-icon.tsx';
import { chartsetHref, FilterChip, Filters, LocalTime, Tag } from './components/basics.tsx';
import { loadChart, loadChartAliases, loadChartsetOf, loadPlayInfos } from './data.ts';
import { externalLinks } from './external.ts';
import { chartTitle, formatJudgeRank, formatLaneMode, formatLnMode, rulesetName } from './format.ts';
import { Layout, PageHeader } from './layout.tsx';
import {
  day,
  displayRuleset,
  known,
  meta,
  notFound,
  orDash,
  PAGE_CACHE,
  RANKING_LIMIT,
  withArtist,
  withQuery,
  type PageContext,
  chartsetCrumbs,
} from './page.tsx';
import { loadChartStats } from './stats.ts';

/** A chart's ranking, figures and details under the display ruleset. */
export async function chartPage(c: PageContext<'/leaderboard/charts/:chartFingerprint'>) {
  const db = openDatabase(c.env.DB);
  const chartFingerprint = c.req.param('chartFingerprint');
  const found = await loadChart(db, chartFingerprint);
  if (found === undefined) return notFound(c, 'This chart');
  const ruleset = displayRuleset(c);
  const assisted = isOn(c.req.query('assisted'));
  const includeAnonymous = isOn(c.req.query('anonymous'));
  const filter = { chartFingerprint, ruleset, assisted, includeAnonymous, playedHereOnly: false };
  // Everything below depends only on the chart: ask D1 for it at once rather than one query after another.
  const [ranking, everyone, aliases, stats, filed] = await Promise.all([
    loadRanking(db, filter, { offset: 0, limit: RANKING_LIMIT }),
    countPlayers(db, { ...filter, includeAnonymous: true }),
    loadChartAliases(db, chartFingerprint),
    loadChartStats(db, filter),
    loadChartsetOf(db, found.chartsetId),
  ]);
  const infos = await loadPlayInfos(
    db,
    ranking.entries.map((entry) => entry.exScoreId),
  );
  const title = chartTitle(found.title, chartFingerprint);
  const elsewhere = externalLinks(found, aliases);
  c.header('cache-control', PAGE_CACHE);
  return c.html(
    <Layout
      meta={meta(c, title, `${title} — ranking under ${rulesetName(ruleset)}, ${ranking.players} players.`, [
        ...chartsetCrumbs(filed),
        { label: title, kind: 'chart' },
      ])}
    >
      <PageHeader
        kind="chart"
        title={
          <>
            {title}
            {found.subtitle !== null && found.subtitle.length > 0 ? (
              <span class="text-muted-foreground ms-2 text-lg font-normal">{found.subtitle}</span>
            ) : null}
          </>
        }
      >
        {withArtist(found.artist)}
        {found.laneMode !== null ? `${formatLaneMode(found.laneMode)} · ` : ''}
        {found.noteCount} notes · {everyone} player{everyone === 1 ? '' : 's'}
        {found.status === 'listed' ? null : <Tag>new chart</Tag>}
      </PageHeader>
      <Stats
        items={[
          ['Players', stats.players],
          ['Plays', stats.plays],
          ['First played', day(stats.firstPlayedAt)],
          ['Last played', day(stats.lastPlayedAt)],
        ]}
      />
      <Filters>
        <FilterChip label="Assisted" on={assisted} href={withQuery(c, 'assisted', assisted ? undefined : '1')} />
        <FilterChip
          label="Anonymous players"
          on={includeAnonymous}
          href={withQuery(c, 'anonymous', includeAnonymous ? undefined : '1')}
        />
      </Filters>
      <RankingTable entries={ranking.entries} infos={infos} noteCount={found.noteCount} />
      <DistributionCard
        title="Clear lamps"
        description={`Best lamps of the players above, under ${rulesetName(ruleset)}.`}
        distribution={stats.lamps}
        kind="lamp"
      />
      <Details
        title="Chart"
        rows={known([
          [
            'Chartset',
            filed === undefined ? (
              '-'
            ) : (
              <a
                class="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                href={chartsetHref(filed.id)}
              >
                <EntityIcon kind="chartset" size="sm" />
                {filed.title}
              </a>
            ),
          ],
          [
            'Package',
            found.packType === 'included' ? 'original' : found.packType === 'additional' ? 'add-on (差分)' : '-',
          ],
          ['Genre', orDash(found.genre)],
          ['Mode', formatLaneMode(found.laneMode)],
          ['Notes', found.noteCount],
          ['TOTAL', orDash(found.total)],
          ['Judge rank', formatJudgeRank(found.judgeRank)],
          ['Long notes', formatLnMode(found.lnMode)],
          ['Format', found.sourceFormat === null ? '-' : found.sourceFormat.toUpperCase()],
          [
            '#RANDOM outcomes',
            found.playFingerprints.length > 1 ? `${found.playFingerprints.length} seen` : 'none seen',
          ],
          ['Fingerprint', <span class="font-mono text-xs">{chartFingerprint}</span>],
          ...aliases.map((alias): [string, Child] => [
            alias.kind === 'sha256' ? 'File SHA-256' : 'File MD5',
            <span class="font-mono text-xs">{alias.hash}</span>,
          ]),
          ['First seen', <LocalTime at={found.createdAt.getTime()} />],
          ['Listed', found.status === 'listed' ? 'yes' : 'not yet (two players with a passkey list a chart)'],
        ])}
      />
      <Elsewhere links={elsewhere} />
      <LampLegend />
    </Layout>,
  );
}

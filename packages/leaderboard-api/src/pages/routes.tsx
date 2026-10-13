/** @jsxImportSource hono/jsx */
import type { Context, Hono } from 'hono';
import type { Child } from 'hono/jsx';
import { getCookie, setCookie } from 'hono/cookie';
import { Scalar } from '@scalar/hono-api-reference';
import type { AppEnv } from '../app.ts';
import { openDatabase } from '../db/client.ts';
import { countPlayers, loadRanking } from '../ranking.ts';
import {
  loadChart,
  loadChartAliases,
  loadChartset,
  loadChartsetCharts,
  loadChartsetOf,
  loadPlayer,
  loadPlayInfos,
  loadRecentScores,
  loadScoreDetail,
} from './data.ts';
import { externalLinks } from './external.ts';
import {
  chartTitle,
  formatJudgeRank,
  formatLaneMode,
  formatLnMode,
  formatPercent,
  formatTimestamp,
  RULESET_LABELS,
} from './format.ts';
import { Layout, PageHeader, STYLESHEET_PATH, type Crumb, type PageMeta } from './layout.tsx';
import { APP_CSS } from './styles.generated.ts';
import { isOn } from '../http/query.ts';
import { isRuleset } from '../rulesets.ts';
import { RULESET_COOKIE, resolveDisplayRuleset, safeReturnPath } from './preferences.ts';
import { loadChartStats, loadPlayerStats } from './stats.ts';
import {
  chartHref,
  chartsetHref,
  ChartsetChartsTable,
  Details,
  DistributionCard,
  Elsewhere,
  FilterChip,
  Filters,
  LampLegend,
  playerHref,
  RankingTable,
  RecentScoresTable,
  ResultsTable,
  Stats,
  Tag,
} from './views.tsx';

const RECENT_LIMIT = 50;
const RANKING_LIMIT = 100;

/**
 * Pages change with every submission and follow the viewer's display ruleset (a cookie), so they are private and the
 * browser revalidates every time: a player sees their new score at once.
 */
const PAGE_CACHE = 'private, max-age=0';

/** The display ruleset lasts a year; switching it again replaces it. */
const RULESET_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** `Artist · ` before the rest of a subtitle, or nothing when the play log carried no artist. */
const withArtist = (artist: string | null): string =>
  artist !== null && artist.trim().length > 0 ? `${artist} · ` : '';

/** A day for a figure tile (the full time on hover), or `-` when there is none. */
const day = (epochMs: number | null): Child =>
  epochMs === null ? '-' : <time title={formatTimestamp(epochMs)}>{formatTimestamp(epochMs).slice(0, 10)}</time>;

/** A timestamp, or `-` when there is none. */
const when = (epochMs: number | null): string => (epochMs === null ? '-' : formatTimestamp(epochMs));

/** The breadcrumb of a chart's chartset, when it is filed under one. */
const chartsetCrumbs = (filed: { id: string; title: string } | undefined): Crumb[] =>
  filed === undefined ? [] : [{ label: filed.title, href: chartsetHref(filed.id) }];

/** Detail rows without the ones the play log left empty. */
const known = (rows: Array<[string, Child]>): Array<[string, Child]> => rows.filter(([, value]) => value !== '-');

/** A text value a play log may have left out. */
const orDash = (value: string | number | null): string | number => (value === null || value === '' ? '-' : value);

/** The current URL with one query parameter set (or removed with `undefined`). */
function withQuery(c: Context, key: string, value: string | undefined): string {
  const url = new URL(c.req.url);
  if (value === undefined) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

function meta(c: Context, title: string, description: string, crumbs: Crumb[] = []): PageMeta {
  const url = new URL(c.req.url);
  return {
    title,
    description,
    crumbs,
    url: c.req.url,
    path: `${url.pathname}${url.search}`,
    ruleset: resolveDisplayRuleset(getCookie(c, RULESET_COOKIE)),
  };
}

/** The viewer's display ruleset: every page shows its figures under it (docs/leaderboard.md section 10). */
function displayRuleset(c: Context) {
  return resolveDisplayRuleset(getCookie(c, RULESET_COOKIE));
}

function notFound(c: Context<AppEnv>, what: string) {
  return c.html(
    <Layout meta={meta(c, 'Not found', `${what} not found.`, [{ label: 'Not found' }])}>
      <PageHeader title="Not found">{what} does not exist, or it was removed.</PageHeader>
    </Layout>,
    404,
  );
}

/** Server-rendered Leaderboard pages under `/leaderboard` (docs/leaderboard.md section 10). */
export function mountPages(app: Hono<AppEnv>): void {
  // New scores: every play by a player who is not anonymous, on any chart; a chart not listed yet carries a "new chart"
  // tag. Anonymous plays come in on request. An invented chart can reach this page only through an account with a
  // passkey, and the chart index (later) still lists charts by the two-player rule.
  const top = async (c: Context<AppEnv>) => {
    const includeAnonymous = isOn(c.req.query('anonymous'));
    const ruleset = displayRuleset(c);
    const db = openDatabase(c.env.DB);
    const scores = await loadRecentScores(db, {
      limit: RECENT_LIMIT,
      ruleset,
      includeAnonymous,
      includeUnlisted: true,
    });
    c.header('cache-control', PAGE_CACHE);
    return c.html(
      <Layout meta={meta(c, 'New scores', 'The newest plays on the be-music Leaderboard.', [{ label: 'New scores' }])}>
        <PageHeader title="New scores">The newest plays, scored under {RULESET_LABELS[ruleset]}.</PageHeader>
        <Filters>
          <FilterChip
            label="Anonymous players"
            on={includeAnonymous}
            href={withQuery(c, 'anonymous', includeAnonymous ? undefined : '1')}
          />
        </Filters>
        <RecentScoresTable
          scores={scores}
          infos={await loadPlayInfos(
            db,
            scores.map((entry) => entry.scoreId),
          )}
          showPlayer
          empty={
            includeAnonymous
              ? 'No plays yet.'
              : 'Plays show up once their player creates a passkey — turn on “Anonymous players” to see the rest.'
          }
        />
        <LampLegend />
      </Layout>,
    );
  };
  app.get('/leaderboard', top);
  app.get('/leaderboard/', top);

  // Switches the display ruleset and goes back to the page it was switched on. A dedicated URL keeps the setting out of
  // shareable page URLs, so opening someone's link never changes the viewer's setting.
  app.get('/leaderboard/ruleset/:ruleset', (c) => {
    const ruleset = c.req.param('ruleset');
    if (isRuleset(ruleset)) {
      setCookie(c, RULESET_COOKIE, ruleset, {
        path: '/leaderboard',
        maxAge: RULESET_COOKIE_MAX_AGE,
        sameSite: 'Lax',
        secure: new URL(c.req.url).protocol === 'https:',
      });
    }
    return c.redirect(safeReturnPath(c.req.query('next')), 303);
  });

  app.get('/leaderboard/scores/:id', async (c) => {
    const db = openDatabase(c.env.DB);
    const detail = await loadScoreDetail(db, c.req.param('id'));
    if (detail === undefined) return notFound(c, 'This score');
    const filed = await loadChartsetOf(db, detail.chart.chartsetId);
    const title = chartTitle(detail.chart.title, detail.chart.chartFingerprint);
    const played = detail.results.find((result) => result.ruleset === detail.score.playedRuleset);
    const description =
      played !== undefined
        ? `${detail.displayName} · ${title} · EX ${played.exScore} (${RULESET_LABELS[played.ruleset]})`
        : `${detail.displayName} · ${title}`;
    c.header('cache-control', PAGE_CACHE);
    return c.html(
      <Layout
        meta={meta(c, `${title} — ${detail.displayName}`, description, [
          ...chartsetCrumbs(filed),
          { label: title, href: chartHref(detail.chart.chartFingerprint) },
          { label: `${detail.displayName}’s play` },
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
          <a class="text-foreground font-medium underline-offset-4 hover:underline" href={playerHref(detail.handle)}>
            {detail.displayName}
          </a>
          {detail.anonymous ? <Tag>anonymous</Tag> : null}
        </PageHeader>
        <ResultsTable
          results={detail.results}
          playedRuleset={detail.score.playedRuleset}
          displayRuleset={displayRuleset(c)}
        />
        <Details
          title="Play"
          rows={[
            ['Played', formatTimestamp(detail.score.createdAt.getTime())],
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
  });

  app.get('/leaderboard/charts/:chartFingerprint', async (c) => {
    const db = openDatabase(c.env.DB);
    const chartFingerprint = c.req.param('chartFingerprint');
    const found = await loadChart(db, chartFingerprint);
    if (found === undefined) return notFound(c, 'This chart');
    const ruleset = displayRuleset(c);
    const assisted = isOn(c.req.query('assisted'));
    const includeAnonymous = isOn(c.req.query('anonymous'));
    const filter = { chartFingerprint, ruleset, assisted, includeAnonymous, playedHereOnly: false };
    const ranking = await loadRanking(db, filter, { offset: 0, limit: RANKING_LIMIT });
    const title = chartTitle(found.title, chartFingerprint);
    const everyone = await countPlayers(db, { ...filter, includeAnonymous: true });
    const aliases = await loadChartAliases(db, chartFingerprint);
    const elsewhere = externalLinks(found, aliases);
    const stats = await loadChartStats(db, filter);
    const filed = await loadChartsetOf(db, found.chartsetId);
    c.header('cache-control', PAGE_CACHE);
    return c.html(
      <Layout
        meta={meta(c, title, `${title} — ${RULESET_LABELS[ruleset]} ranking, ${ranking.players} players.`, [
          ...chartsetCrumbs(filed),
          { label: title },
        ])}
      >
        <PageHeader
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
        <RankingTable
          entries={ranking.entries}
          infos={await loadPlayInfos(
            db,
            ranking.entries.map((entry) => entry.exScoreId),
          )}
          noteCount={found.noteCount}
        />
        <DistributionCard
          title="Clear lamps"
          description={`Best lamps of the players above, under ${RULESET_LABELS[ruleset]}.`}
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
                <a class="underline-offset-4 hover:underline" href={chartsetHref(filed.id)}>
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
            ['First seen', formatTimestamp(found.createdAt.getTime())],
            ['Listed', found.status === 'listed' ? 'yes' : 'not yet (two players with a passkey list a chart)'],
          ])}
        />
        <Elsewhere links={elsewhere} />
        <LampLegend />
      </Layout>,
    );
  });

  app.get('/leaderboard/players/:handle', async (c) => {
    const db = openDatabase(c.env.DB);
    const player = await loadPlayer(db, c.req.param('handle'));
    if (player === undefined) return notFound(c, 'This player');
    const ruleset = displayRuleset(c);
    const stats = await loadPlayerStats(db, player.userId, ruleset);
    const scores = await loadRecentScores(db, {
      limit: RECENT_LIMIT,
      ruleset,
      includeAnonymous: true,
      includeUnlisted: true,
      handle: player.handle,
    });
    c.header('cache-control', PAGE_CACHE);
    return c.html(
      <Layout
        meta={meta(c, player.displayName, `${player.displayName} (@${player.handle}) on the be-music Leaderboard.`, [
          { label: player.displayName },
        ])}
      >
        <PageHeader title={player.displayName}>
          @{player.handle}
          {player.anonymous ? <Tag>anonymous</Tag> : null}
        </PageHeader>
        <Stats
          items={[
            ['Plays', stats.plays],
            ['Charts', stats.charts],
            [`Average rate (${RULESET_LABELS[ruleset]})`, formatPercent(stats.averageRate)],
            ['Last played', day(stats.lastPlayedAt)],
          ]}
        />
        <div class="grid gap-6 lg:grid-cols-2">
          <DistributionCard
            title="Clear lamps"
            description={`Best lamp per chart under ${RULESET_LABELS[ruleset]}, without assists.`}
            distribution={stats.lamps}
            kind="lamp"
          />
          <DistributionCard
            title="DJ Ranks"
            description={`Best EX-Score per chart under ${RULESET_LABELS[ruleset]}, without assists.`}
            distribution={stats.djRanks}
            kind="dj-rank"
          />
        </div>
        <Details
          title="Player"
          rows={[
            ['Joined', formatTimestamp(player.joinedAt)],
            ['First play', when(stats.firstPlayedAt)],
            [
              'Played under',
              stats.playsByRuleset.length === 0
                ? '-'
                : stats.playsByRuleset
                    .map(
                      (entry) => `${RULESET_LABELS[entry.ruleset]}: ${entry.count} play${entry.count === 1 ? '' : 's'}`,
                    )
                    .join(' · '),
            ],
          ]}
        />
        <RecentScoresTable
          scores={scores}
          infos={await loadPlayInfos(
            db,
            scores.map((entry) => entry.scoreId),
          )}
          showPlayer={false}
          empty="No plays yet."
        />
        <LampLegend />
      </Layout>,
    );
  });

  // A chartset: the charts of one work, the original package's and the add-ons, as BMS Search files them.
  app.get('/leaderboard/chartsets/:id', async (c) => {
    const db = openDatabase(c.env.DB);
    const found = await loadChartset(db, c.req.param('id'));
    if (found === undefined) return notFound(c, 'This chartset');
    const charts = await loadChartsetCharts(db, found.id);
    c.header('cache-control', PAGE_CACHE);
    return c.html(
      <Layout
        meta={meta(c, found.title, `${found.title} — ${charts.length} charts on the be-music Leaderboard.`, [
          { label: found.title },
        ])}
      >
        <PageHeader title={found.title}>
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
  });

  // The API reference, rendered by Scalar from the OpenAPI document. Its script is pinned so the page does not change
  // under us.
  app.get(
    '/leaderboard/api',
    Scalar({
      url: '/api/v0/openapi.json',
      pageTitle: 'be-music Leaderboard API',
      cdn: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.4',
      // A plain reference: no hosted AI agent and no developer toolbar.
      agent: { disabled: true },
      showDeveloperTools: 'never',
    }),
  );

  // The compiled stylesheet. Its name carries a content hash, so browsers and caches may keep it forever.
  app.get(STYLESHEET_PATH, (c) =>
    c.body(APP_CSS, 200, {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    }),
  );

  app.get('/leaderboard/*', (c) => notFound(c, 'This page'));
}
